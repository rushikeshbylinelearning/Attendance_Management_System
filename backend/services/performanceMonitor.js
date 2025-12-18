// Performance monitoring service for production optimization
const os = require('os');
const fs = require('fs').promises;

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        slowQueries: 0,
      },
      memory: {
        used: 0,
        free: 0,
        total: 0,
        percentage: 0,
      },
      database: {
        connections: 0,
        slowQueries: 0,
        queryTime: 0,
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
      },
      errors: {
        total: 0,
        byType: {},
      },
    };

    this.startTime = Date.now();
    this.requestTimes = [];
    this.slowQueries = [];
    this.errorLog = [];

    // Start monitoring
    this.startMonitoring();
  }

  // Start performance monitoring
  startMonitoring() {
    // Monitor memory usage every minute
    setInterval(() => {
      this.updateMemoryMetrics();
    }, 60000);

    // Monitor system resources every 5 minutes
    setInterval(() => {
      this.logSystemMetrics();
    }, 300000);

    // Clean up old metrics every hour
    setInterval(() => {
      this.cleanupMetrics();
    }, 3600000);
  }

  // Track request performance
  trackRequest(req, res, next) {
    const startTime = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      this.recordRequest(req, res, duration);
    });

    next();
  }

  // Record request metrics
  recordRequest(req, res, duration) {
    this.metrics.requests.total++;
    
    if (res.statusCode >= 200 && res.statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Track response times
    this.requestTimes.push(duration);
    
    // Keep only last 1000 requests
    if (this.requestTimes.length > 1000) {
      this.requestTimes = this.requestTimes.slice(-1000);
    }

    // Update average response time
    this.metrics.requests.averageResponseTime = 
      this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length;

    // Track slow requests
    if (duration > 1000) { // Slower than 1 second
      this.metrics.requests.slowQueries++;
      this.slowQueries.push({
        url: req.url,
        method: req.method,
        duration,
        timestamp: new Date(),
        userAgent: req.get('User-Agent'),
      });

      // Keep only last 100 slow queries
      if (this.slowQueries.length > 100) {
        this.slowQueries = this.slowQueries.slice(-100);
      }
    }
  }

  // Track database query performance
  trackDatabaseQuery(query, duration) {
    this.metrics.database.queryTime += duration;
    
    if (duration > 100) { // Slower than 100ms
      this.metrics.database.slowQueries++;
    }
  }

  // Track cache performance
  trackCacheHit() {
    this.metrics.cache.hits++;
    this.updateCacheHitRate();
  }

  trackCacheMiss() {
    this.metrics.cache.misses++;
    this.updateCacheHitRate();
  }

  updateCacheHitRate() {
    const total = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = total > 0 ? (this.metrics.cache.hits / total) * 100 : 0;
  }

  // Track errors
  trackError(error, context = {}) {
    this.metrics.errors.total++;
    
    const errorType = error.constructor.name;
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;

    this.errorLog.push({
      error: error.message,
      stack: error.stack,
      type: errorType,
      context,
      timestamp: new Date(),
    });

    // Keep only last 100 errors
    if (this.errorLog.length > 100) {
      this.errorLog = this.errorLog.slice(-100);
    }
  }

  // Update memory metrics
  updateMemoryMetrics() {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    this.metrics.memory = {
      used: Math.round(usedMem / 1024 / 1024), // MB
      free: Math.round(freeMem / 1024 / 1024), // MB
      total: Math.round(totalMem / 1024 / 1024), // MB
      percentage: Math.round((usedMem / totalMem) * 100),
      process: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
      },
    };

    // Alert if memory usage is high
    if (this.metrics.memory.percentage > 80) {
      console.warn(`⚠️  High memory usage: ${this.metrics.memory.percentage}%`);
    }
  }

  // Log system metrics
  async logSystemMetrics() {
    const cpuUsage = await this.getCpuUsage();
    const diskUsage = await this.getDiskUsage();
    
    console.log('📊 System Metrics:', {
      uptime: Math.round(process.uptime()),
      memory: this.metrics.memory,
      cpu: cpuUsage,
      disk: diskUsage,
      requests: {
        total: this.metrics.requests.total,
        averageResponseTime: Math.round(this.metrics.requests.averageResponseTime),
        slowQueries: this.metrics.requests.slowQueries,
      },
      cache: {
        hitRate: Math.round(this.metrics.cache.hitRate * 100) / 100,
      },
    });
  }

  // Get CPU usage
  async getCpuUsage() {
    return new Promise((resolve) => {
      const startMeasure = process.cpuUsage();
      const startTime = Date.now();

      setTimeout(() => {
        const endMeasure = process.cpuUsage(startMeasure);
        const endTime = Date.now();
        
        const cpuPercent = (endMeasure.user + endMeasure.system) / 1000 / (endTime - startTime) * 100;
        resolve(Math.round(cpuPercent * 100) / 100);
      }, 100);
    });
  }

  // Get disk usage
  async getDiskUsage() {
    try {
      const stats = await fs.stat('.');
      return {
        available: true,
        // Add more disk metrics as needed
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  // Get performance metrics
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Math.round(process.uptime()),
      timestamp: new Date(),
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        pid: process.pid,
      },
    };
  }

  // Get health status
  getHealthStatus() {
    const isHealthy = 
      this.metrics.memory.percentage < 90 &&
      this.metrics.requests.averageResponseTime < 2000 &&
      this.metrics.errors.total < 100;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      checks: {
        memory: this.metrics.memory.percentage < 90,
        responseTime: this.metrics.requests.averageResponseTime < 2000,
        errors: this.metrics.errors.total < 100,
      },
      metrics: this.getMetrics(),
    };
  }

  // Get slow queries
  getSlowQueries(limit = 10) {
    return this.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  // Get recent errors
  getRecentErrors(limit = 10) {
    return this.errorLog
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Cleanup old metrics
  cleanupMetrics() {
    // Keep only last 24 hours of data
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    this.slowQueries = this.slowQueries.filter(q => q.timestamp > oneDayAgo);
    this.errorLog = this.errorLog.filter(e => e.timestamp > oneDayAgo);
    
    console.log('🧹 Cleaned up old performance metrics');
  }

  // Reset metrics
  resetMetrics() {
    this.metrics = {
      requests: { total: 0, successful: 0, failed: 0, averageResponseTime: 0, slowQueries: 0 },
      memory: { used: 0, free: 0, total: 0, percentage: 0 },
      database: { connections: 0, slowQueries: 0, queryTime: 0 },
      cache: { hits: 0, misses: 0, hitRate: 0 },
      errors: { total: 0, byType: {} },
    };
    
    this.requestTimes = [];
    this.slowQueries = [];
    this.errorLog = [];
    this.startTime = Date.now();
    
    console.log('🔄 Performance metrics reset');
  }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;
