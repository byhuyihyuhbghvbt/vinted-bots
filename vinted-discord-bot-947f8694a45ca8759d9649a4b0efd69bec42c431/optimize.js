const fs = require('fs');
const path = require('path');

/**
 * Performance optimization utility for the Vinted Discord Bot
 * Handles image optimization, memory management, and performance monitoring
 */

class PerformanceOptimizer {
    constructor() {
        this.metrics = {
            startTime: process.hrtime(),
            memoryUsage: process.memoryUsage(),
            originalSizes: {},
            optimizedSizes: {}
        };
    }

    /**
     * Simple PNG optimization by removing metadata and optimizing compression
     */
    async optimizeImage(filePath) {
        try {
            const buffer = fs.readFileSync(filePath);
            const originalSize = buffer.length;
            this.metrics.originalSizes[filePath] = originalSize;

            // Simple optimization: remove PNG metadata chunks that aren't critical
            // This is a basic implementation - in production, use dedicated libraries
            const optimizedBuffer = this.stripPNGMetadata(buffer);
            
            if (optimizedBuffer.length < originalSize) {
                fs.writeFileSync(filePath, optimizedBuffer);
                this.metrics.optimizedSizes[filePath] = optimizedBuffer.length;
                const savings = ((originalSize - optimizedBuffer.length) / originalSize * 100).toFixed(2);
                console.log(`✅ Optimized ${path.basename(filePath)}: ${this.formatBytes(originalSize)} → ${this.formatBytes(optimizedBuffer.length)} (${savings}% reduction)`);
            } else {
                this.metrics.optimizedSizes[filePath] = originalSize;
                console.log(`ℹ️  ${path.basename(filePath)} already optimized`);
            }
        } catch (error) {
            console.error(`❌ Error optimizing ${filePath}:`, error.message);
        }
    }

    /**
     * Strip unnecessary metadata from PNG files
     */
    stripPNGMetadata(buffer) {
        if (!this.isPNG(buffer)) return buffer;

        const chunks = [];
        let offset = 8; // Skip PNG signature

        // Parse PNG chunks
        while (offset < buffer.length) {
            if (offset + 8 > buffer.length) break;

            const length = buffer.readUInt32BE(offset);
            const type = buffer.toString('ascii', offset + 4, offset + 8);
            
            // Keep essential chunks, remove metadata chunks
            const keepChunk = ['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type);
            
            if (keepChunk) {
                const chunkData = buffer.slice(offset, offset + 12 + length);
                chunks.push(chunkData);
            }

            offset += 12 + length;
        }

        // Reconstruct PNG
        const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        return Buffer.concat([signature, ...chunks]);
    }

    /**
     * Check if buffer is a PNG file
     */
    isPNG(buffer) {
        return buffer.length >= 8 && 
               buffer[0] === 0x89 && buffer[1] === 0x50 && 
               buffer[2] === 0x4E && buffer[3] === 0x47;
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Optimize all images in the project
     */
    async optimizeAllImages() {
        console.log('🖼️  Starting image optimization...\n');

        const imageFiles = [
            'banner.png',
            'examples/abonnements.png',
            'examples/abonner.png',
            'examples/désabonner.png',
            'examples/notif.png'
        ];

        for (const file of imageFiles) {
            if (fs.existsSync(file)) {
                await this.optimizeImage(file);
            }
        }

        this.printOptimizationReport();
    }

    /**
     * Print optimization report
     */
    printOptimizationReport() {
        console.log('\n📊 Optimization Report:');
        console.log('═'.repeat(50));

        let totalOriginal = 0;
        let totalOptimized = 0;

        for (const [file, originalSize] of Object.entries(this.metrics.originalSizes)) {
            const optimizedSize = this.metrics.optimizedSizes[file];
            totalOriginal += originalSize;
            totalOptimized += optimizedSize;
            
            const savings = originalSize > optimizedSize ? 
                `(-${((originalSize - optimizedSize) / originalSize * 100).toFixed(1)}%)` : 
                '(no change)';
            
            console.log(`${path.basename(file).padEnd(20)} ${this.formatBytes(originalSize).padStart(8)} → ${this.formatBytes(optimizedSize).padStart(8)} ${savings}`);
        }

        const totalSavings = totalOriginal > totalOptimized ? 
            ((totalOriginal - totalOptimized) / totalOriginal * 100).toFixed(2) : 0;

        console.log('─'.repeat(50));
        console.log(`Total:                   ${this.formatBytes(totalOriginal).padStart(8)} → ${this.formatBytes(totalOptimized).padStart(8)} (-${totalSavings}%)`);
        console.log(`Total saved:             ${this.formatBytes(totalOriginal - totalOptimized)}`);
    }

    /**
     * Generate performance recommendations
     */
    generateRecommendations() {
        console.log('\n💡 Performance Recommendations:');
        console.log('═'.repeat(50));

        const recommendations = [
            '• Use PM2 for production deployment with cluster mode',
            '• Enable Node.js V8 heap snapshots for memory analysis',
            '• Consider implementing Redis for caching API responses',
            '• Use compression middleware if serving HTTP content',
            '• Monitor memory usage with clinic.js tools',
            '• Implement graceful shutdown handlers (✅ Done)',
            '• Add rate limiting for API requests (✅ Done)',
            '• Use structured logging instead of console.log',
            '• Consider WebP format for better image compression',
            '• Implement health check endpoints for monitoring'
        ];

        recommendations.forEach(rec => console.log(rec));
    }

    /**
     * Create performance monitoring configuration
     */
    createMonitoringConfig() {
        const pm2Config = {
            apps: [{
                name: 'vinted-discord-bot',
                script: 'index.js',
                instances: 1,
                exec_mode: 'fork',
                max_memory_restart: '512M',
                error_file: 'logs/error.log',
                out_file: 'logs/out.log',
                log_file: 'logs/combined.log',
                time: true,
                env: {
                    NODE_ENV: 'production'
                },
                env_development: {
                    NODE_ENV: 'development'
                }
            }]
        };

        fs.writeFileSync('ecosystem.config.js', `module.exports = ${JSON.stringify(pm2Config, null, 2)};`);
        console.log('✅ Created PM2 configuration: ecosystem.config.js');

        // Create logs directory
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
            console.log('✅ Created logs directory');
        }
    }

    /**
     * Run all optimizations
     */
    async runAll() {
        console.log('🚀 Starting performance optimization...\n');

        await this.optimizeAllImages();
        this.createMonitoringConfig();
        this.generateRecommendations();

        const endTime = process.hrtime(this.metrics.startTime);
        const executionTime = (endTime[0] * 1000 + endTime[1] / 1000000).toFixed(2);
        
        console.log(`\n⚡ Optimization completed in ${executionTime}ms`);
    }
}

// Run optimization if this script is executed directly
if (require.main === module) {
    const optimizer = new PerformanceOptimizer();
    optimizer.runAll().catch(console.error);
}

module.exports = PerformanceOptimizer;