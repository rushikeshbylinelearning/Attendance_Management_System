// Advanced caching service for performance optimization
const NodeCache = require('node-cache');

class CacheService {
  constructor() {
    // Different cache instances for different data types
    this.userCache = new NodeCache({ 
      stdTTL: 300, // 5 minutes
      checkperiod: 60, // Check for expired keys every minute
      useClones: false // Better performance
    });
    
    this.attendanceCache = new NodeCache({ 
      stdTTL: 180, // 3 minutes
      checkperiod: 60,
      useClones: false
    });
    
    this.dashboardCache = new NodeCache({ 
      stdTTL: 120, // 2 minutes
      checkperiod: 30,
      useClones: false
    });
    
    this.settingsCache = new NodeCache({ 
      stdTTL: 1800, // 30 minutes
      checkperiod: 300,
      useClones: false
    });
    
    this.reportsCache = new NodeCache({ 
      stdTTL: 600, // 10 minutes
      checkperiod: 120,
      useClones: false
    });

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };

    // Set up event listeners for statistics
    this.setupEventListeners();
  }

  setupEventListeners() {
    const caches = [this.userCache, this.attendanceCache, this.dashboardCache, this.settingsCache, this.reportsCache];
    
    caches.forEach(cache => {
      cache.on('set', () => this.stats.sets++);
      cache.on('del', () => this.stats.deletes++);
      cache.on('hit', () => this.stats.hits++);
      cache.on('miss', () => this.stats.misses++);
    });
  }

  // User-related caching
  getUser(userId) {
    return this.userCache.get(`user_${userId}`);
  }

  setUser(userId, userData) {
    this.userCache.set(`user_${userId}`, userData);
  }

  getUsersByRole(role) {
    return this.userCache.get(`users_role_${role}`);
  }

  setUsersByRole(role, users) {
    this.userCache.set(`users_role_${role}`, users);
  }

  // Attendance-related caching
  getAttendanceLog(userId, date) {
    return this.attendanceCache.get(`attendance_${userId}_${date}`);
  }

  setAttendanceLog(userId, date, logData) {
    this.attendanceCache.set(`attendance_${userId}_${date}`, logData);
  }

  getTodayAttendance(date) {
    return this.attendanceCache.get(`today_attendance_${date}`);
  }

  setTodayAttendance(date, attendanceData) {
    this.attendanceCache.set(`today_attendance_${date}`, attendanceData);
  }

  getWhosInList(date) {
    return this.attendanceCache.get(`whos_in_${date}`);
  }

  setWhosInList(date, whosInData) {
    this.attendanceCache.set(`whos_in_${date}`, whosInData);
  }

  // Dashboard caching
  getDashboardSummary(date) {
    return this.dashboardCache.get(`dashboard_${date}`);
  }

  setDashboardSummary(date, summaryData) {
    this.dashboardCache.set(`dashboard_${date}`, summaryData);
  }

  getRecentActivity(date) {
    return this.dashboardCache.get(`recent_activity_${date}`);
  }

  setRecentActivity(date, activityData) {
    this.dashboardCache.set(`recent_activity_${date}`, activityData);
  }

  // Settings caching
  getSetting(key) {
    return this.settingsCache.get(`setting_${key}`);
  }

  setSetting(key, value) {
    this.settingsCache.set(`setting_${key}`, value);
  }

  getAllSettings() {
    return this.settingsCache.get('all_settings');
  }

  setAllSettings(settings) {
    this.settingsCache.set('all_settings', settings);
  }

  // Reports caching
  getReport(reportType, params) {
    const key = `report_${reportType}_${JSON.stringify(params)}`;
    return this.reportsCache.get(key);
  }

  setReport(reportType, params, reportData) {
    const key = `report_${reportType}_${JSON.stringify(params)}`;
    this.reportsCache.set(key, reportData);
  }

  // Generic caching methods
  get(cacheType, key) {
    const cache = this.getCacheInstance(cacheType);
    return cache ? cache.get(key) : null;
  }

  set(cacheType, key, value, ttl = null) {
    const cache = this.getCacheInstance(cacheType);
    if (cache) {
      if (ttl) {
        cache.set(key, value, ttl);
      } else {
        cache.set(key, value);
      }
    }
  }

  del(cacheType, key) {
    const cache = this.getCacheInstance(cacheType);
    if (cache) {
      cache.del(key);
    }
  }

  // Clear specific cache or all caches
  clear(cacheType = null, pattern = null) {
    if (cacheType) {
      const cache = this.getCacheInstance(cacheType);
      if (cache) {
        if (pattern) {
          const keys = cache.keys();
          keys.forEach(key => {
            if (key.includes(pattern)) {
              cache.del(key);
            }
          });
        } else {
          cache.flushAll();
        }
      }
    } else {
      // Clear all caches
      Object.values(this.getAllCaches()).forEach(cache => cache.flushAll());
    }
  }

  // Cache invalidation helpers
  invalidateUser(userId) {
    this.userCache.del(`user_${userId}`);
    // Also clear role-based caches
    const keys = this.userCache.keys();
    keys.forEach(key => {
      if (key.startsWith('users_role_')) {
        this.userCache.del(key);
      }
    });
  }

  invalidateAttendance(userId = null, date = null) {
    if (userId && date) {
      this.attendanceCache.del(`attendance_${userId}_${date}`);
    } else if (userId) {
      const keys = this.attendanceCache.keys();
      keys.forEach(key => {
        if (key.includes(`_${userId}_`)) {
          this.attendanceCache.del(key);
        }
      });
    } else if (date) {
      const keys = this.attendanceCache.keys();
      keys.forEach(key => {
        if (key.includes(date)) {
          this.attendanceCache.del(key);
        }
      });
    } else {
      this.attendanceCache.flushAll();
    }
  }

  invalidateDashboard(date = null) {
    if (date) {
      this.dashboardCache.del(`dashboard_${date}`);
      this.dashboardCache.del(`recent_activity_${date}`);
    } else {
      this.dashboardCache.flushAll();
    }
  }

  invalidateSettings() {
    this.settingsCache.flushAll();
  }

  invalidateReports(reportType = null) {
    if (reportType) {
      const keys = this.reportsCache.keys();
      keys.forEach(key => {
        if (key.includes(`report_${reportType}_`)) {
          this.reportsCache.del(key);
        }
      });
    } else {
      this.reportsCache.flushAll();
    }
  }

  // Helper methods
  getCacheInstance(cacheType) {
    const cacheMap = {
      'user': this.userCache,
      'attendance': this.attendanceCache,
      'dashboard': this.dashboardCache,
      'settings': this.settingsCache,
      'reports': this.reportsCache
    };
    return cacheMap[cacheType] || null;
  }

  getAllCaches() {
    return {
      userCache: this.userCache,
      attendanceCache: this.attendanceCache,
      dashboardCache: this.dashboardCache,
      settingsCache: this.settingsCache,
      reportsCache: this.reportsCache
    };
  }

  // Get cache statistics
  getStats() {
    const cacheStats = {};
    const caches = this.getAllCaches();
    
    Object.entries(caches).forEach(([name, cache]) => {
      cacheStats[name] = cache.getStats();
    });

    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) * 100,
      cacheStats
    };
  }

  // Health check
  isHealthy() {
    try {
      // Test cache functionality
      const testKey = 'health_check';
      const testValue = Date.now();
      
      this.userCache.set(testKey, testValue, 10);
      const retrieved = this.userCache.get(testKey);
      this.userCache.del(testKey);
      
      return retrieved === testValue;
    } catch (error) {
      console.error('Cache health check failed:', error);
      return false;
    }
  }

  // Memory usage monitoring
  getMemoryUsage() {
    const caches = this.getAllCaches();
    const memoryUsage = {};
    
    Object.entries(caches).forEach(([name, cache]) => {
      memoryUsage[name] = {
        keys: cache.keys().length,
        stats: cache.getStats()
      };
    });
    
    return memoryUsage;
  }
}

// Create singleton instance
const cacheService = new CacheService();

module.exports = cacheService;
