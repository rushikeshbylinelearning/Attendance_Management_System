// backend/middleware/ssoTokenAuth.js
const User = require('../models/User');
const SSOVerification = require('../utils/ssoVerification');

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
 * SSO Token Authentication Middleware
 * Handles sso_token query parameter for seamless SSO login
 * Supports RS256 verification using JWKS, public key, or validate endpoint
 */
function ssoTokenAuth(SSO_CONFIG) {
  const ssoVerification = new SSOVerification(SSO_CONFIG);
  
  return async (req, res, next) => {
    // CRITICAL: Skip all POST requests, API routes, and the login page itself
    // This ensures standalone login route (/api/auth/login) is never interfered with
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      return next();
    }
    
    // Skip the login page route - let frontend handle SSO token processing
    // The frontend LoginPage will handle SSO tokens via /api/auth/sso-consume
    if (req.path === '/login' || req.path.startsWith('/login')) {
      return next();
    }
    
    const token = req.query.sso_token;
    
    // If no SSO token, continue with normal flow
    if (!token) {
      return next();
    }

    // If SSO is not configured, redirect to SSO portal
    if (!ssoVerification.isConfigured()) {
      console.log('[SSOAuth] SSO not configured, redirecting to SSO portal');
      const redirectUrl = process.env.NODE_ENV === 'production'
        ? 'https://sso.bylinelms.com/login'
        : 'http://localhost:3000/login';
      return res.redirect(redirectUrl);
    }

    try {
      console.log('[SSOAuth] Processing SSO token...');
      
      // Verify the SSO token using the new verification utility
      const decoded = await ssoVerification.verifyToken(token);
      
      // Extract user claims (now includes appEmail/appPassword if available)
      const userClaims = ssoVerification.extractUserClaims(decoded);
      
      // Use appEmail for user lookup (primary), fallback to SSO email
      const lookupEmail = userClaims.appEmail || userClaims.email;
      
      console.log('[SSOAuth] Using email for lookup:', lookupEmail);
      console.log('[SSOAuth] App email available:', !!userClaims.appEmail);
      console.log('[SSOAuth] App password available:', !!userClaims.appPassword);

      // Find or create user using appEmail (not SSO email)
      let user = await User.findOne({ 
        email: lookupEmail, // Use appEmail if available
        isActive: true 
      }).populate('shiftGroup');

      if (!user) {
        // Check if auto-provisioning is enabled
        const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
        if (!autoProvision) {
          console.log(`[SSOAuth] User ${userClaims.email} not found and auto-provisioning disabled`);
          const redirectUrl = process.env.NODE_ENV === 'production'
            ? 'https://sso.bylinelms.com/login'
            : 'http://localhost:3000/login';
          return res.redirect(redirectUrl);
        }

        // Auto-provision new user using appEmail
        console.log(`[SSOAuth] Auto-provisioning new user: ${lookupEmail}`);
        
        // Hash password if provided in token
        let passwordHash = 'SSO_USER_NO_PASSWORD';
        if (userClaims.appPassword) {
          const bcrypt = require('bcrypt');
          passwordHash = await bcrypt.hash(userClaims.appPassword, 10);
          console.log(`[SSOAuth] Hashed password for new user: ${lookupEmail}`);
        }
        
        user = new User({
          email: lookupEmail,
          fullName: userClaims.name || lookupEmail.split('@')[0],
          employeeCode: userClaims.employeeCode || `SSO_${Date.now()}`,
          role: DEFAULT_SSO_ROLE,
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
        console.log(`[SSOAuth] Successfully created new user: ${lookupEmail}`);
      } else {
        console.log(`[SSOAuth] Found existing AMS user: ${lookupEmail}`);
        
        // Verify app password if provided in token
        if (userClaims.appPassword && user.passwordHash && user.passwordHash !== 'SSO_USER_NO_PASSWORD') {
          const bcrypt = require('bcrypt');
          try {
            const isPasswordValid = await bcrypt.compare(userClaims.appPassword, user.passwordHash);
            if (!isPasswordValid) {
              console.error(`[SSOAuth] ❌ Password verification failed for user: ${lookupEmail}`);
              const redirectUrl = process.env.NODE_ENV === 'production'
                ? 'https://sso.bylinelms.com/login'
                : 'http://localhost:3000/login';
              return res.redirect(redirectUrl);
            }
            console.log(`[SSOAuth] ✅ Password verification successful for user: ${lookupEmail}`);
          } catch (passwordError) {
            console.error(`[SSOAuth] ❌ Password verification error: ${passwordError.message}`);
            const redirectUrl = process.env.NODE_ENV === 'production'
              ? 'https://sso.bylinelms.com/login'
              : 'http://localhost:3000/login';
            return res.redirect(redirectUrl);
          }
        } else if (userClaims.appPassword && (!user.passwordHash || user.passwordHash === 'SSO_USER_NO_PASSWORD')) {
          // User has no password set (SSO-only user), skip password verification
          console.log(`[SSOAuth] ⚠️ User ${lookupEmail} has no password set, skipping password verification`);
        } else if (!userClaims.appPassword) {
          // No password in token, skip verification (backward compatibility)
          console.log(`[SSOAuth] ⚠️ No app password in token, skipping password verification`);
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

          console.log(`[SSOAuth] Updated user data for: ${lookupEmail}`);
        }
      }

      // Create session
      req.session.user = {
        id: user._id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        authMethod: 'SSO'
      };
      req.session.ssoAuthenticated = true;

      console.log(`✅ SSO Login: ${lookupEmail}`);

      // Redirect to intended route
      const returnUrl = req.query.return_url || '/dashboard';
      return res.redirect(returnUrl);

    } catch (err) {
      console.error('❌ Invalid SSO token:', err.message);
      const redirectUrl = process.env.NODE_ENV === 'production'
        ? 'https://sso.bylinelms.com/login'
        : 'http://localhost:3000/login';
      return res.redirect(redirectUrl);
    }
  };
}

module.exports = ssoTokenAuth;

