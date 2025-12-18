// backend/routes/auth.js
/**
 * ATTENDANCE PORTAL AUTHENTICATION ROUTES
 * 
 * This file contains TWO independent login routes:
 * 
 * 1. STANDALONE LOGIN ROUTE: POST /api/auth/login
 *    - Handles direct email/password authentication
 *    - Completely independent of SSO
 *    - Used when users log in directly to the attendance portal
 *    - Protected by geofencing middleware
 *    - Returns JWT token and user data
 * 
 * 2. SSO LOGIN ROUTE: POST /api/auth/sso-consume
 *    - Handles SSO token authentication from SSO portal
 *    - Completely independent of standalone login
 *    - Used when users are redirected from SSO portal with sso_token
 *    - Validates SSO token via JWKS/RS256
 *    - Returns AMS JWT token and user data
 * 
 * Both routes are protected and work independently.
 * The SSO middleware (ssoTokenAuth) is configured to NOT interfere with:
 * - POST requests (all API routes)
 * - /login page route (frontend handles SSO tokens)
 * - /api/* routes (all API endpoints)
 */
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
const { loginGeofencingMiddleware } = require('../middleware/geofencingMiddleware');
const { checkGeofence } = require('../services/geofencingService');
const ssoService = require('../services/ssoService');
const SSOVerification = require('../utils/ssoVerification');
const jwtUtils = require('../utils/jwtUtils');

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

const router = express.Router();

const normalizeEmail = (email) => {
    return email?.trim().toLowerCase() || '';
};

