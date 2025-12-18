// backend/server.js
require('dotenv').config();

// Validate environment variables before starting
const { validateAndExit } = require('./utils/envValidator');
validateAndExit();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const connectDB = require('./db');
const path = require('path');
const session = require('express-session');
const { startScheduledJobs } = require('./services/cronService');

// Import security and optimization modules
const { corsOptions } = require('./config/security');
const { requestLogger, logError, logger } = require('./utils/logger');
const { optimizeConnection, createIndexes } = require('./utils/database');
const { sanitizeInput } = require('./middleware/validation');
const ssoService = require('./services/ssoService');
const performanceMonitor = require('./services/performanceMonitor');
const cacheService = require('./services/cacheService');
const ssoTokenAuth = require('./middleware/ssoTokenAuth');

// Pre-load all Mongoose models
require('./models/User');
require('./models/Shift');
require('./models/AttendanceLog');
require('./models/AttendanceSession');
require('./models/BreakLog');
require('./models/LeaveRequest');
require('./models/Setting');
require('./models/ExtraBreakRequest');
require('./models/NewNotification'); // <-- THIS IS THE FIX
require('./models/Holiday');
require('./models/OfficeLocation');
// TODO: Uncomment when these models are implemented
// require('./models/LeaveYearEndAction');
// require('./models/LeaveEncashment');
// require('./models/LeaveCarryforward');

// --- Route Imports ---
const authRoutes = require('./routes/auth');
const autoLoginRoutes = require('./routes/autoLogin');
const attendanceRoutes = require('./routes/attendance');
const breakRoutes = require('./routes/breaks');
const adminRoutes = require('./routes/admin');
const employeeRoutes = require('./routes/employees');
const shiftRoutes = require('./routes/shifts');
const leaveRoutes = require('./routes/leaves');
const settingsRoutes = require('./routes/settingsRoutes');
const reportsRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const newNotificationRoutes = require('./routes/newNotifications');
const officeLocationRoutes = require('./routes/officeLocations');
const manageRoutes = require('./routes/manage');
const analyticsRoutes = require('./routes/analytics');
const payrollRoutes = require('./routes/payrollRoutes');
const probationRoutes = require('./routes/probationRoutes');
// TODO: Uncomment when yearEndLeaves route is implemented
// const yearEndLeavesRoutes = require('./routes/yearEndLeaves');

// --- Models ---
const User = require('./models/User');

// SSO Configuration
const SSO_CONFIG = {
  secret: process.env.SSO_SECRET,
  issuer: process.env.SSO_ISSUER || 'sso-portal',
  audience: process.env.SSO_AUDIENCE || 'sso-apps',
  sessionSecret: (() => {
    try {
      const sessionSecret = process.env.SESSION_SECRET;
      if (process.env.NODE_ENV === 'production' && !sessionSecret) {
        console.warn('⚠️ WARNING: SESSION_SECRET missing in production. Using unsafe fallback.');
        console.warn('⚠️ Please set SESSION_SECRET in your .env file for security.');
      }
      // Always return a valid secret to prevent crashes
      return sessionSecret || 'fallback-secret-key-CHANGE-ME';
    } catch (error) {
      // Extra safety: if anything goes wrong, use fallback and log error
      console.error('❌ Error reading SESSION_SECRET:', error.message);
      console.warn('⚠️ Using fallback session secret. Server will continue but sessions may not be secure.');
      return 'fallback-secret-key-CHANGE-ME';
    }
  })(),
  sessionMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  // New RS256/JWKS support
  jwksUrl: process.env.SSO_JWKS_URL,
  publicKey: process.env.SSO_PUBLIC_KEY,
  validateUrl: process.env.SSO_VALIDATE_URL,
};

const app = express();

app.set('trust proxy', 1);

