// backend/routes/autoLogin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/User');

const DEFAULT_SSO_ROLE = (() => {
  const allowed = ['Admin', 'HR', 'Employee', 'Intern'];
  const envRole = process.env.SSO_DEFAULT_ROLE;
  if (envRole && typeof envRole === 'string') {
    const normalized = envRole.trim();
    const match = allowed.find(role => role.toLowerCase() === normalized.toLowerCase());
    if (match) {
      return match;
    }
  }
  return 'Employee';
})();

/**
 * Check if existing AMS token is valid
 * Returns user object if token is valid, null otherwise
 */
async function checkExistingAMSToken(req) {
  try {
    // Check for AMS token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Try to decode to check if it's an AMS token
      const jwt = require('jsonwebtoken');
      const jwtUtils = require('../utils/jwtUtils');
      const decodedHeader = jwt.decode(token, { complete: true });
      
      if (decodedHeader && decodedHeader.header) {
        const kid = decodedHeader.header.kid;
        
        // Only process AMS tokens (not SSO tokens)
        if (!kid || !kid.startsWith('sso-key-')) {
          try {
            const decoded = jwtUtils.verify(token);
            const userId = decoded.userId;
            
            // Verify token hasn't expired
            if (decoded.exp && decoded.exp * 1000 > Date.now()) {
              // Find user
              const user = await User.findById(userId).populate('shiftGroup').lean();
              
              if (user && user.isActive) {
                console.log('[AutoLogin] ✅ Found valid existing AMS token for user:', user.email);
                return {
                  id: user._id.toString(),
                  name: user.fullName,
                  email: user.email,
                  role: user.role,
                  authMethod: 'SSO',
                  fullName: user.fullName,
                  employeeCode: user.employeeCode,
                  department: user.department,
                  designation: user.designation,
                  domain: user.domain,
                  featurePermissions: user.featurePermissions,
                  shift: user.shiftGroup ? {
                    id: user.shiftGroup._id,
                    name: user.shiftGroup.shiftName,
                    startTime: user.shiftGroup.startTime,
                    endTime: user.shiftGroup.endTime,
                    duration: user.shiftGroup.durationHours,
                    paidBreak: user.shiftGroup.paidBreakMinutes,
                  } : null,
                  existingToken: token
                };
              }
            }
          } catch (verifyError) {
            // Token invalid or expired, will fall through to SSO validation
            console.log('[AutoLogin] Existing AMS token invalid or expired:', verifyError.message);
          }
        }
      }
    }
  } catch (error) {
    console.log('[AutoLogin] Error checking existing AMS token:', error.message);
  }
  
  return null;
}

/**
 * Middleware to verify SSO token from Authorization header or request body
 * Now checks for existing AMS token first before requiring SSO token
 */
