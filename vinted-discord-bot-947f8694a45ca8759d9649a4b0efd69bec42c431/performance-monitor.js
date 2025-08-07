const EventEmitter = require('events');

/**
 * Performance Monitor for Discord Bot
 * Tracks memory usage, API response times, and provides simple caching
 */
class PerformanceMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            memoryCheckInterval: options.memoryCheckInterval || 30000, // 30 seconds
            cacheMaxSize: options.cacheMaxSize || 100,
            cacheTTL: options.cacheTTL || 300000, // 5 minutes
            memoryThreshold: options.memoryThreshold || 400 * 1024 * 1024, // 400MB
            ...options
        };

        this.metrics = {
            requests: 0,
            errors: 0,
            avgResponseTime: 0,
            responseTimes: [],
            lastMemoryCheck: null,
            startTime: Date.now()
        };

        this.cache = new Map();
        this.memoryInterval = null;

        this.startMonitoring();
    }

    /**
     * Start performance monitoring
     */
    startMonitoring() {
        this.memoryInterval = setInterval(() => {
            this.checkMemoryUsage();
        }, this.options.memoryCheckInterval);

        // Clean up cache periodically
        setInterval(() => {
            this.cleanCache();
        }, 60000); // Every minute
    }

    /**
     * Stop performance monitoring
     */
    stopMonitoring() {
        if (this.memoryInterval) {
            clearInterval(this.memoryInterval);
            this.memoryInterval = null;
        }
    }

    /**
     * Track API request timing
     */
    trackRequest(startTime = Date.now()) {
        return {
            end: () => {
                const responseTime = Date.now() - startTime;
                this.metrics.requests++;
                this.metrics.responseTimes.push(responseTime);
                
                // Keep only last 100 response times for rolling average
                if (this.metrics.responseTimes.length > 100) {
                    this.metrics.responseTimes.shift();
                }
                
                // Calculate average response time
                this.metrics.avgResponseTime = 
                    this.metrics.responseTimes.reduce((a, b) => a + b, 0) / 
                    this.metrics.responseTimes.length;

                this.emit('request', { responseTime, avgResponseTime: this.metrics.avgResponseTime });
                
                return responseTime;
            }
        };
    }

    /**
     * Track errors
     */
    trackError(error) {
        this.metrics.errors++;
        this.emit('error', { error, errorCount: this.metrics.errors });
    }

    /**
     * Check memory usage and emit warnings if threshold exceeded
     */
    checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        this.metrics.lastMemoryCheck = memUsage;

        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
        const externalMB = memUsage.external / 1024 / 1024;

        if (memUsage.heapUsed > this.options.memoryThreshold) {
            this.emit('memoryWarning', {
                heapUsed: heapUsedMB.toFixed(2),
                heapTotal: heapTotalMB.toFixed(2),
                external: externalMB.toFixed(2),
                threshold: (this.options.memoryThreshold / 1024 / 1024).toFixed(2)
            });
        }

        this.emit('memoryCheck', {
            heapUsed: heapUsedMB.toFixed(2),
            heapTotal: heapTotalMB.toFixed(2),
            external: externalMB.toFixed(2)
        });
    }

    /**
     * Simple cache implementation
     */
    set(key, value, ttl = this.options.cacheTTL) {
        // Remove oldest entries if cache is full
        if (this.cache.size >= this.options.cacheMaxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl
        });
    }

    /**
     * Get value from cache
     */
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;
        
        // Check if expired
        if (Date.now() - item.timestamp > item.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return item.value;
    }

    /**
     * Check if key exists in cache and is not expired
     */
    has(key) {
        return this.get(key) !== null;
    }

    /**
     * Clear expired cache entries
     */
    cleanCache() {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > item.ttl) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.emit('cacheClean', { cleaned, remaining: this.cache.size });
        }
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        const uptime = Date.now() - this.metrics.startTime;
        const uptimeHours = (uptime / (1000 * 60 * 60)).toFixed(2);

        return {
            ...this.metrics,
            uptime: uptimeHours,
            cacheSize: this.cache.size,
            errorRate: this.metrics.requests > 0 ? 
                (this.metrics.errors / this.metrics.requests * 100).toFixed(2) : 0
        };
    }

    /**
     * Create performance report
     */
    createReport() {
        const metrics = this.getMetrics();
        const memory = this.metrics.lastMemoryCheck;

        return {
            timestamp: new Date().toISOString(),
            uptime: `${metrics.uptime} hours`,
            requests: metrics.requests,
            errors: metrics.errors,
            errorRate: `${metrics.errorRate}%`,
            avgResponseTime: `${Math.round(metrics.avgResponseTime)}ms`,
            memory: memory ? {
                heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                heapTotal: `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                external: `${(memory.external / 1024 / 1024).toFixed(2)} MB`
            } : null,
            cache: {
                size: metrics.cacheSize,
                maxSize: this.options.cacheMaxSize
            }
        };
    }

    /**
     * Force garbage collection if available
     */
    forceGC() {
        if (global.gc) {
            global.gc();
            this.emit('gcForced');
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.options.cacheMaxSize,
            utilization: ((this.cache.size / this.options.cacheMaxSize) * 100).toFixed(2)
        };
    }
}

module.exports = PerformanceMonitor;