// Enable WebSocket support by ensuring proper headers
// CRITICAL: This middleware must run BEFORE Socket.IO initialization
app.use((req, res, next) => {
  // Ensure Connection and Upgrade headers are preserved for WebSocket handshakes
  // This is critical when behind a reverse proxy (nginx/Apache)
  if (req.path.startsWith('/api/socket.io')) {
    // Log WebSocket upgrade attempts for debugging
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      // Ensure Connection header exists for WebSocket upgrade
      // Some proxies strip or modify the Connection header
      if (!req.headers.connection) {
        req.headers.connection = 'upgrade';
        if (process.env.NODE_ENV === 'development') {
          console.log('[WebSocket] Added missing Connection: upgrade header');
        }
      } else {
        const connectionHeader = req.headers.connection.toLowerCase();
        if (!connectionHeader.includes('upgrade')) {
          // Append upgrade if not present
          req.headers.connection = req.headers.connection + ', upgrade';
          if (process.env.NODE_ENV === 'development') {
            console.log('[WebSocket] Added upgrade to Connection header:', req.headers.connection);
          }
        }
      }
      
      // Also ensure Upgrade header is set
      if (!req.headers.upgrade) {
        req.headers.upgrade = 'websocket';
      }
      
      // For Socket.IO polling requests, ensure proper headers
      if (process.env.NODE_ENV === 'development') {
        console.log('[WebSocket] Request headers:', {
          upgrade: req.headers.upgrade,
          connection: req.headers.connection,
          'x-forwarded-for': req.headers['x-forwarded-for'],
          'x-forwarded-proto': req.headers['x-forwarded-proto']
        });
      }
    }
    
    // Set CORS headers for Socket.IO requests
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  }
  next();
});

// MongoDB connection will be handled in startServer() function
// Routes are registered before DB connection, but routes check DB before querying

// --- Security Middleware ---
// Get default directives and explicitly remove frame-ancestors to avoid duplicate
const defaultDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete defaultDirectives['frame-ancestors'];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...defaultDirectives,
        // Allow embedding from SSO portal - CRITICAL for iframe embedding
        'frame-ancestors': process.env.NODE_ENV === 'development' 
          ? ["'self'", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175"]
          : ["'self'", "https://sso.legatolxp.online", "https://sso.bylinelms.com", "https://sso.leagatolxp.online", "https://attendance.bylinelms.com"],
      },
    },
    // Disable X-Frame-Options since we're using CSP frame-ancestors instead
    frameguard: false,
  })
);

// Enhanced compression for production
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Compression level (0-9)
  threshold: 1024, // Only compress responses larger than 1KB
}));

app.use(cors(corsOptions));

// CRITICAL: Intercept ALL setHeader calls EARLY to prevent X-Frame-Options from being set
// This must run BEFORE any other middleware that might set headers
app.use((req, res, next) => {
  // Intercept setHeader to prevent X-Frame-Options from being set
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    if (name && name.toLowerCase() === 'x-frame-options') {
      // Silently ignore X-Frame-Options headers - never set them
      if (process.env.NODE_ENV === 'development') {
        console.log('[Server] Blocked X-Frame-Options header (allowing iframe embedding)');
      }
      return res;
    }
    return originalSetHeader.call(this, name, value);
  };
  
  // Also intercept writeHead to remove X-Frame-Options
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function(statusCode, statusMessage, headers) {
    if (headers) {
      // Remove X-Frame-Options from headers object
      if (typeof headers === 'object' && !Array.isArray(headers)) {
        delete headers['X-Frame-Options'];
        delete headers['x-frame-options'];
      }
    }
    return originalWriteHead.call(this, statusCode, statusMessage, headers);
  };
  
  // Remove X-Frame-Options before sending response
  res.on('finish', () => {
    try {
      res.removeHeader("X-Frame-Options");
    } catch (e) {
      // Ignore if header doesn't exist
    }
  });
  
  // Also remove it immediately
  try {
    res.removeHeader("X-Frame-Options");
  } catch (e) {
    // Ignore if header doesn't exist
  }
  
  next();
});