const verifySSOToken = async (req, res, next) => {
  try {
    // STEP 1: Check for existing valid AMS token first
    const existingUser = await checkExistingAMSToken(req);
    if (existingUser) {
      console.log('[AutoLogin] ✅ Using existing AMS session - skipping SSO validation');
      req.user = existingUser;
      req.usingExistingToken = true;
      return next(); // Skip SSO validation
    }
    
    console.log('[AutoLogin] No valid existing AMS token found - proceeding with SSO validation');
    
    // STEP 2: If no valid AMS token, require SSO token
    let token = null;
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // If no token in header, try request body
    if (!token && req.body && req.body.token) {
      token = req.body.token;
    }
    
    // If still no token, try query parameter
    if (!token && req.query && req.query.token) {
      token = req.query.token;
    }
    
    if (!token) {
      console.log('[AutoLogin] No SSO token found in request and no valid AMS token');
      return res.status(401).json({ 
        success: false, 
        message: 'SSO token required (no valid AMS session found)',
        code: 'MISSING_TOKEN',
        requiresAuth: true
      });
    }

    console.log('[AutoLogin] Processing SSO token...');
    console.log('[AutoLogin] Token received:', token ? token.substring(0, 50) + '...' : 'null');

    // Verify the SSO token using JWKS (RS256 only)
    const jwtUtils = require('../utils/jwtUtils');
    const decoded = await jwtUtils.verifySSOTokenWithJWKS(token);
    
    console.log('[AutoLogin] Token verification successful');
    
    // Log all claims for debugging
    console.log('[AutoLogin] Verified token payload:', {
        sub: decoded.sub,
        userId: decoded.userId,
        email: decoded.email,
        appEmail: decoded.appEmail,
        appName: decoded.appName,
        name: decoded.name,
        role: decoded.role,
        authMethod: decoded.authMethod,
        iss: decoded.iss,
        aud: decoded.aud,
        iat: decoded.iat,
        exp: decoded.exp
    });
    
    // Extract app-specific credentials (primary for auto-login)
    const appEmail = decoded.appEmail || decoded.email || decoded.user?.email;
    const appPassword = decoded.appPassword;
    const ssoEmail = decoded.email || decoded.user?.email; // SSO email for logging
    
    console.log('[AutoLogin] Credential extraction:', {
        appEmail: appEmail ? appEmail.substring(0, 10) + '...' : 'MISSING',
        ssoEmail: ssoEmail ? ssoEmail.substring(0, 10) + '...' : 'MISSING',
        hasAppPassword: !!appPassword,
        emailsMatch: appEmail === ssoEmail
    });
    
    if (!appEmail) {
        console.error('[AutoLogin] ❌ Missing appEmail in token - cannot proceed with auto-login');
        console.error('[AutoLogin] Available token fields:', Object.keys(decoded));
        return res.status(400).json({
            success: false,
            error: 'missing_app_email',
            message: 'Missing appEmail in SSO token. Please ensure app credentials are stored in SSO portal.'
        });
    }
    
    // Warn if using SSO email instead of app email (indicates credentials not stored)
    if (appEmail === ssoEmail && !appPassword) {
        console.warn(`[AutoLogin] ⚠️ Using SSO email (${ssoEmail}) instead of app-specific email`);
        console.warn(`[AutoLogin] ⚠️ No app credentials found in SSO portal for this user/app combination`);
        console.warn(`[AutoLogin] ⚠️ This may cause login failures if emails don't match`);
    }
    
    // Extract user claims (check both top-level and nested)
    const tokenRole = decoded.role || decoded.user?.role || null;
    const userClaims = {
        email: appEmail,
        role: null,
        tokenRole,
        name: decoded.name || decoded.user?.name || appEmail,
        username: decoded.username || decoded.user?.username || appEmail,
        employeeCode: decoded.employeeCode || decoded.user?.employeeCode || decoded.employeeId,
        department: decoded.department || decoded.user?.department,
        designation: decoded.designation || decoded.user?.position,
        domain: decoded.domain || decoded.user?.domain,
        authMethod: decoded.authMethod || 'SSO',
        appPassword: appPassword
    };
    
    console.log('[AutoLogin] User claims extracted:', { 
        email: userClaims.email, 
        tokenRole: userClaims.tokenRole,
        name: userClaims.name,
        employeeCode: userClaims.employeeCode,
        hasPassword: !!userClaims.appPassword
    });

    // Ensure MongoDB connection before querying
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
        console.log('[AutoLogin] MongoDB not ready (readyState: ' + mongoose.connection.readyState + '), waiting...');
        await new Promise((resolve, reject) => {
            if (mongoose.connection.readyState === 1) return resolve();
            const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 5000);
            mongoose.connection.once('connected', () => {
                clearTimeout(timeout);
                resolve();
            });
            if (mongoose.connection.readyState === 0) {
                const connectDB = require('../db');
                connectDB().catch(reject);
            }
        });
        console.log('[AutoLogin] ✅ MongoDB connection ready');
    }
    
    // Find existing user by appEmail (not SSO email)
    let user = await User.findOne({ 
      email: appEmail, // Use appEmail from token
      isActive: true 
    }).populate('shiftGroup');

    if (!user) {
      // Check if auto-provisioning is enabled
      const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
      if (!autoProvision) {
        console.log(`[AutoLogin] User ${appEmail} not found and auto-provisioning disabled`);
        return res.status(403).json({ 
          success: false,
          message: 'User not found and auto-provisioning disabled',
          code: 'USER_NOT_FOUND'
        });
      }

      // Check for existing user by email or employeeCode to avoid duplicates
      const existingUser = await User.findOne({
        $or: [
          { email: appEmail },
          { employeeCode: userClaims.employeeCode }
        ]
      });

      if (existingUser) {
        console.log(`[AutoLogin] Found existing user: ${existingUser.email}`);
        user = existingUser;
      } else {
        // Auto-provision new user
        console.log(`[AutoLogin] Auto-provisioning new user: ${appEmail}`);
        
        // Generate unique employeeCode if not provided
        let employeeCode = userClaims.employeeCode;
        if (!employeeCode) {
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          employeeCode = `SSO_${timestamp}_${randomSuffix}`;
        }
        
        // Hash password if provided
        let passwordHash = 'SSO_USER_NO_PASSWORD';
        if (appPassword) {
          const bcrypt = require('bcrypt');
          passwordHash = await bcrypt.hash(appPassword, 10);
          console.log(`[AutoLogin] Hashed password for new user: ${appEmail}`);
        }
        
        user = new User({
          email: appEmail, // Use appEmail
          fullName: userClaims.name || appEmail.split('@')[0],
          employeeCode: employeeCode,
          role: DEFAULT_SSO_ROLE, // Assign default role
          department: userClaims.department || 'Unknown',
          designation: userClaims.designation || 'Employee',
          domain: userClaims.domain || 'Unknown',
          passwordHash: passwordHash,
          joiningDate: new Date(),
          isActive: true,
          authMethod: 'SSO',
          featurePermissions: {
            leaves: true,
            breaks: true,
            extraFeatures: false,
            maxBreaks: 999,
            breakAfterHours: 0,
            breakWindows: [],
            canCheckIn: true,
            canCheckOut: true,
            canTakeBreak: true,
            privilegeLevel: 'normal',
            restrictedFeatures: {},
            advancedFeatures: {}
          }
        });

        await user.save();
        user = await User.findById(user._id).populate('shiftGroup');
        console.log(`[AutoLogin] Successfully created new user: ${appEmail}`);
      }
    } else {
      console.log(`[AutoLogin] Found existing AMS user: ${appEmail}`);
      
      // Verify app password if provided in token
      if (appPassword && user.passwordHash && user.passwordHash !== 'SSO_USER_NO_PASSWORD') {
        const bcrypt = require('bcrypt');
        try {
          const isPasswordValid = await bcrypt.compare(appPassword, user.passwordHash);
          if (!isPasswordValid) {
            console.error(`[AutoLogin] ❌ Password verification failed for user: ${appEmail}`);
            return res.status(401).json({
              success: false,
              message: 'Invalid app credentials',
              code: 'INVALID_CREDENTIALS'
            });
          }
          console.log(`[AutoLogin] ✅ Password verification successful for user: ${appEmail}`);
        } catch (passwordError) {
          console.error(`[AutoLogin] ❌ Password verification error: ${passwordError.message}`);
          return res.status(500).json({
            success: false,
            message: 'Password verification failed',
            code: 'PASSWORD_VERIFICATION_ERROR'
          });
        }
      } else if (appPassword && (!user.passwordHash || user.passwordHash === 'SSO_USER_NO_PASSWORD')) {
        // User has no password set (SSO-only user), skip password verification
        console.log(`[AutoLogin] ⚠️ User ${appEmail} has no password set, skipping password verification`);
      } else if (!appPassword) {
        // No password in token, skip verification (backward compatibility)
        console.log(`[AutoLogin] ⚠️ No app password in token, skipping password verification`);
      }
      
      // Update user data from SSO if needed
      const needsUpdate = 
        (userClaims.department && user.department !== userClaims.department) ||
        (userClaims.designation && user.designation !== userClaims.designation) ||
        (userClaims.employeeCode && user.employeeCode !== userClaims.employeeCode);

      if (needsUpdate) {
        const updateData = {
          authMethod: 'SSO'
        };

        if (userClaims.department) updateData.department = userClaims.department;
        if (userClaims.designation) updateData.designation = userClaims.designation;
        if (userClaims.employeeCode) updateData.employeeCode = userClaims.employeeCode;

        user = await User.findByIdAndUpdate(
          user._id,
          updateData,
          { new: true }
        ).populate('shiftGroup');

        console.log(`[AutoLogin] Updated user data for: ${appEmail}`);
      }
    }

    // Attach user to request object
    req.user = {
      id: user._id,
      name: user.fullName,
      email: user.email,
      role: user.role,
      authMethod: 'SSO',
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      department: user.department,
      designation: user.designation,
      domain: user.domain,
      featurePermissions: user.featurePermissions,
      shift: user.shiftGroup ? {
        id: user.shiftGroup._id,
        name: user.shiftGroup.shiftName,
        startTime: user.shiftGroup.startTime,
        endTime: user.shiftGroup.endTime,
        duration: user.shiftGroup.durationHours,
        paidBreak: user.shiftGroup.paidBreakMinutes,
      } : null
    };

    console.log(`[AutoLogin] SSO verification successful for: ${userClaims.email}`);
    next();

  } catch (err) {
    console.error('[AutoLogin] SSO token verification failed:', err.message);
    return res.status(401).json({ 
      success: false, 
      message: 'SSO token invalid or expired',
      code: 'INVALID_TOKEN',
      error: err.message
    });
  }
};

