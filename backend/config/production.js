// Production configuration for backend optimization
const path = require('path');

const productionConfig = {
  // Database optimization
  database: {
    // Connection pool settings
    maxPoolSize: 10,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    bufferMaxEntries: 0,
    bufferCommands: false,
    
    // Index optimization
    autoIndex: false,
    autoCreate: false,
  },

  // Caching configuration
  cache: {
    // Redis configuration (if using Redis)
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    },
    
    // In-memory cache settings
    memory: {
      userCache: { ttl: 300, maxKeys: 1000 },
      attendanceCache: { ttl: 180, maxKeys: 2000 },
      dashboardCache: { ttl: 120, maxKeys: 500 },
      settingsCache: { ttl: 1800, maxKeys: 100 },
      reportsCache: { ttl: 600, maxKeys: 200 },
    }
  },

  // Security settings
  security: {
    // Rate limiting
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    },
    
    // CORS settings
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://your-frontend-domain.com'],
      credentials: true,
      optionsSuccessStatus: 200,
    },
    
    // Helmet settings
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    },
  },

  // Logging configuration
  logging: {
    level: 'info',
    format: 'combined',
    maxFiles: 5,
    maxSize: '10m',
    datePattern: 'YYYY-MM-DD',
    compress: true,
  },

  // Performance monitoring
  monitoring: {
    enableMetrics: true,
    metricsInterval: 60000, // 1 minute
    slowQueryThreshold: 100, // 100ms
    memoryWarningThreshold: 0.8, // 80% of available memory
  },

  // File upload optimization
  upload: {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      files: 1,
    },
    fileFilter: (req, file, cb) => {
      // Only allow specific file types
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type'), false);
      }
    },
  },

  // Session configuration
  session: {
    secret: process.env.SESSION_SECRET || 'your-super-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'strict',
    },
  },

  // Compression settings
  compression: {
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return true;
    },
  },

  // Static file serving
  static: {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      // Set security headers for static files
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Note: X-Frame-Options removed - using CSP frame-ancestors instead (configured in security.js)
      // This allows embedding from SSO Portal at http://localhost:5175
      res.setHeader('X-XSS-Protection', '1; mode=block');
    },
  },

  // API optimization
  api: {
    // Response compression
    compressResponses: true,
    
    // Request size limits
    jsonLimit: '10mb',
    urlencodedLimit: '10mb',
    
    // Timeout settings
    timeout: 30000, // 30 seconds
    
    // Pagination defaults
    defaultPageSize: 20,
    maxPageSize: 100,
  },

  // WebSocket optimization
  websocket: {
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6, // 1MB
    allowEIO3: true,
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['https://your-frontend-domain.com'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  },

  // Background job settings
  jobs: {
    concurrency: 5,
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },

  // Health check settings
  healthCheck: {
    timeout: 5000,
    interval: 30000,
    retries: 3,
  },
};

module.exports = productionConfig;