// --- ADD IFRAME EMBEDDING SUPPORT ---
// Allow embedding in iframes from SSO portal and internal apps
// This middleware ensures X-Frame-Options is removed and CSP frame-ancestors is set
// CRITICAL: This must run AFTER helmet to override any conflicting headers
app.use((req, res, next) => {
  // Force remove X-Frame-Options header (in case it was set by another middleware)
  res.removeHeader("X-Frame-Options");
  
  // Get existing CSP header (may have been set by helmet)
  let existingCSP = res.getHeader('Content-Security-Policy') || '';
  
  // Production allowed origins for iframe embedding
  const allowedOrigins = process.env.NODE_ENV === 'development' 
    ? "http://localhost:5173 http://localhost:5174 http://localhost:5175 http://127.0.0.1:5173 http://127.0.0.1:5174 http://127.0.0.1:5175"
    : "https://sso.legatolxp.online https://sso.bylinelms.com https://sso.leagatolxp.online https://attendance.bylinelms.com";
  
  // If frame-ancestors is not in CSP, add it
  // If it exists but is different, replace it
  if (!existingCSP.includes('frame-ancestors')) {
    // No frame-ancestors directive exists, add it
    if (existingCSP) {
      res.setHeader("Content-Security-Policy", `${existingCSP}; frame-ancestors ${allowedOrigins};`);
    } else {
      res.setHeader("Content-Security-Policy", `frame-ancestors ${allowedOrigins};`);
    }
  } else {
    // frame-ancestors exists, replace it to ensure correct origins
    const cspParts = existingCSP.split(';').filter(part => !part.trim().startsWith('frame-ancestors'));
    const newCSP = [...cspParts, `frame-ancestors ${allowedOrigins}`].filter(Boolean).join('; ');
    res.setHeader("Content-Security-Policy", newCSP);
  }
  
  next();
});

// CORS debugging middleware (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS' || req.headers.origin) {
      logger.info(`CORS Request: ${req.method} ${req.url} from origin: ${req.headers.origin}`);
    }
    next();
  });
}

// --- Session Middleware ---
app.use(session({
  secret: SSO_CONFIG.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production (HTTPS only)
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' in production for cross-domain SSO, 'lax' for development
    path: '/', // Ensure cookie is available for all paths
    maxAge: SSO_CONFIG.sessionMaxAge,
    // Additional settings for cross-origin compatibility
    domain: undefined // Let browser handle domain
  },
  // Additional session store options for cross-origin compatibility
  name: 'connect.sid' // Standard session cookie name
}));

// --- Request Processing Middleware ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput); // Sanitize all inputs
app.use(requestLogger); // Log all requests
app.use(performanceMonitor.trackRequest.bind(performanceMonitor)); // Track performance

// --- Rate Limiting Removed ---

