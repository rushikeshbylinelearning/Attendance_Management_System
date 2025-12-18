// Database optimization utilities
const mongoose = require('mongoose');

// Cache for frequently accessed data
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Optimized query helper
class DatabaseOptimizer {
  static async findWithCache(model, query, options = {}, cacheKey = null) {
    // Generate cache key if not provided
    if (!cacheKey) {
      cacheKey = `${model.modelName}_${JSON.stringify(query)}_${JSON.stringify(options)}`;
    }

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // Execute optimized query
    const queryBuilder = model.find(query);

    // Apply lean() for better performance (returns plain JS objects)
    if (options.lean !== false) {
      queryBuilder.lean();
    }

    // Apply projection to limit fields
    if (options.select) {
      queryBuilder.select(options.select);
    }

    // Apply population
    if (options.populate) {
      if (Array.isArray(options.populate)) {
        options.populate.forEach(pop => queryBuilder.populate(pop));
      } else {
        queryBuilder.populate(options.populate);
      }
    }

    // Apply sorting
    if (options.sort) {
      queryBuilder.sort(options.sort);
    }

    // Apply limit
    if (options.limit) {
      queryBuilder.limit(options.limit);
    }

    // Apply skip for pagination
    if (options.skip) {
      queryBuilder.skip(options.skip);
    }

    const result = await queryBuilder.exec();

    // Cache the result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }

  static async findOneWithCache(model, query, options = {}, cacheKey = null) {
    if (!cacheKey) {
      cacheKey = `${model.modelName}_one_${JSON.stringify(query)}_${JSON.stringify(options)}`;
    }

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const queryBuilder = model.findOne(query);

    if (options.lean !== false) {
      queryBuilder.lean();
    }

    if (options.select) {
      queryBuilder.select(options.select);
    }

    if (options.populate) {
      queryBuilder.populate(options.populate);
    }

    const result = await queryBuilder.exec();

    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }

  static async aggregateWithCache(model, pipeline, cacheKey = null) {
    if (!cacheKey) {
      cacheKey = `${model.modelName}_agg_${JSON.stringify(pipeline)}`;
    }

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const result = await model.aggregate(pipeline).exec();

    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }

  // Clear cache for specific model or all cache
  static clearCache(modelName = null) {
    if (modelName) {
      for (const [key] of cache) {
        if (key.startsWith(modelName)) {
          cache.delete(key);
        }
      }
    } else {
      cache.clear();
    }
  }

  // Get cache statistics
  static getCacheStats() {
    return {
      size: cache.size,
      keys: Array.from(cache.keys())
    };
  }
}

// Enhanced database indexes optimization
const createIndexes = async () => {
  try {
    const User = require('../models/User');
    const AttendanceLog = require('../models/AttendanceLog');
    const AttendanceSession = require('../models/AttendanceSession');
    const LeaveRequest = require('../models/LeaveRequest');
    const BreakLog = require('../models/BreakLog');
    const ExtraBreakRequest = require('../models/ExtraBreakRequest');
    const NewNotification = require('../models/NewNotification');
    const OfficeLocation = require('../models/OfficeLocation');
    const Setting = require('../models/Setting');
    const Shift = require('../models/Shift');
    const Holiday = require('../models/Holiday');
    const ExcelLog = require('../models/ExcelLog');

    // Helper function to check if index exists and create if not
    const createIndexIfNotExists = async (collection, indexSpec, options = {}) => {
      const indexName = options.name || Object.keys(indexSpec).map(key => `${key}_${indexSpec[key]}`).join('_');
      
      try {
        const existingIndexes = await collection.indexes();
        
        // Check if an index with the same key pattern already exists
        const indexKeyString = JSON.stringify(indexSpec);
        const existingIndex = existingIndexes.find(index => {
          const existingKeyString = JSON.stringify(index.key);
          return existingKeyString === indexKeyString;
        });
        
        if (existingIndex) {
          console.log(`ℹ️  Index already exists with name: ${existingIndex.name} (key: ${indexKeyString})`);
          return;
        }
        
        // Check if an index with the same name already exists
        const indexWithSameName = existingIndexes.find(index => index.name === indexName);
        if (indexWithSameName) {
          console.log(`ℹ️  Index with name ${indexName} already exists but with different key pattern`);
          return;
        }
        
        // Create the index if it doesn't exist
        await collection.createIndex(indexSpec, options);
        console.log(`✅ Created index: ${indexName}`);
        
      } catch (error) {
        // Handle specific MongoDB index conflict errors
        if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
          console.log(`ℹ️  Index conflict resolved - index already exists: ${indexName}`);
          return;
        }
        
        // Handle invalid index specification errors
        if (error.code === 67 || error.codeName === 'CannotCreateIndex') {
          console.log(`⚠️  Skipping invalid index: ${indexName} - ${error.message}`);
          return;
        }
        
        console.error(`❌ Error creating index ${indexName}:`, error);
        throw error;
      }
    };

    console.log('🚀 Creating database indexes for performance optimization...');

    // User indexes - Critical for authentication and user queries
    await createIndexIfNotExists(User.collection, { email: 1 }, { unique: true, name: "email_unique" });
    await createIndexIfNotExists(User.collection, { employeeCode: 1 }, { unique: true, sparse: true, name: "employeeCode_unique" });
    await createIndexIfNotExists(User.collection, { role: 1, isActive: 1 }, { name: "role_active" });
    await createIndexIfNotExists(User.collection, { isActive: 1 }, { name: "isActive" });
    await createIndexIfNotExists(User.collection, { department: 1, isActive: 1 }, { name: "department_active" });
    await createIndexIfNotExists(User.collection, { shiftGroup: 1, isActive: 1 }, { name: "shiftGroup_active" });
    await createIndexIfNotExists(User.collection, { authMethod: 1 }, { name: "authMethod" });

    // AttendanceLog indexes - Critical for attendance queries
    await createIndexIfNotExists(AttendanceLog.collection, { userId: 1, attendanceDate: 1 }, { name: "user_date" });
    await createIndexIfNotExists(AttendanceLog.collection, { attendanceDate: 1, status: 1 }, { name: "date_status" });
    await createIndexIfNotExists(AttendanceLog.collection, { userId: 1, attendanceDate: -1 }, { name: "user_date_desc" });
    await createIndexIfNotExists(AttendanceLog.collection, { attendanceDate: -1 }, { name: "date_desc" });
    await createIndexIfNotExists(AttendanceLog.collection, { status: 1, attendanceDate: 1 }, { name: "status_date" });
    await createIndexIfNotExists(AttendanceLog.collection, { 'sessions.startTime': 1 }, { name: "session_start" });
    await createIndexIfNotExists(AttendanceLog.collection, { 'sessions.endTime': 1 }, { name: "session_end" });
    await createIndexIfNotExists(AttendanceLog.collection, { createdAt: -1 }, { name: "created_desc" });

    // AttendanceSession indexes - For session tracking
    await createIndexIfNotExists(AttendanceSession.collection, { attendanceLog: 1, endTime: 1 }, { name: "log_endTime" });
    // Note: Cannot create index on { endTime: null } - MongoDB doesn't allow null values in index keys
    // For active sessions (where endTime is null), use: { endTime: { $exists: false } } or { endTime: null }
    // The endTime index will help with queries that check for existing endTime values
    await createIndexIfNotExists(AttendanceSession.collection, { endTime: 1 }, { name: "endTime_index" });
    await createIndexIfNotExists(AttendanceSession.collection, { startTime: -1 }, { name: "startTime_desc" });

    // LeaveRequest indexes - For leave management
    await createIndexIfNotExists(LeaveRequest.collection, { employee: 1, startDate: 1 }, { name: "employee_startDate" });
    await createIndexIfNotExists(LeaveRequest.collection, { status: 1, startDate: 1 }, { name: "status_startDate" });
    await createIndexIfNotExists(LeaveRequest.collection, { startDate: 1, endDate: 1 }, { name: "date_range" });
    await createIndexIfNotExists(LeaveRequest.collection, { status: 1, createdAt: -1 }, { name: "status_created" });
    await createIndexIfNotExists(LeaveRequest.collection, { isBackdated: 1, status: 1 }, { name: "backdated_status" });
    await createIndexIfNotExists(LeaveRequest.collection, { leaveType: 1, status: 1 }, { name: "leaveType_status" });

    // BreakLog indexes - For break tracking
    await createIndexIfNotExists(BreakLog.collection, { attendanceLog: 1, breakType: 1 }, { name: "log_breakType" });
    await createIndexIfNotExists(BreakLog.collection, { startTime: 1, endTime: 1 }, { name: "break_times" });
    await createIndexIfNotExists(BreakLog.collection, { breakType: 1, startTime: -1 }, { name: "breakType_time" });

    // ExtraBreakRequest indexes - For extra break requests
    await createIndexIfNotExists(ExtraBreakRequest.collection, { user: 1, status: 1 }, { name: "user_status" });
    await createIndexIfNotExists(ExtraBreakRequest.collection, { status: 1, createdAt: -1 }, { name: "status_created" });
    await createIndexIfNotExists(ExtraBreakRequest.collection, { requestDate: 1, status: 1 }, { name: "date_status" });

    // NewNotification indexes - For notification system
    await createIndexIfNotExists(NewNotification.collection, { userId: 1, read: 1, createdAt: -1 }, { name: "user_read_created" });
    await createIndexIfNotExists(NewNotification.collection, { recipientType: 1, read: 1, createdAt: -1 }, { name: "recipient_read_created" });
    await createIndexIfNotExists(NewNotification.collection, { expiresAt: 1 }, { name: "expiresAt" });
    await createIndexIfNotExists(NewNotification.collection, { read: 1, createdAt: -1 }, { name: "read_created" });

    // OfficeLocation indexes - For geofencing
    await createIndexIfNotExists(OfficeLocation.collection, { latitude: 1, longitude: 1 }, { name: "location_2d" });
    await createIndexIfNotExists(OfficeLocation.collection, { isActive: 1 }, { name: "location_active" });

    // Setting indexes - For application settings
    await createIndexIfNotExists(Setting.collection, { key: 1 }, { unique: true, name: "setting_key" });

    // Shift indexes - For shift management
    await createIndexIfNotExists(Shift.collection, { isActive: 1 }, { name: "shift_active" });
    await createIndexIfNotExists(Shift.collection, { shiftName: 1 }, { name: "shift_name" });

    // Holiday indexes - For holiday management
    await createIndexIfNotExists(Holiday.collection, { date: 1 }, { name: "holiday_date" });
    await createIndexIfNotExists(Holiday.collection, { isActive: 1, date: 1 }, { name: "holiday_active_date" });

    // ExcelLog indexes - For audit logging
    await createIndexIfNotExists(ExcelLog.collection, { user: 1, logType: 1 }, { name: "user_logType" });
    await createIndexIfNotExists(ExcelLog.collection, { logType: 1, createdAt: -1 }, { name: "logType_created" });
    await createIndexIfNotExists(ExcelLog.collection, { synced: 1, createdAt: 1 }, { name: "synced_created" });

    console.log('✅ All database indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating database indexes:', error);
    throw error;
  }
};

// Connection optimization
const optimizeConnection = () => {
  // Set buffer commands to false for better performance
  mongoose.set('bufferCommands', false);
  
  // Optimize connection pool
  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected with optimized settings');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
  });
};

module.exports = {
  DatabaseOptimizer,
  createIndexes,
  optimizeConnection
};
