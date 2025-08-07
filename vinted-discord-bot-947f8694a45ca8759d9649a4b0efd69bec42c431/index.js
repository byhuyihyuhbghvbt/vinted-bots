const config = require('./config.json');

const Database = require('easy-json-database');
const db = new Database('./db.json');
if (!db.has('subscriptions')) db.set('subscriptions', []);

const Discord = require('discord.js');
const PerformanceMonitor = require('./performance-monitor');

// Initialize performance monitoring
const perfMonitor = new PerformanceMonitor({
    memoryCheckInterval: 30000,
    cacheMaxSize: 200,
    cacheTTL: 300000, // 5 minutes
    memoryThreshold: 400 * 1024 * 1024 // 400MB
});

// Performance monitor event listeners
perfMonitor.on('memoryWarning', (data) => {
    console.warn(`⚠️  Memory usage high: ${data.heapUsed}MB (threshold: ${data.threshold}MB)`);
});

perfMonitor.on('request', (data) => {
    if (data.responseTime > 5000) { // Warn if request takes more than 5 seconds
        console.warn(`⚠️  Slow request detected: ${data.responseTime}ms (avg: ${Math.round(data.avgResponseTime)}ms)`);
    }
});

perfMonitor.on('cacheClean', (data) => {
    console.log(`🧹 Cache cleaned: ${data.cleaned} expired entries, ${data.remaining} remaining`);
});
const client = new Discord.Client({
    intents: [Discord.Intents.FLAGS.GUILDS]
});