// Optimized static file serving with caching
const staticOptions = {
    setHeaders: (res, filepath, stat) => {
        res.set('ngrok-skip-browser-warning', 'true');
        
        // Set cache headers based on file type
        const ext = path.extname(filepath).toLowerCase();
        
        // Images and fonts - cache for 1 year
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // CSS and JS - cache for 1 day (in case of updates)
        else if (['.css', '.js'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=86400');
        }
        // HTML - no cache (always fresh) and set iframe headers
        else if (['.html'].includes(ext)) {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            // Remove X-Frame-Options for HTML files
            res.removeHeader("X-Frame-Options");
            // Set CSP frame-ancestors for HTML files to allow iframe embedding
            const allowedOrigins = process.env.NODE_ENV === 'development' 
              ? "http://localhost:5173 http://localhost:5174 http://localhost:5175 http://127.0.0.1:5173 http://127.0.0.1:5174 http://127.0.0.1:5175"
              : "https://sso.legatolxp.online https://sso.bylinelms.com https://sso.leagatolxp.online https://attendance.bylinelms.com";
            const existingCSP = res.getHeader('Content-Security-Policy') || '';
            if (!existingCSP.includes('frame-ancestors')) {
              if (existingCSP) {
                res.setHeader("Content-Security-Policy", `${existingCSP}; frame-ancestors ${allowedOrigins};`);
              } else {
                res.setHeader("Content-Security-Policy", `frame-ancestors ${allowedOrigins};`);
              }
            }
        }
        // Everything else - cache for 1 hour
        else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        // Security headers
        res.set('X-Content-Type-Options', 'nosniff');
    },
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    etag: true,
    lastModified: true,
};

// Static file serving - MUST be before any authentication middleware
// These routes are public and should never trigger authentication
app.use('/avatars', express.static(path.join(__dirname, 'uploads/avatars'), staticOptions));
app.use('/medical-certificates', express.static(path.join(__dirname, 'uploads/medical-certificates'), staticOptions));
app.use('/public', express.static(path.join(__dirname, 'public'), staticOptions));

// Additional middleware to ensure static file routes are never processed by auth
app.use((req, res, next) => {
  // If this is a static file request and it reached here, the file doesn't exist
  // Return 404 instead of passing to auth middleware
  if (req.path.startsWith('/avatars/') || 
      req.path.startsWith('/medical-certificates/') || 
      req.path.startsWith('/public/')) {
    return res.status(404).json({ error: 'File not found' });
  }
  next();
});

// --- API ROUTE MOUNTING ---
// ============================================
// STEP 1: PUBLIC ROUTES (No SSO middleware - these handle their own authentication)
// These routes MUST be mounted BEFORE SSO middleware to allow unauthenticated access
// ============================================

// Standard auth routes (login, register, etc.)
app.use('/api/auth', authRoutes);

// SSO validation routes (part of auth)
const ssoValidationRoutes = require('./routes/ssoValidation');
app.use('/api/auth', ssoValidationRoutes);

// SSO routes (SSO-specific endpoints)
const ssoRoutes = require('./routes/ssoRoutes');
app.use('/api/sso', ssoRoutes);

// Auto-login routes (public access)
app.use('/api/auto-login', autoLoginRoutes);

// ============================================
// STEP 2: SSO AUTHENTICATION MIDDLEWARE
// This middleware PROTECTS all routes below it
// It is placed AFTER public routes to ensure login endpoints are accessible
// ============================================
app.use((req, res, next) => {
  // Exclude ALL API routes from SSO Token Check
  // All API routes use their own authentication (authenticateToken middleware)
  // SSO middleware is only for handling SSO token redirects on page routes, not API routes
  // Also exclude static file routes (avatars, medical certificates, public files)
  // Check with both trailing slash and without to handle all cases
  if (req.path.startsWith('/api/') || 
      req.path.startsWith('/api/socket.io') || 
      req.path.startsWith('/health') ||
      req.path.startsWith('/metrics') ||
      req.path.startsWith('/cache-stats') ||
      req.path.startsWith('/avatars/') ||
      req.path.startsWith('/avatars') ||
      req.path.startsWith('/medical-certificates/') ||
      req.path.startsWith('/medical-certificates') ||
      req.path.startsWith('/public/') ||
      req.path.startsWith('/public')) {
    return next();
  }
  // Apply SSO token authentication only to non-API routes (like page routes)
  // This middleware is for handling SSO token redirects, not API authentication
  return ssoTokenAuth(SSO_CONFIG)(req, res, next);
});

// ============================================
// STEP 3: PROTECTED ROUTES (Require SSO authentication)
// All routes below this point are protected by the SSO middleware above
// ============================================
app.use('/api/attendance', attendanceRoutes);
app.use('/api/breaks', breakRoutes);
app.use('/api/leaves', leaveRoutes);
// TODO: Uncomment when yearEndLeaves route is implemented
// app.use('/api/leave/year-end', yearEndLeavesRoutes);
app.use('/api/users', userRoutes);
app.use('/api/user', userRoutes);
app.use('/api/new-notifications', newNotificationRoutes); // Use new route
app.use('/api/admin/employees', employeeRoutes);
app.use('/api/admin/shifts', shiftRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/admin/reports', reportsRoutes);
app.use('/api/admin/office-locations', officeLocationRoutes);
app.use('/api/admin/manage', manageRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/probation', probationRoutes);

// Debug route registration
console.log('Routes registered:');
console.log('- /api/attendance (attendanceRoutes)');
console.log('- /api/breaks (breakRoutes)');
console.log('- /api/leaves (leaveRoutes)');
console.log('- /api/admin/manage (manageRoutes)');
console.log('- /api/admin (adminRoutes)');
console.log('✅ AMS SSO Auto-Login route initialized at /api/auto-login/launch/:appId');

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthStatus = performanceMonitor.getHealthStatus();
  const ssoJwksUrl = process.env.SSO_JWKS_URL;
  const ssoPublicKeyUrl = process.env.SSO_PUBLIC_KEY_URL;
  const ssoConfigured = !!(ssoJwksUrl || ssoPublicKeyUrl);
  
  // Check JWKS endpoint availability
  let jwksStatus = 'unknown';
  if (ssoJwksUrl) {
    try {
      const axios = require('axios');
      const response = await axios.get(ssoJwksUrl, { timeout: 5000 });
      jwksStatus = response.status === 200 ? 'OK' : 'ERROR';
    } catch (error) {
      jwksStatus = 'ERROR';
    }
  }
  
  // Check JWT keys status
  const fs = require('fs');
  const path = require('path');
  const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem';
  const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem';
  const resolvedPrivatePath = path.resolve(__dirname, privateKeyPath);
  const resolvedPublicPath = path.resolve(__dirname, publicKeyPath);
  
  const jwtKeysStatus = {
    privateKeyExists: fs.existsSync(resolvedPrivatePath),
    publicKeyExists: fs.existsSync(resolvedPublicPath),
    privateKeyPath: resolvedPrivatePath,
    publicKeyPath: resolvedPublicPath,
    keysConfigured: fs.existsSync(resolvedPrivatePath) && fs.existsSync(resolvedPublicPath)
  };
  
  res.json({
    ...healthStatus,
    ssoStatus: {
      configured: ssoConfigured,
      jwksUrl: ssoJwksUrl || null,
      jwksStatus: jwksStatus,
      publicKeyUrl: ssoPublicKeyUrl || null,
      algorithm: 'RS256',
      verificationMethod: ssoJwksUrl ? 'JWKS' : (ssoPublicKeyUrl ? 'Public Key' : 'None')
    },
    jwtKeys: jwtKeysStatus,
    database: {
      connected: mongoose.connection.readyState === 1,
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name
    },
    timestamp: new Date().toISOString(),
  });
});

// Performance metrics endpoint
app.get('/metrics', (req, res) => {
  const metrics = performanceMonitor.getMetrics();
  res.json(metrics);
});

// Cache statistics endpoint
app.get('/cache-stats', (req, res) => {
  const stats = cacheService.getStats();
  res.json(stats);
});

// SSO Logout endpoint
app.post('/sso/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Logout error:', err);
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    const redirectUrl = process.env.NODE_ENV === 'production'
      ? 'https://sso.bylinelms.com/login'
      : 'http://localhost:3000/login';
    res.json({ success: true, message: 'Logged out', redirectUrl });
  });
});

