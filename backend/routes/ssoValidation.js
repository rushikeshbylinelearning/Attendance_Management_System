// backend/routes/ssoValidation.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwtUtils = require('../utils/jwtUtils');

const DEFAULT_SSO_ROLE = (() => {
  const allowed = ['Admin', 'HR', 'Employee', 'Intern'];
  const envRole = process.env.SSO_DEFAULT_ROLE;
  if (envRole && typeof envRole === 'string') {
    const normalized = envRole.trim();
    const match = allowed.find(
      role => role.toLowerCase() === normalized.toLowerCase()
    );
    if (match) {
      return match;
    }
  }
  return 'Employee';
})();

/**
 * POST /api/auth/validate-sso
 * Validate SSO token and create AMS session
 * Uses RS256 with JWKS verification (NO HS256 fallback)
 */
router.post('/validate-sso', async (req, res) => {
    try {
        console.log('[SSOValidation] Received SSO validation request');
        const { sso_token } = req.body;
        
        if (!sso_token) {
            console.log('[SSOValidation] No SSO token provided');
            return res.status(400).json({ 
                error: 'SSO token is required',
                code: 'MISSING_SSO_TOKEN'
            });
        }

        console.log('[SSOValidation] Validating SSO token using JWKS (RS256 only)...');
        console.log('[SSOValidation] Token preview:', sso_token.substring(0, 50) + '...');

        // Verify SSO token using JWKS (RS256 only)
        let decoded;
        try {
            decoded = await jwtUtils.verifySSOTokenWithJWKS(sso_token);
            console.log('[SSOValidation] JWT validation successful');
            console.log('[SSOValidation] Token payload:', {
                sub: decoded.sub,
                userId: decoded.userId,
                email: decoded.email,
                appEmail: decoded.appEmail,
                appName: decoded.appName,
                name: decoded.name,
                role: decoded.role,
                iss: decoded.iss,
                aud: decoded.aud,
                iat: decoded.iat,
                exp: decoded.exp
            });
        } catch (jwtError) {
            console.error('[SSOValidation] JWT validation failed:', jwtError.message);
            return res.status(401).json({
                error: 'Invalid SSO token',
                message: jwtError.message,
                code: 'INVALID_SSO_TOKEN'
            });
        }
        
        // Extract user data from decoded token - use appEmail if available
        const appEmail = decoded.appEmail || decoded.email || decoded.user?.email;
        const appPassword = decoded.appPassword;
        const ssoEmail = decoded.email || decoded.user?.email;
        
        console.log('[SSOValidation] Credential extraction:', {
            appEmail: appEmail ? appEmail.substring(0, 10) + '...' : 'MISSING',
            ssoEmail: ssoEmail ? ssoEmail.substring(0, 10) + '...' : 'MISSING',
            hasAppPassword: !!appPassword,
            usingAppCredentials: !!decoded.appEmail
        });
        
        if (!appEmail) {
            console.error('[SSOValidation] ❌ Missing appEmail in token');
            return res.status(400).json({
                error: 'Missing appEmail in SSO token',
                message: 'Missing appEmail in SSO token. Please ensure app credentials are stored in SSO portal.',
                code: 'MISSING_APP_EMAIL'
            });
        }
        
        const userName = decoded.name;
        const tokenRole = decoded.role || decoded.user?.role || null;
        const userDepartment = decoded.department;
        const userDesignation = decoded.designation;
        const employeeCode = decoded.employeeCode || decoded.employee_id;

        console.log('[SSOValidation] Token decoded for user:', appEmail);
        console.log('[SSOValidation] Token role (for diagnostics only):', tokenRole || 'not provided');

        // Find or create user in AMS using appEmail (not SSO email)
        let user = await User.findOne({ 
            email: appEmail, // Use appEmail
            isActive: true 
        }).populate('shiftGroup');

        if (!user) {
            // Check if auto-provisioning is enabled
            const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
            if (!autoProvision) {
                console.log('[SSOValidation] User not found and auto-provisioning disabled');
                return res.status(403).json({
                    error: 'User not found in AMS and auto-provisioning is disabled',
                    code: 'USER_NOT_FOUND'
                });
            }

            // Auto-provision new user using appEmail
            console.log(`[SSOValidation] Auto-provisioning new user: ${appEmail}`);
            
            // Hash password if provided in token
            let passwordHash = 'SSO_USER_NO_PASSWORD';
            if (appPassword) {
                const bcrypt = require('bcrypt');
                passwordHash = await bcrypt.hash(appPassword, 10);
                console.log(`[SSOValidation] Hashed password for new user: ${appEmail}`);
            }
            
            user = new User({
                email: appEmail, // Use appEmail
                fullName: userName,
                employeeCode: employeeCode || `SSO_${Date.now()}`,
                role: DEFAULT_SSO_ROLE,
                department: userDepartment || 'Unknown',
                designation: userDesignation || 'Employee',
                domain: decoded.domain || 'Unknown',
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
            console.log(`[SSOValidation] Successfully created new user: ${appEmail}`);
        } else {
            console.log(`[SSOValidation] Found existing AMS user: ${appEmail}`);
            
            // Verify app password if provided in token
            if (appPassword && user.passwordHash && user.passwordHash !== 'SSO_USER_NO_PASSWORD') {
                const bcrypt = require('bcrypt');
                try {
                    const isPasswordValid = await bcrypt.compare(appPassword, user.passwordHash);
                    if (!isPasswordValid) {
                        console.error(`[SSOValidation] ❌ Password verification failed for user: ${appEmail}`);
                        return res.status(401).json({
                            error: 'Invalid app credentials',
                            message: 'Invalid app credentials',
                            code: 'INVALID_CREDENTIALS'
                        });
                    }
                    console.log(`[SSOValidation] ✅ Password verification successful for user: ${appEmail}`);
                } catch (passwordError) {
                    console.error(`[SSOValidation] ❌ Password verification error: ${passwordError.message}`);
                    return res.status(500).json({
                        error: 'Password verification failed',
                        message: 'Password verification failed',
                        code: 'PASSWORD_VERIFICATION_ERROR'
                    });
                }
            } else if (appPassword && (!user.passwordHash || user.passwordHash === 'SSO_USER_NO_PASSWORD')) {
                // User has no password set (SSO-only user), skip password verification
                console.log(`[SSOValidation] ⚠️ User ${appEmail} has no password set, skipping password verification`);
            } else if (!appPassword) {
                // No password in token, skip verification (backward compatibility)
                console.log(`[SSOValidation] ⚠️ No app password in token, skipping password verification`);
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

                console.log(`[SSOValidation] Updated user data for: ${appEmail}`);
            }
        }

        // Create AMS JWT token
        console.log('[SSOValidation] Creating AMS local JWT token for user:', user.email);
        const amsToken = createAMSToken(user);
        console.log('[SSOValidation] ✅ AMS token generated successfully');
        console.log('[SSOValidation] Token preview:', amsToken.substring(0, 50) + '...');
        
        // Self-verify the token we just created
        try {
            const jwtUtils = require('../utils/jwtUtils');
            const verified = jwtUtils.verify(amsToken);
            console.log('[SSOValidation] ✅ AMS token self-verification successful');
            console.log('[SSOValidation] Verified payload:', { userId: verified.userId, email: verified.email });
        } catch (verifyError) {
            console.error('[SSOValidation] ❌ AMS token self-verification failed:', verifyError.message);
            throw new Error(`Failed to verify generated AMS token: ${verifyError.message}`);
        }

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

        console.log(`[SSOValidation] Successfully authenticated user: ${user.email} via SSO`);

        res.json({
            message: 'SSO authentication successful',
            token: amsToken,
            user: userData
        });

    } catch (error) {
        console.error('[SSOValidation] SSO validation error:', error.message);
        
        let errorCode = 'SSO_VALIDATION_FAILED';
        let statusCode = 401;
        
        if (error.message.includes('expired')) {
            errorCode = 'TOKEN_EXPIRED';
        } else if (error.message.includes('Invalid token')) {
            errorCode = 'INVALID_TOKEN';
        } else if (error.message.includes('not found')) {
            errorCode = 'USER_NOT_FOUND';
            statusCode = 403;
        }

        res.status(statusCode).json({
            error: 'SSO validation failed',
            message: error.message,
            code: errorCode
        });
    }
});

/**
 * Helper function to create AMS JWT token
 */
function createAMSToken(user) {
    const payload = { 
        userId: user._id.toString(), 
        email: user.email, 
        role: user.role,
        authMethod: 'SSO'
    };
    
    console.log('[SSOValidation] Creating AMS token with payload:', payload);
    
    // Use jwtUtils.sign which handles RS256 signing with proper key pair
    const token = jwtUtils.sign(payload, { expiresIn: '8h' });
    
    console.log('[SSOValidation] AMS token created successfully');
    return token;
}

module.exports = router;


