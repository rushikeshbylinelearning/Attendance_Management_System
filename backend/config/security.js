// Security configuration for the application
const helmet = require('helmet');
const cors = require('cors');

// CORS configuration
// NOTE: In production, only HTTPS origins should be allowed for SSO
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://attendance.bylinelms.com',
      'https://attendance.leagatolxp.online', // Production AMS domain
      'https://sso.leagatolxp.online', // Production SSO domain
      'https://sso.bylinelms.com', // Production SSO portal
      process.env.FRONTEND_URL,
      // Development origins (only allow in development mode)
      ...(process.env.NODE_ENV === 'development' ? [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // SSO frontend portal
      'http://localhost:5174', // AMS frontend
      'http://localhost:5175', // Other internal apps
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175'
      ] : [])
    ].filter(Boolean);
    
    // In production, enforce HTTPS for SSO origins
    if (process.env.NODE_ENV === 'production' && origin.startsWith('http://')) {
      console.warn('[CORS] Rejecting non-HTTPS origin in production:', origin);
      return callback(new Error('HTTPS required in production'));
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] Origin not allowed:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Connection',
    'Upgrade',
    'Sec-WebSocket-Key',
    'Sec-WebSocket-Version',
    'Sec-WebSocket-Protocol',
    'Sec-WebSocket-Extensions'
  ]
};

// Helmet configuration for security headers
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      // Allow embedding from SSO Portal (frame-ancestors controls who can embed this app)
      frameAncestors: process.env.NODE_ENV === 'development' 
        ? ["'self'", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175"]
        : ["'self'", "https://sso.legatolxp.online", "https://sso.bylinelms.com"],
    },
  },
  // Disable X-Frame-Options since we're using CSP frame-ancestors instead
  frameguard: false,
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

module.exports = {
  corsOptions,
  helmetConfig
};