// In-memory cache for AMS tokens by user email (fallback if Redis not available)
// Key: user email, Value: { token, expiresAt, userId }
const amsTokenCache = new Map();
const AMS_TOKEN_CACHE_TTL = 8 * 60 * 60 * 1000; // 8 hours (matches token expiry)

/**
 * Get cached AMS token for user
 */
function getCachedAMSToken(email) {
  const cached = amsTokenCache.get(email);
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[AutoLogin] ✅ Found cached AMS token for user:', email);
    return cached.token;
  }
  if (cached) {
    // Expired, remove from cache
    amsTokenCache.delete(email);
  }
  return null;
}

/**
 * Cache AMS token for user
 */
function cacheAMSToken(email, token, userId) {
  const expiresAt = Date.now() + AMS_TOKEN_CACHE_TTL;
  amsTokenCache.set(email, { token, expiresAt, userId });
  console.log('[AutoLogin] ✅ Cached AMS token for user:', email, 'expires at:', new Date(expiresAt).toISOString());
  
  // Clean expired entries periodically
  if (amsTokenCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of amsTokenCache.entries()) {
      if (value.expiresAt <= now) {
        amsTokenCache.delete(key);
      }
    }
  }
}

/**
 * POST /api/auto-login/launch/:appId
 * Auto-login endpoint for SSO portal integration
 * Now checks for existing AMS token first before requiring SSO token
 */