// =================================================================
// STANDALONE LOGIN ROUTE - POST /api/auth/login
// This route handles direct email/password authentication
// It is completely independent of SSO and should never be interfered with
// SSO authentication uses /api/auth/sso-consume instead
// =================================================================
router.post('/login', loginGeofencingMiddleware, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email/Employee Code and password are required.' });
    }

    try {
        console.log('[Standalone Login] Login attempt for:', email);
        
        // =================================================================
        // ### START OF FIX ###
        // Support both exact email match and normalized email match for login
        // This handles cases where admin saved email with dots/aliases but user types without
        const normalizedEmail = normalizeEmail(email);
        
        // Try to find user by exact email first, then by normalized email
        // This supports both admin-saved emails (exact) and SSO-created emails (normalized)
        let user = await User.findOne({
            $or: [
                { email: email }, // Exact match (for admin-created users)
                { email: normalizedEmail }, // Normalized match (for SSO-created users or Gmail variations)
                { employeeCode: email } // Employee code match
            ]
        }).populate('shiftGroup');

        // Check if user is active and has password
        if (!user || !user.isActive || !user.passwordHash) {
            console.warn(`Login attempt failed for: ${email}. User not found, inactive, or has no password.`);
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        // ### END OF FIX ###
        // =================================================================

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        // Check geofencing for non-admin users
        if (user.role !== 'Admin' && user.role !== 'HR') {
            if (req.userLocation) {
                const geofenceResult = await checkGeofence(
                    req.userLocation.latitude,
                    req.userLocation.longitude,
                    user.role
                );

                if (!geofenceResult.isWithinGeofence) {
                    return res.status(403).json({
                        error: 'Access denied: You must be within office premises to log in',
                        code: 'GEOFENCE_VIOLATION',
                        details: {
                            distance: geofenceResult.distance,
                            nearestOffice: geofenceResult.officeLocation ? {
                                name: geofenceResult.officeLocation.name,
                                address: geofenceResult.officeLocation.address
                            } : null
                        }
                    });
                }
            } else {
                // No location provided for non-admin user
                return res.status(400).json({
                    error: 'Location access is required for login. Please enable location permissions.',
                    code: 'LOCATION_REQUIRED'
                });
            }
        }

        const payload = { userId: user._id, email: user.email, role: user.role };
        const token = jwtUtils.sign(payload, { expiresIn: '9h' });

        console.log('[Standalone Login] ✅ Login successful for:', user.email, 'via standalone route');

        res.status(200).json({
            message: 'Login successful!',
            token,
            user: {
                id: user._id,
                name: user.fullName,
                fullName: user.fullName,
                employeeCode: user.employeeCode,
                email: user.email,
                role: user.role,
                employmentStatus: user.employmentStatus,
                domain: user.domain,
                designation: user.designation,
                department: user.department,
                alternateSaturdayPolicy: user.alternateSaturdayPolicy,
                profileImageUrl: user.profileImageUrl,
                featurePermissions: user.featurePermissions || {
                    leaves: true,
                    breaks: true,
                    extraFeatures: false,
                    maxBreaks: 999, // No restrictions
                    breakAfterHours: 0, // Can take break immediately
                    breakWindows: [], // No time restrictions by default
                    canCheckIn: true,
                    canCheckOut: true,
                    canTakeBreak: true,
                    privilegeLevel: 'normal',
                    restrictedFeatures: {
                        canViewReports: false,
                        canViewOtherLogs: false,
                        canEditProfile: true,
                        canRequestExtraBreak: true
                    },
                    advancedFeatures: {
                        canBulkActions: false,
                        canExportData: false,
                        canViewAnalytics: false
                    }
                },
                shift: user.shiftGroup ? {
                    id: user.shiftGroup._id,
                    name: user.shiftGroup.shiftName,
                    startTime: user.shiftGroup.startTime,
                    endTime: user.shiftGroup.endTime,
                    duration: user.shiftGroup.durationHours,
                    paidBreak: user.shiftGroup.paidBreakMinutes,
                } : null
            }
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/me', async (req, res) => {
    try {
        let userId;
        let authMethod = 'local';

        // Check for SSO session first
        if (req.session && req.session.user) {
            userId = req.session.user.id;
            authMethod = 'SSO';
            console.log('[/me] SSO session found for user:', userId);
        } else {
            // Check for JWT token in Authorization header
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

            if (token == null) {
                console.log('[/me] No authorization header or token found');
                return res.status(401).json({ error: 'Authentication required' });
            }

            console.log('[/me] Attempting to verify JWT token...');
            console.log('[/me] Token preview:', token.substring(0, 50) + '...');
            
            // Try to determine token type by decoding header
            let decoded;
            let tokenType = 'unknown';
            
            try {
                const decodedHeader = jwt.decode(token, { complete: true });
                if (decodedHeader && decodedHeader.header) {
                    const kid = decodedHeader.header.kid;
                    const alg = decodedHeader.header.alg;
                    
                    // SSO tokens have kid like 'sso-key-*', AMS tokens have 'ams-key'
                    if (kid && kid.startsWith('sso-key-')) {
                        tokenType = 'SSO';
                        console.log('[/me] ⚠️ Detected SSO token (kid: ' + kid + ') - should have been converted to AMS token');
                        console.log('[/me] Converting SSO token to AMS user lookup...');
                        
                        // Verify SSO token using JWKS
                        try {
                            decoded = await jwtUtils.verifySSOTokenWithJWKS(token);
                            const ssoUserId = decoded.userId || decoded.sub;
                            const ssoEmail = decoded.email;
                            
                            console.log('[/me] SSO token verified for email:', ssoEmail);
                            console.log('[/me] SSO user ID (from SSO DB):', ssoUserId);
                            
                            if (!ssoEmail) {
                                throw new Error('SSO token missing email claim - cannot map to AMS user');
                            }
                            
                            // Normalize email, but also try raw lowercase for admin-created emails
                            const normalizedSsoEmail = normalizeEmail(ssoEmail);
                            const rawLowerEmail = String(ssoEmail).toLowerCase();
                            console.log('[/me] SSO email from token:', ssoEmail);
                            console.log('[/me] Normalized email for lookup:', normalizedSsoEmail);
                            
                            // Find AMS user by normalized OR exact raw lowercase email
                            console.log('[/me] Looking up AMS user by normalized or raw email:', normalizedSsoEmail, rawLowerEmail);
                            const amsUser = await User.findOne({ 
                                isActive: true,
                                $or: [
                                    { email: normalizedSsoEmail },
                                    { email: rawLowerEmail }
                                ]
                            }).lean();
                            
                            if (!amsUser) {
                                console.log('[/me] ❌ AMS user not found for normalized email:', normalizedSsoEmail);
                                console.log('[/me] SSO user must authenticate via /api/auth/sso-consume first to create AMS user');
                                return res.status(401).json({ 
                                    error: 'User not found in AMS database',
                                    message: `No AMS user found for email: ${normalizedSsoEmail}. Please authenticate via SSO login endpoint first.`,
                                    code: 'AMS_USER_NOT_FOUND',
                                    requiresSsoLogin: true
                                });
                            }
                            
                            userId = amsUser._id.toString();
                            authMethod = 'SSO';
                            console.log('[/me] ✅ SSO token mapped to AMS user:', userId);
                            if (ssoEmail !== normalizedSsoEmail) {
                                console.log('[SSO → AMS Sync] Email normalization matched:', ssoEmail, '->', normalizedSsoEmail);
                            }
                            console.log('[SSO → AMS Sync] Linked SSO user', ssoEmail, '(normalized:', normalizedSsoEmail + ')', 'to AMS user', userId);
                        } catch (ssoVerifyError) {
                            console.error('[/me] ❌ SSO token verification failed:', ssoVerifyError.message);
                            throw ssoVerifyError;
                        }
                    } else {
                        // Assume AMS local token
                        tokenType = 'AMS';
                        console.log('[/me] Detected AMS local token (kid: ' + (kid || 'none') + ')');
                        try {
                            decoded = jwtUtils.verify(token);
                            userId = decoded.userId;
                            authMethod = decoded.authMethod || 'local';
                            console.log('[/me] ✅ AMS JWT token verified successfully for user:', userId);
                        } catch (amsVerifyError) {
                            console.error('[/me] ❌ AMS token verification failed:', amsVerifyError.message);
                            throw amsVerifyError;
                        }
                    }
                } else {
                    throw new Error('Invalid token format: missing header');
                }
            } catch (verifyError) {
                console.error('[/me] ❌ JWT token verification failed:', verifyError.message);
                console.error('[/me] Error type:', verifyError.name);
                console.error('[/me] Token type attempted:', tokenType);
                
                // Try to decode token to get more info
                try {
                    const decoded = jwt.decode(token, { complete: true });
                    if (decoded && decoded.header) {
                        console.error('[/me] Token header info:', {
                            alg: decoded.header.alg,
                            kid: decoded.header.kid,
                            typ: decoded.header.typ
                        });
                    }
                } catch (decodeError) {
                    console.error('[/me] Could not decode token:', decodeError.message);
                }
                
                return res.status(401).json({ 
                    error: 'Invalid token',
                    message: verifyError.message,
                    code: 'TOKEN_VERIFICATION_FAILED'
                });
            }
        }

        // Check cache first
        const cacheService = require('../services/cacheService');
        const cachedUser = cacheService.getUser(userId);
        
        if (cachedUser) {
            console.log('[/me] Returning cached user data');
            return res.json(cachedUser);
        }

        console.log('[/me] Fetching user from database');
        
        // Optimized query with specific field selection
        const user = await User.findById(userId)
            .populate('shiftGroup', 'shiftName startTime endTime durationHours paidBreakMinutes')
            .select('-passwordHash -__v')
            .lean();

        if (!user) {
            console.log('[/me] User not found:', userId);
            return res.status(404).json({ error: 'User not found.' });
        }

        console.log('[/me] User found:', user.email);

        const userResponse = {
            id: user._id,
            name: user.fullName,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            email: user.email,
            role: user.role,
            employmentStatus: user.employmentStatus,
            domain: user.domain,
            designation: user.designation,
            department: user.department,
            alternateSaturdayPolicy: user.alternateSaturdayPolicy,
            profileImageUrl: user.profileImageUrl,
            authMethod: authMethod,
            featurePermissions: user.featurePermissions || {
                leaves: true,
                breaks: true,
                extraFeatures: false,
                maxBreaks: 999, // No restrictions
                breakAfterHours: 0, // Can take break immediately
                breakWindows: [], // No time restrictions by default
                canCheckIn: true,
                canCheckOut: true,
                canTakeBreak: true,
                privilegeLevel: 'normal',
                restrictedFeatures: {
                    canViewReports: false,
                    canViewOtherLogs: false,
                    canEditProfile: true,
                    canRequestExtraBreak: true
                },
                advancedFeatures: {
                    canBulkActions: false,
                    canExportData: false,
                    canViewAnalytics: false
                },
                autoBreakOnInactivity: false,
                inactivityThresholdMinutes: 5
            },
            shift: user.shiftGroup ? {
                id: user.shiftGroup._id,
                name: user.shiftGroup.shiftName,
                startTime: user.shiftGroup.startTime,
                endTime: user.shiftGroup.endTime,
                duration: user.shiftGroup.durationHours,
                paidBreak: user.shiftGroup.paidBreakMinutes,
            } : null
        };

        // Cache the user data
        cacheService.setUser(userId, userResponse);
        
        console.log('[/me] User data cached and returned successfully');
        res.json(userResponse);
    } catch (error) {
        console.error('[/me] Error fetching user data:', error);
        console.error('[/me] Error details:', error.message, error.stack);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// SSO Callback Route
router.get('/callback', async (req, res) => {
    try {
        const { sso_token } = req.query;

        if (!sso_token) {
            console.log('[SSO] No SSO token provided in callback');
            return res.redirect('/login?error=no_sso_token');
        }

        console.log('[SSO] Processing SSO callback with token');

        // Validate the SSO token
        const ssoUser = await ssoService.validateToken(sso_token);

        // Find or create user in AMS
        const user = await ssoService.findOrCreateUser(ssoUser);

        // Create AMS JWT token
        const amsToken = ssoService.createAMSToken(user);

        // Prepare user data for response
        const userData = {
            id: user._id,
            name: user.fullName,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            email: user.email,
            role: user.role,
            domain: user.domain,
            designation: user.designation,
            department: user.department,
            alternateSaturdayPolicy: user.alternateSaturdayPolicy,
            profileImageUrl: user.profileImageUrl,
            authMethod: 'SSO',
            shift: user.shiftGroup ? {
                id: user.shiftGroup._id,
                name: user.shiftGroup.shiftName,
                startTime: user.shiftGroup.startTime,
                endTime: user.shiftGroup.endTime,
                duration: user.shiftGroup.durationHours,
                paidBreak: user.shiftGroup.paidBreakMinutes,
            } : null
        };

        console.log(`[SSO] Successfully authenticated user: ${user.email} via SSO`);

        // For SSO, we need to redirect to frontend with token
        // The frontend will handle setting the token in sessionStorage
        const frontendUrl = process.env.FRONTEND_URL || 'https://attendance.bylinelms.com';
        const redirectUrl = `${frontendUrl}/auth/sso-callback?token=${encodeURIComponent(amsToken)}&user=${encodeURIComponent(JSON.stringify(userData))}`;
        
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('[SSO] SSO callback error:', error.message);
        
        // Redirect to login page with error
        const frontendUrl = process.env.FRONTEND_URL || 'https://attendance.bylinelms.com';
        const errorMessage = encodeURIComponent(error.message);
        res.redirect(`${frontendUrl}/login?error=sso_error&message=${errorMessage}`);
    }
});

// POST /api/auth/auto-login - Auto-login endpoint for SSO integration
router.post('/auto-login', async (req, res) => {
    try {
        const { appId, returnUrl } = req.body;
        
        if (!appId) {
            return res.status(400).json({ 
                error: 'Application ID is required',
                code: 'MISSING_APP_ID'
            });
        }

        // Get SSO token from cookies or headers
        const ssoToken = req.cookies.accessToken || req.headers.authorization?.replace('Bearer ', '');
        
        if (!ssoToken) {
            return res.status(401).json({ 
                error: 'SSO token required',
                code: 'MISSING_SSO_TOKEN'
            });
        }

        console.log(`[AutoLogin] Processing auto-login for app: ${appId}`);

        // Validate SSO token using existing SSO service
        const ssoUser = await ssoService.validateToken(ssoToken);
        
        // Find or create user in AMS
        const user = await ssoService.findOrCreateUser(ssoUser);
        
        // Create AMS JWT token
        const amsToken = ssoService.createAMSToken(user);

        // Prepare response
        const response = {
            success: true,
            message: 'Auto-login successful',
            token: amsToken,
            user: {
                id: user._id,
                name: user.fullName,
                email: user.email,
                role: user.role,
                authMethod: 'SSO'
            }
        };

        // If returnUrl is provided, redirect to it with token
        if (returnUrl) {
            const redirectUrl = new URL(returnUrl);
            redirectUrl.searchParams.set('token', amsToken);
            redirectUrl.searchParams.set('user', encodeURIComponent(JSON.stringify(response.user)));
            
            return res.redirect(redirectUrl.toString());
        }

        res.json(response);

    } catch (error) {
        console.error('[AutoLogin] Auto-login failed:', error.message);
        
        res.status(401).json({
            error: 'Auto-login failed',
            message: error.message,
            code: 'AUTO_LOGIN_FAILED'
        });
    }
});

// REMOVED: /sso-verify endpoint - use /sso-consume instead
// All SSO authentication should go through /api/auth/sso-consume

// In-memory cache for SSO token verification results (prevents duplicate processing)
// Key: token hash, Value: { result, timestamp }
const ssoTokenCache = new Map();
const SSO_CACHE_TTL = 10000; // 10 seconds

// Helper to create cache key from token
function getTokenCacheKey(token) {
    // Use first 50 chars + last 20 chars as cache key (fast hash)
    return token.substring(0, 50) + token.substring(token.length - 20);
}

// Helper to clean expired cache entries
function cleanExpiredCacheEntries() {
    const now = Date.now();
    for (const [key, value] of ssoTokenCache.entries()) {
        if (now - value.timestamp > SSO_CACHE_TTL) {
            ssoTokenCache.delete(key);
        }
    }
}

// =================================================================
// SSO LOGIN ROUTE - POST /api/auth/sso-consume
// This route handles SSO token authentication from SSO portal
// It is completely independent of standalone login route
// Frontend LoginPage calls this when SSO token is detected in URL
// =================================================================
// POST /api/auth/sso-consume - Consume SSO token from frontend
// This is the ONLY endpoint frontend should call for SSO authentication
router.post('/sso-consume', async (req, res) => {
    try {
        console.log('[SSO Login] SSO consume route called - processing SSO token authentication');
        
        // Ensure MongoDB connection is ready before proceeding
        const mongoose = require('mongoose');
        const connectDB = require('../db');
        
        if (mongoose.connection.readyState !== 1) {
            console.warn('[SSO-Consume] MongoDB not connected (readyState: ' + mongoose.connection.readyState + '), reconnecting...');
            try {
                await connectDB();
                console.log('[SSO-Consume] ✅ MongoDB connection ready');
            } catch (dbError) {
                console.error('[SSO-Consume] ❌ MongoDB reconnection failed:', dbError.message);
                return res.status(503).json({ 
                    error: 'Database connection unavailable',
                    message: 'Please try again in a moment',
                    code: 'DB_CONNECTION_ERROR'
                });
            }
        }
        
        const { token, returnUrl } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'missing_token' });
        }

        // Clean expired cache entries periodically
        cleanExpiredCacheEntries();

        // Check cache for duplicate requests (same token within 2 seconds)
        const cacheKey = getTokenCacheKey(token);
        const cachedResult = ssoTokenCache.get(cacheKey);
        const now = Date.now();
        
        if (cachedResult && (now - cachedResult.timestamp) < 2000) {
            // Same token processed within last 2 seconds - return cached result
            console.log('[SSO-Consume] ⚠️ Duplicate request detected (within 2s), returning cached result');
            return res.json(cachedResult.result);
        }

        console.log('[SSO Login] Processing SSO token from frontend via SSO consume route');
        console.log('[SSO-Consume] Token preview:', token.substring(0, 50) + '...');

        // Verify SSO token using JWKS (RS256 only)
        let decoded;
        try {
            // Decode header first to get kid for better error messages
            const decodedHeader = jwt.decode(token, { complete: true });
            const kid = decodedHeader?.header?.kid;
            const alg = decodedHeader?.header?.alg;
            
            decoded = await jwtUtils.verifySSOTokenWithJWKS(token);
            console.log('[SSO-Consume] ✅ SSO token verified via JWKS');
            console.log('[SSO-Consume] Token payload:', {
                sub: decoded.sub,
                userId: decoded.userId,
                email: decoded.email,
                name: decoded.name,
                role: decoded.role,
                iss: decoded.iss,
                aud: decoded.aud
            });
        } catch (jwtError) {
            console.error('[SSO-Consume] ❌ SSO token verification failed:', jwtError.message);
            
            // Enhanced error logging with kid, issuer, audience info
            try {
                const decodedHeader = jwt.decode(token, { complete: true });
                const kid = decodedHeader?.header?.kid || 'MISSING';
                const alg = decodedHeader?.header?.alg || 'MISSING';
                const payload = decodedHeader?.payload || {};
                
                console.error('[SSO-Consume] Token details:', {
                    kid,
                    alg,
                    iss: payload.iss || 'MISSING',
                    aud: payload.aud || 'MISSING',
                    exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'MISSING'
                });
                
                // Provide structured error response
                return res.status(401).json({
                    success: false,
                    error: 'INVALID_SSO_TOKEN',
                    message: jwtError.message,
                    details: {
                        kid,
                        alg,
                        issuer: payload.iss,
                        audience: payload.aud,
                        expectedKid: 'sso-key-*',
                        expectedAlg: 'RS256'
                    }
                });
            } catch (decodeError) {
                // Fallback if we can't decode
                return res.status(401).json({
                    success: false,
                    error: 'INVALID_SSO_TOKEN',
                    message: jwtError.message,
                    code: 'TOKEN_VERIFICATION_FAILED'
                });
            }
        }
        
        // Extract user data from decoded token
        const rawEmail = decoded.email;
        const userName = decoded.name;
        const userRole = decoded.role;
        const userDepartment = decoded.department;
        const userDesignation = decoded.designation;
        const employeeCode = decoded.employeeCode || decoded.employee_id;
        
        if (!rawEmail) {
            return res.status(400).json({
                error: 'Missing email in SSO token',
                code: 'MISSING_EMAIL'
            });
        }
        
        // Normalize email for matching, but also try exact raw lowercase to support admin-created emails
        const userEmail = normalizeEmail(rawEmail);
        const rawLowerEmail = String(rawEmail).toLowerCase();
        
        console.log('[SSO-Consume] Processing user');
        console.log('[SSO-Consume] Raw email from SSO token:', rawEmail);
        console.log('[SSO-Consume] Normalized email for lookup:', userEmail);

        // Helper function to map SSO role to AMS role
        const mapSSORoleToAMS = (ssoRole) => {
            if (!ssoRole || typeof ssoRole !== 'string') {
                return DEFAULT_SSO_ROLE;
            }
            const roleMapping = {
                'admin': 'Admin',
                'administrator': 'Admin',
                'hr': 'HR',
                'human_resources': 'HR',
                'employee': 'Employee',
                'staff': 'Employee',
                'intern': 'Intern',
                'trainee': 'Intern'
            };
            const normalizedRole = ssoRole.toLowerCase().replace(/[_\s]/g, '_');
            return roleMapping[normalizedRole] || DEFAULT_SSO_ROLE;
        };

        // Find existing user in AMS by normalized OR exact raw lowercase email (prevent duplicate creation)
        let user = await User.findOne({ 
            isActive: true,
            $or: [
                { email: userEmail },            // normalized
                { email: rawLowerEmail }         // exact as stored by admin
            ]
        }).populate('shiftGroup');

        if (!user) {
            // Check if user exists but is inactive (try both variants)
            const inactiveUser = await User.findOne({ 
                isActive: false,
                $or: [
                    { email: userEmail },
                    { email: rawLowerEmail }
                ]
            });
            if (inactiveUser) {
                console.log(`[SSO-Consume] Found inactive user with normalized email: ${userEmail} - reactivating`);
                console.log(`[SSO-Consume] Original raw email was: ${rawEmail}`);
                inactiveUser.isActive = true;
                inactiveUser.authMethod = 'SSO';
                inactiveUser.lastLogin = new Date();
                await inactiveUser.save();
                user = await User.findById(inactiveUser._id).populate('shiftGroup');
                console.log(`[SSO-Consume] ✅ Reactivated existing user: ${userEmail}`);
            } else {
                // Check if auto-provisioning is enabled
                const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
                if (!autoProvision) {
                    console.log(`[SSO-Consume] User ${userEmail} not found and auto-provisioning disabled`);
                    return res.status(403).json({ 
                        error: 'User not found and auto-provisioning disabled',
                        code: 'USER_NOT_FOUND'
                    });
                }

                // Auto-provision new user (only if doesn't exist)
                // IMPORTANT: Store normalized email to maintain consistency
                console.log(`[SSO-Consume] No existing user found with normalized email: ${userEmail}`);
                console.log(`[SSO-Consume] Auto-provisioning new user with normalized email`);
                console.log(`[SSO-Consume] Raw email from SSO: ${rawEmail} -> Normalized: ${userEmail}`);
                
                user = new User({
                    email: userEmail, // Store normalized email for consistency
                    fullName: userName || userEmail.split('@')[0],
                    employeeCode: employeeCode || `SSO_${Date.now()}`,
                    role: mapSSORoleToAMS(userRole),
                    department: userDepartment || 'Unknown',
                    designation: userDesignation || 'Employee',
                    domain: decoded.domain || 'Unknown',
                    passwordHash: 'SSO_USER_NO_PASSWORD',
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
                console.log(`[SSO-Consume] ✅ Successfully created new AMS user with normalized email: ${userEmail}`);
                console.log('[SSO → AMS Sync] Created AMS user', userEmail, 'with ID:', user._id.toString());
            }
        } else {
            // User found using normalized email lookup
            console.log(`[SSO-Consume] ✅ Found existing user via normalized email lookup: ${userEmail}`);
            if (rawEmail !== userEmail) {
                console.log(`[SSO-Consume] Email normalization matched: ${rawEmail} -> ${userEmail}`);
            }
            
            // Update user data from SSO if needed
            const needsUpdate = 
                (userDepartment && user.department !== userDepartment) ||
                (userDesignation && user.designation !== userDesignation) ||
                (employeeCode && user.employeeCode !== employeeCode);

            if (needsUpdate) {
                const updateData = {
                    authMethod: 'SSO'
                };

                if (userDepartment) updateData.department = userDepartment;
                if (userDesignation) updateData.designation = userDesignation;
                if (employeeCode) updateData.employeeCode = employeeCode;

                user = await User.findByIdAndUpdate(
                    user._id,
                    updateData,
                    { new: true }
                ).populate('shiftGroup');

                console.log(`[SSO-Consume] Updated user data for: ${userEmail}`);
            } else {
                console.log('[SSO-Consume] ✅ Using existing AMS user - no update needed');
                console.log('[SSO → AMS Sync] Linked SSO user', rawEmail, '(normalized:', userEmail + ')', 'to existing AMS user', user._id.toString());
            }
            
            // Update last login timestamp
            await User.findByIdAndUpdate(user._id, { lastLogin: new Date() }, { new: false });
        }

        // Check for cached AMS token first
        const cacheService = require('../services/cacheService');
        // Try to get cached token (if we had a token cache per user)
        // For now, always generate new token, but we'll cache it
        
        // Create AMS JWT token with AMS user ID (not SSO user ID)
        console.log('[SSO-Consume] Creating AMS local JWT token for user:', user.email);
        const amsToken = jwtUtils.sign({
            userId: user._id.toString(), // Use AMS user ID, not SSO user ID
            email: user.email,
            role: user.role,
            authMethod: 'SSO'
        }, { expiresIn: '8h' });
        
        console.log('[SSO-Consume] ✅ AMS token generated successfully');
        console.log('[SSO-Consume] AMS token preview:', amsToken.substring(0, 50) + '...');
        
        // Self-verify the token we just created
        try {
            const verified = jwtUtils.verify(amsToken);
            console.log('[SSO-Consume] ✅ AMS token self-verification successful');
            console.log('[SSO-Consume] Verified payload:', { userId: verified.userId, email: verified.email });
        } catch (verifyError) {
            console.error('[SSO-Consume] ❌ AMS token self-verification failed:', verifyError.message);
            throw new Error(`Failed to verify generated AMS token: ${verifyError.message}`);
        }

        // Create session (optional, token-based auth is primary)
        req.session.user = {
            id: user._id.toString(), // Use AMS user ID
            name: user.fullName,
            email: user.email,
            role: user.role,
            authMethod: 'SSO'
        };
        req.session.ssoAuthenticated = true;

        console.log(`[SSO-Consume] ✅ SSO login success: ${userEmail}`);

        // Prepare user data for response
        const userData = {
            id: user._id,
            name: user.fullName,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            email: user.email,
            role: user.role,
            domain: user.domain,
            designation: user.designation,
            department: user.department,
            alternateSaturdayPolicy: user.alternateSaturdayPolicy,
            profileImageUrl: user.profileImageUrl,
            authMethod: 'SSO',
            shift: user.shiftGroup ? {
                id: user.shiftGroup._id,
                name: user.shiftGroup.shiftName,
                startTime: user.shiftGroup.startTime,
                endTime: user.shiftGroup.endTime,
                duration: user.shiftGroup.durationHours,
                paidBreak: user.shiftGroup.paidBreakMinutes,
            } : null
        };

        // Prepare success response with proper format
        const redirectUrlToUse = returnUrl || '/dashboard';
        const successResponse = { 
            success: true, 
            token: amsToken, // Return AMS token, not SSO token
            redirect: redirectUrlToUse, // Use 'redirect' as per requirements
            user: userData
        };

        // Cache the result to prevent duplicate processing
        ssoTokenCache.set(cacheKey, {
            result: successResponse,
            timestamp: Date.now()
        });

        console.log('[SSO-Consume] ✅ SSO consume completed successfully');
        console.log('[SSO-Consume] User:', userEmail);
        console.log('[SSO-Consume] AMS User ID:', user._id.toString());
        console.log('[SSO-Consume] Redirect URL:', redirectUrlToUse);
        console.log('[SSO-Consume] Result cached to prevent duplicate requests');
        console.info('[SSO] Frontend successfully consumed AMS token');

        // Return JSON response (no redirect, no cookies - pure JSON)
        res.status(200).json(successResponse);

    } catch (err) {
        console.error('[SSO-Consume] Unexpected error:', err);
        console.error('[SSO-Consume] Error stack:', err.stack);
        
        // Structured error response
        res.status(401).json({ 
            success: false,
            error: 'SSO_AUTH_FAILED',
            message: err.message,
            code: 'INTERNAL_ERROR'
        });
    }
});

// REMOVED: Duplicate /sso-verify and /sso-login endpoints - use /sso-consume instead
// All SSO authentication should go through /api/auth/sso-consume


module.exports = router;