// Development endpoint removed (rate limiting disabled)

// Catch-all for debugging unmatched routes (removed to prevent path-to-regexp errors)

// Root route removed to prevent conflict with SPA fallback

// 404 handler for API routes (before static file serving)
app.use('/api', (req, res, next) => {
  // Log the 404 for debugging
  logger.warn(`[404] API route not found: ${req.method} ${req.path}`, {
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
      origin: req.headers.origin
    }
  });
  
  res.status(404).json({
    error: 'API route not found',
    message: `The requested API endpoint ${req.method} ${req.path} was not found on this server.`,
    path: req.path,
    method: req.method
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  // Track error in performance monitor
  performanceMonitor.trackError(err, {
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query
  });

  logError(err, {
    url: req.url,
    method: req.method,
    body: req.body,
    params: req.params,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Determine status code
  const statusCode = err.status || err.statusCode || 500;
  
  // Prepare error response
  const errorResponse = {
    error: isDevelopment ? err.message : 'Internal Server Error',
    ...(isDevelopment && { 
      stack: err.stack,
      details: err.details 
    }),
    ...(statusCode === 500 && !isDevelopment && {
      requestId: req.id || Date.now().toString(36) // Simple request ID for tracking
    })
  };
  
  res.status(statusCode).json(errorResponse);
});

// Serve static files from the React app build directory (after API routes)
// Use optimized settings for production
const frontendStaticOptions = {
    setHeaders: (res, filepath, stat) => {
        res.set('ngrok-skip-browser-warning', 'true');
        
        const ext = path.extname(filepath).toLowerCase();
        
        // Assets with hashes in filename - cache aggressively
        if (filepath.includes('-') && ['.js', '.css', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.woff', '.woff2'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Images and fonts - cache for 1 year
        else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=31536000');
        }
        // CSS and JS - cache for 1 day
        else if (['.css', '.js'].includes(ext)) {
            res.set('Cache-Control', 'public, max-age=86400');
        }
        // HTML - no cache
        else if (['.html'].includes(ext)) {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
        }
        // Everything else - cache for 1 hour
        else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        // Security headers
        res.set('X-Content-Type-Options', 'nosniff');
    },
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    etag: true,
    lastModified: true,
    index: false, // Don't serve index.html automatically
};

app.use(express.static(path.join(__dirname, '../frontend/dist'), frontendStaticOptions));

// SPA fallback middleware: send back React's index.html file for client-side routing
app.use((req, res, next) => {
  // Skip if it's an API route, static file, or socket.io connection
  if (req.path.startsWith('/api') || 
      req.path.startsWith('/avatars') || 
      req.path.startsWith('/medical-certificates') || 
      req.path.startsWith('/public') ||
      req.path.startsWith('/api/socket.io')) {
    return next();
  }
  
  // CRITICAL: Remove X-Frame-Options and set frame-ancestors for HTML responses
  // This allows the app to be embedded in iframes from SSO portal
  // This is the final check to ensure iframe embedding works
  // Use res.setHeader with undefined to completely remove the header
  res.removeHeader("X-Frame-Options");
  res.setHeader("X-Frame-Options", undefined); // Explicitly remove
  
  const allowedOrigins = process.env.NODE_ENV === 'development' 
    ? "http://localhost:5173 http://localhost:5174 http://localhost:5175 http://127.0.0.1:5173 http://127.0.0.1:5174 http://127.0.0.1:5175"
    : "https://sso.legatolxp.online https://sso.bylinelms.com https://sso.leagatolxp.online https://attendance.bylinelms.com";
  
  let existingCSP = res.getHeader('Content-Security-Policy') || '';
  
  // Ensure frame-ancestors is set correctly (replace if exists, add if not)
  if (existingCSP.includes('frame-ancestors')) {
    // Replace existing frame-ancestors directive
    const cspParts = existingCSP.split(';').filter(part => !part.trim().startsWith('frame-ancestors'));
    existingCSP = [...cspParts, `frame-ancestors ${allowedOrigins}`].filter(Boolean).join('; ');
    res.setHeader("Content-Security-Policy", existingCSP);
  } else {
    // Add frame-ancestors directive
    if (existingCSP) {
    res.setHeader("Content-Security-Policy", `${existingCSP}; frame-ancestors ${allowedOrigins};`);
    } else {
    res.setHeader("Content-Security-Policy", `frame-ancestors ${allowedOrigins};`);
    }
  }
  
  // For all other routes, serve the React app with no-cache headers
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
const httpServer = require('http').createServer(app);

// --- MODIFIED: Initialize Socket.IO and the Manager ---
const { init } = require('./socket');
init(httpServer); // This now internally sets the io instance in socketManager

// Start server only after MongoDB connection is ready
const startServer = async () => {
  try {
    console.log('🔗 Starting server initialization...');
    
    // Connect to MongoDB FIRST before starting server
    await connectDB();
    console.log('✅ MongoDB connection ready');
    
    // Validate JWT configuration for RS256 enforcement
    // Wrap in try-catch to prevent crashes on A2 Hosting
    try {
      const jwtUtils = require('./utils/jwtUtils');
      jwtUtils.validateRS256Configuration();
    } catch (jwtConfigError) {
      console.error('❌ JWT Configuration validation failed:', jwtConfigError.message);
      console.error('⚠️  Server will continue but JWT signing may fail.');
      console.error('⚠️  Please check that RSA keys are uploaded to the server.');
    }
    
    // Create database indexes for optimization
    try {
      await createIndexes();
      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('Failed to create database indexes:', error);
    }
    
    // Start scheduled jobs after database is ready
    startScheduledJobs();
    console.log('✅ Scheduled jobs started');
    
    // Initialize SSO service (only if SSO_PUBLIC_KEY_URL is configured)
    // Note: SSO_SECRET is not used for RS256/JWKS verification, only for legacy HS256
    const ssoPublicKeyUrl = process.env.SSO_PUBLIC_KEY_URL;
    const ssoJwksUrl = process.env.SSO_JWKS_URL;
    
    if (ssoPublicKeyUrl) {
      await ssoService.initialize();
      console.log('[SSO] Legacy SSO service initialized (using public key URL)');
    } else if (ssoJwksUrl) {
      console.log('[SSO] Modern SSO service enabled (using JWKS for RS256 verification)');
      console.log(`[SSO] JWKS URL: ${ssoJwksUrl}`);
    } else {
      console.log('[SSO] SSO service disabled - no SSO_PUBLIC_KEY_URL or SSO_JWKS_URL configured');
      console.log('[SSO] To enable SSO, set SSO_JWKS_URL=https://sso.bylinelms.com/api/auth/jwks in .env');
    }
    
    // ============================================
    // DEBUG: Check for keys to prevent 500 error on login
    // ============================================
    const fs = require('fs');
    const path = require('path');
    const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem';
    const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem';
    const resolvedPrivatePath = path.resolve(__dirname, privateKeyPath);
    const resolvedPublicPath = path.resolve(__dirname, publicKeyPath);
    
    console.log('\n🔑 Checking RSA Keys Configuration...');
    if (!fs.existsSync(resolvedPrivatePath)) {
      console.error('❌ FATAL ERROR: Private Key file is MISSING at: ' + resolvedPrivatePath);
      console.error('❌ Login will fail with 500 Error. Please upload the "keys" folder to the server.');
      console.error('❌ To generate keys, run: node generate-rsa-keys.js');
    } else {
      console.log('✅ Private Key file found at: ' + resolvedPrivatePath);
    }
    
    if (!fs.existsSync(resolvedPublicPath)) {
      console.error('❌ FATAL ERROR: Public Key file is MISSING at: ' + resolvedPublicPath);
      console.error('❌ Login will fail with 500 Error. Please upload the "keys" folder to the server.');
      console.error('❌ To generate keys, run: node generate-rsa-keys.js');
    } else {
      console.log('✅ Public Key file found at: ' + resolvedPublicPath);
    }
    
    // ============================================
    // DEBUG: Environment Variable Status
    // ============================================
    console.log('\n📋 Environment Variable Status...');
    console.log('  SESSION_SECRET:', process.env.SESSION_SECRET ? 'Set ✅' : 'Missing ❌');
    console.log('  JWT_SECRET:', process.env.JWT_SECRET ? 'Set ✅' : 'Missing ⚠️ (optional for normal login)');
    console.log('  MONGODB_URI:', process.env.MONGODB_URI ? 'Set ✅' : 'Missing ❌');
    console.log('  NODE_ENV:', process.env.NODE_ENV || 'Not set (defaults to development)');
    console.log('');
    
    // Start HTTP server only after all initialization is complete
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log('✅ Server initialization complete');
    });
    
  } catch (err) {
    console.error('\n❌❌❌ CRITICAL SERVER STARTUP ERROR ❌❌❌');
    console.error('❌ Failed to start server:', err.message);
    console.error('❌ Error stack:', err.stack);
    console.error('\n📋 Debugging Information:');
    console.error('  - MongoDB URI:', process.env.MONGODB_URI ? 'Set' : 'NOT SET ❌');
    console.error('  - Error type:', err.name);
    console.error('\n⚠️  For A2 Hosting: Check error logs in:');
    console.error('   - cPanel > Error Logs');
    console.error('   - Passenger error logs');
    console.error('   - Application logs directory');
    console.error('\n🔧 Common fixes:');
    console.error('   1. Verify MongoDB URI in .env file');
    console.error('   2. Check MongoDB connection string format');
    console.error('   3. Ensure MongoDB server is accessible from A2 Hosting');
    console.error('   4. Check network/firewall settings\n');
    
    // DO NOT EXIT immediately - log the error extensively first
    // A2 Hosting needs time to capture logs before process dies
    setTimeout(() => {
      console.error('❌ Exiting process after error logging...');
      process.exit(1);
    }, 2000); // Wait 2 seconds for logs to be written
  }
};

// Start the server
startServer();