const synchronizeSlashCommands = require('discord-sync-commands');
synchronizeSlashCommands(client, [
    {
        name: 'abonner',
        description: 'Abonnez-vous à une URL de recherche',
        options: [
            {
                name: 'url',
                description: 'L\'URL de la recherche Vinted',
                type: 3,
                required: true
            },
            {
                name: 'channel',
                description: 'Le salon dans lequel vous souhaitez envoyer les notifications',
                type: 7,
                required: true
            }
        ]
    },
    {
        name: 'désabonner',
        description: 'Désabonnez-vous d\'une URL de recherche',
        options: [
            {
                name: 'id',
                description: 'L\'identifiant de l\'abonnement (/abonnements)',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'abonnements',
        description: 'Accèdez à la liste de tous vos abonnements',
        options: []
    },
    {
        name: 'performance',
        description: 'Afficher les statistiques de performance du bot',
        options: []
    }
], {
    debug: false,
    guildId: config.guildID
}).then((stats) => {
    console.log(`🔁 Commandes mises à jour ! ${stats.newCommandCount} commandes créées, ${stats.currentCommandCount} commandes existantes\n`)
}).catch(console.error);

const vinted = require('vinted-api');

let lastFetchFinished = true;
let syncInterval;

// Performance optimization: Rate limiting and request queue
const requestQueue = [];
let isProcessingQueue = false;
const RATE_LIMIT_DELAY = 1000; // 1 second between requests
const MAX_CONCURRENT_REQUESTS = 3;

// Process API requests with rate limiting
const processQueue = async () => {
    if (isProcessingQueue || requestQueue.length === 0) return;
    
    isProcessingQueue = true;
    const batch = requestQueue.splice(0, MAX_CONCURRENT_REQUESTS);
    
    try {
        await Promise.allSettled(batch.map(request => request()));
    } catch (error) {
        console.error('Error processing request batch:', error);
    }
    
    setTimeout(() => {
        isProcessingQueue = false;
        if (requestQueue.length > 0) {
            processQueue();
        }
    }, RATE_LIMIT_DELAY);
};

// Optimized subscription sync with better error handling and performance
const syncSubscription = (sub) => {
    return new Promise((resolve) => {
        const request = async () => {
            const timer = perfMonitor.trackRequest();
            try {
                // Check cache first
                const cacheKey = `search_${Buffer.from(sub.url).toString('base64')}`;
                let res = perfMonitor.get(cacheKey);
                
                if (!res) {
                    res = await vinted.search(sub.url, false, false, {
                        per_page: '10' // Reduced from 20 to improve response time
                    });
                    
                    // Cache successful responses for 2 minutes
                    if (res && res.items) {
                        perfMonitor.set(cacheKey, res, 120000);
                    }
                }
                
                if (!res.items) {
                    console.log('Search done but got wrong response. Promise resolved.', res);
                    resolve();
                    return;
                }
                
                const isFirstSync = db.get('is_first_sync');
                const lastItemTimestamp = db.get(`last_item_ts_${sub.id}`);
                
                // Performance optimization: More efficient filtering and sorting
                let items = res.items;
                if (lastItemTimestamp) {
                    items = items.filter((item) => new Date(item.created_at_ts) > lastItemTimestamp);
                }
                
                if (!items.length) {
                    resolve();
                    return;
                }
                
                // Sort only filtered items instead of all items
                items.sort((a, b) => new Date(b.created_at_ts).getTime() - new Date(a.created_at_ts).getTime());
                
                const newLastItemTimestamp = new Date(items[0].created_at_ts).getTime();
                if (!lastItemTimestamp || newLastItemTimestamp > lastItemTimestamp) {
                    db.set(`last_item_ts_${sub.id}`, newLastItemTimestamp);
                }

                const itemsToSend = ((lastItemTimestamp && !isFirstSync) ? items.reverse() : [items[0]]);

                // Performance optimization: Batch message sending with error handling
                const sendPromises = itemsToSend.map(async (item) => {
                    try {
                        const embed = new Discord.MessageEmbed()
                            .setTitle(item.title)
                            .setURL(`https://www.vinted.fr${item.path}`)
                            .setColor('#008000')
                            .setTimestamp(item.createdTimestamp)
                            .setFooter(`Article lié à la recherche : ${sub.id}`)
                            .addField('Taille', item.size || 'vide', true)
                            .addField('Prix', item.price || 'vide', true)
                            .addField('Condition', item.status || 'vide', true);
                        
                        // Only add image if it exists to reduce payload size
                        if (item.photos && item.photos[0]?.url) {
                            embed.setImage(item.photos[0].url);
                        }
                        
                        const channel = client.channels.cache.get(sub.channelID);
                        if (!channel) {
                            console.warn(`Channel ${sub.channelID} not found for subscription ${sub.id}`);
                            return;
                        }
                        
                        await channel.send({ 
                            embeds: [embed], 
                            components: [
                                new Discord.MessageActionRow()
                                    .addComponents([
                                        new Discord.MessageButton()
                                            .setLabel('Détails')
                                            .setURL(item.url)
                                            .setEmoji('🔎')
                                            .setStyle('LINK'),
                                        new Discord.MessageButton()
                                            .setLabel('Acheter')
                                            .setURL(`https://www.vinted.fr/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`)
                                            .setEmoji('💸')
                                            .setStyle('LINK')
                                    ])
                            ] 
                        });
                    } catch (error) {
                        console.error(`Error sending message for item ${item.id}:`, error);
                    }
                });
                
                await Promise.allSettled(sendPromises);

                if (itemsToSend.length > 0) {
                    console.log(`👕 ${itemsToSend.length} ${itemsToSend.length > 1 ? 'nouveaux articles trouvés' : 'nouvel article trouvé'} pour la recherche ${sub.id} !\n`)
                }

                timer.end();
                resolve();
            } catch (error) {
                perfMonitor.trackError(error);
                console.error('Search returned an error. Promise resolved.', error);
                timer.end();
                resolve();
            }
        };
        
        requestQueue.push(request);
        processQueue();
    });
};

// Optimized sync function with better memory management
const sync = async () => {
    if (!lastFetchFinished) return;
    lastFetchFinished = false;

    console.log(`🤖 Synchronisation à Vinted...\n`);

    try {
        const subscriptions = db.get('subscriptions');
        if (!subscriptions || subscriptions.length === 0) {
            lastFetchFinished = true;
            return;
        }
        
        // Process subscriptions with controlled concurrency
        const chunks = [];
        for (let i = 0; i < subscriptions.length; i += MAX_CONCURRENT_REQUESTS) {
            chunks.push(subscriptions.slice(i, i + MAX_CONCURRENT_REQUESTS));
        }
        
        for (const chunk of chunks) {
            const promises = chunk.map((sub) => syncSubscription(sub));
            await Promise.allSettled(promises);
            
            // Small delay between chunks to prevent API rate limiting
            if (chunks.indexOf(chunk) < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        db.set('is_first_sync', false);
    } catch (error) {
        console.error('Error during sync:', error);
    } finally {
        lastFetchFinished = true;
    }
};

client.on('ready', () => {
    console.log(`🔗 Connecté sur le compte de ${client.user.tag} !\n`);

    // Performance optimization: Clean up database more efficiently
    const allEntries = db.all();
    const entriesToDelete = allEntries.filter((e) => e.key !== 'subscriptions' && !e.key.startsWith('last_item_ts'));
    entriesToDelete.forEach((e) => {
        db.delete(e.key);
    });
    db.set('is_first_sync', true);

    const messages = [
        `🕊️ Ce projet libre et gratuit demande du temps. Si vous en avez les moyens, n'hésitez pas à soutenir le développement avec un don ! https://paypal.me/andr0z\n`,
        `🤟 Le saviez-vous ? Nous proposons notre propre version du bot en ligne 24/24 7/7 sans que vous n'ayez besoin de vous soucier de quoi que ce soit ! https://distrobot.fr\n`
    ];
    let idx = 0;
    const donate = () => console.log(messages[idx % 2]);
    
    // Performance optimization: Use single timeout instead of immediate + interval
    const donateInterval = setInterval(() => {
        donate();
        idx++;
    }, idx === 0 ? 3000 : 20000);

    // Start sync and set up interval
    sync();
    syncInterval = setInterval(sync, 15000);

    const { version } = require('./package.json');
    client.user.setActivity(`Vinted BOT | v${version}`);
});

// Performance optimization: Improved command handling with input validation
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    if (!config.adminIDs.includes(interaction.user.id)) {
        return void interaction.reply(`:x: Vous ne disposez pas des droits pour effectuer cette action !`);
    }

    try {
        switch (interaction.commandName) {
            case 'abonner': {
                const url = interaction.options.getString('url');
                const channel = interaction.options.getChannel('channel');
                
                // Input validation
                if (!url.includes('vinted.fr')) {
                    return void interaction.reply(':x: L\'URL doit être une URL Vinted valide !');
                }
                
                const sub = {
                    id: Math.random().toString(36).substring(7),
                    url: url,
                    channelID: channel.id
                };
                
                db.push('subscriptions', sub);
                db.set(`last_item_ts_${sub.id}`, null);
                await interaction.reply(`:white_check_mark: Votre abonnement a été créé avec succès !\n**URL**: <${sub.url}>\n**Salon**: <#${sub.channelID}>`);
                break;
            }
            case 'désabonner': {
                const subID = interaction.options.getString('id');
                const subscriptions = db.get('subscriptions');
                const subscription = subscriptions.find((sub) => sub.id === subID);
                
                if (!subscription) {
                    return void interaction.reply(':x: Aucun abonnement trouvé pour votre recherche...');
                }
                
                const newSubscriptions = subscriptions.filter((sub) => sub.id !== subID);
                db.set('subscriptions', newSubscriptions);
                db.delete(`last_item_ts_${subID}`); // Clean up timestamp
                
                await interaction.reply(`:white_check_mark: Abonnement supprimé avec succès !\n**URL**: <${subscription.url}>\n**Salon**: <#${subscription.channelID}>`);
                break;
            }
            case 'abonnements': {
                const subscriptions = db.get('subscriptions');
                
                if (!subscriptions || subscriptions.length === 0) {
                    return void interaction.reply(':x: Aucun abonnement actif trouvé !');
                }
                
                // Performance optimization: More efficient chunking algorithm
                const chunks = [];
                let currentChunk = [];
                let currentLength = 0;
                
                for (const sub of subscriptions) {
                    const content = `**ID**: ${sub.id}\n**URL**: ${sub.url}\n**Salon**: <#${sub.channelID}>\n`;
                    
                    if (currentLength + content.length > 1024 && currentChunk.length > 0) {
                        chunks.push(currentChunk);
                        currentChunk = [content];
                        currentLength = content.length;
                    } else {
                        currentChunk.push(content);
                        currentLength += content.length;
                    }
                }
                
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk);
                }

                await interaction.reply(`:white_check_mark: **${subscriptions.length}** abonnements sont actifs !`);

                // Send embeds with error handling
                for (const chunk of chunks) {
                    try {
                        const embed = new Discord.MessageEmbed()
                            .setColor('RED')
                            .setAuthor(`Utilisez la commande /désabonner pour supprimer un abonnement !`)
                            .setDescription(chunk.join('\n'));
                        
                        await interaction.channel.send({ embeds: [embed] });
                    } catch (error) {
                        console.error('Error sending subscription list embed:', error);
                    }
                }
                break;
            }
            case 'performance': {
                const report = perfMonitor.createReport();
                const embed = new Discord.MessageEmbed()
                    .setTitle('📊 Performance Statistics')
                    .setColor('#00ff00')
                    .addField('⏱️ Uptime', report.uptime, true)
                    .addField('📊 Requests', report.requests.toString(), true)
                    .addField('❌ Errors', `${report.errors} (${report.errorRate})`, true)
                    .addField('⚡ Avg Response', report.avgResponseTime, true)
                    .addField('💾 Cache Usage', `${report.cache.size}/${report.cache.maxSize}`, true)
                    .setTimestamp();

                if (report.memory) {
                    embed.addField('🧠 Memory Usage', 
                        `Heap: ${report.memory.heapUsed}/${report.memory.heapTotal}\nExternal: ${report.memory.external}`, 
                        true);
                }

                await interaction.reply({ embeds: [embed] });
                break;
            }
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply(':x: Une erreur est survenue lors du traitement de votre commande.').catch(console.error);
        }
    }
});

// Graceful shutdown handling
const gracefulShutdown = () => {
    console.log('🛑 Arrêt du bot...');
    
    // Print final performance report
    console.log('📊 Final Performance Report:');
    console.log(JSON.stringify(perfMonitor.createReport(), null, 2));
    
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    
    perfMonitor.stopMonitoring();
    client.destroy();
    process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

client.login(process.env.TOKEN);