router.post('/launch/:appId', verifySSOToken, async (req, res) => {
  try {
    const { user } = req;
    const appId = req.params.appId;
    const usingExistingToken = req.usingExistingToken || false;

    console.log(`✅ Auto-login request for app ${appId} by user ${user?.email || 'unknown'}`);
    console.log('[AutoLogin] User details:', {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      usingExistingToken: usingExistingToken
    });

    // Create session for the user
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      authMethod: 'SSO'
    };
    req.session.ssoAuthenticated = true;
    
    console.log('[AutoLogin] Session created successfully');

    // Get or generate AMS JWT token
    let amsToken = null;
    
    if (usingExistingToken && user.existingToken) {
      // Use existing token if valid
      amsToken = user.existingToken;
      console.log('[AutoLogin] ✅ Reusing existing AMS token - no new token generated');
    } else {
      // Check cache first
      const cachedToken = getCachedAMSToken(user.email);
      if (cachedToken) {
        // Verify cached token is still valid
        try {
          const jwtUtils = require('../utils/jwtUtils');
          const verified = jwtUtils.verify(cachedToken);
          if (verified.userId === user.id.toString()) {
            amsToken = cachedToken;
            console.log('[AutoLogin] ✅ Using cached AMS token - validated and still valid');
          } else {
            console.log('[AutoLogin] ⚠️ Cached token user mismatch, generating new token');
          }
        } catch (verifyError) {
          console.log('[AutoLogin] ⚠️ Cached token invalid, generating new token:', verifyError.message);
        }
      }
      
      // Generate new AMS JWT token if needed
      if (!amsToken) {
        const jwtUtils = require('../utils/jwtUtils');
        console.log('[AutoLogin] Creating new AMS local JWT token for user:', user.email);
        
        amsToken = jwtUtils.sign({
          userId: user.id.toString(), // Ensure userId is a string
          email: user.email,
          role: user.role,
          authMethod: 'SSO'
        }, { expiresIn: '8h' });

        console.log('[AutoLogin] ✅ AMS JWT token generated successfully');
        console.log('[AutoLogin] Token preview:', amsToken.substring(0, 50) + '...');
        
        // Self-verify the token we just created
        try {
          const verified = jwtUtils.verify(amsToken);
          console.log('[AutoLogin] ✅ AMS token self-verification successful');
          console.log('[AutoLogin] Verified payload:', { userId: verified.userId, email: verified.email });
        } catch (verifyError) {
          console.error('[AutoLogin] ❌ AMS token self-verification failed:', verifyError.message);
          throw new Error(`Failed to verify generated AMS token: ${verifyError.message}`);
        }
        
        // Cache the new token
        cacheAMSToken(user.email, amsToken, user.id);
      }
    }

    // Determine redirect URL based on appId or user role
    let redirectUrl = '/dashboard';
    
    // You can customize redirect URLs based on appId in the future
    switch (appId) {
      case 'attendance':
      case 'ams':
        redirectUrl = '/dashboard';
        break;
      case 'admin':
        if (user.role === 'Admin' || user.role === 'HR') {
          redirectUrl = '/admin/dashboard';
        } else {
          redirectUrl = '/dashboard';
        }
        break;
      default:
        redirectUrl = '/dashboard';
    }

    // Log whether we're reusing existing session or creating new one
    if (usingExistingToken) {
      console.log('[AutoLogin] ✅ Using existing AMS session - no new registration needed');
      console.log('[AutoLogin] Session persisted successfully - user:', user.email);
      console.info('[SSO] Frontend successfully reused existing AMS token - no SSO prompt needed');
    } else {
      console.log('[AutoLogin] ✅ New SSO session created - user:', user.email);
      console.info('[SSO] Frontend successfully consumed AMS token');
    }

    // Check if this is a direct browser request (from SSO redirect) or API call
    const userAgent = req.headers['user-agent'] || '';
    const isBrowserRequest = userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari');
    
    if (isBrowserRequest) {
      // For browser requests, redirect to AMS frontend with JWT token in query parameter
      const amsFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const fullRedirectUrl = `${amsFrontendUrl}${redirectUrl}?token=${encodeURIComponent(amsToken)}`;
      
      console.log(`[AutoLogin] Redirecting browser to: ${fullRedirectUrl}`);
      return res.redirect(fullRedirectUrl);
    } else {
      // For API requests (from SSO frontend), return JSON with token
      res.json({
        success: true,
        message: 'SSO auto-login successful',
        token: amsToken,
        redirectUrl: redirectUrl,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          authMethod: 'SSO'
        }
      });
    }

  } catch (err) {
    console.error('❌ Auto-login error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Auto-login failed', 
      error: err.message 
    });
  }
});

/**
 * GET /api/auto-login/status
 * Check auto-login service status
 */
router.get('/status', (req, res) => {
  const ssoConfigured = !!(
    process.env.SSO_JWKS_URL || 
    process.env.SSO_PUBLIC_KEY || 
    process.env.SSO_VALIDATE_URL ||
    (process.env.SSO_SECRET && process.env.SSO_SECRET !== 'sso-secret-key-change-in-production')
  );

  res.json({
    success: true,
    autoLoginEnabled: ssoConfigured,
    ssoConfigured: ssoConfigured,
    ssoJwksUrl: process.env.SSO_JWKS_URL || null,
    ssoPublicKey: process.env.SSO_PUBLIC_KEY ? 'configured' : null,
    ssoValidateUrl: process.env.SSO_VALIDATE_URL || null,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
