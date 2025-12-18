// backend/routes/ssoAuth.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
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

/**
 * POST /api/auth/validate-sso
 * Validate SSO token and create AMS session
 */
router.post('/validate-sso', async (req, res) => {
    try {
        const { sso_token } = req.body;
        
        if (!sso_token) {
            return res.status(400).json({ 
                error: 'SSO token is required',
                code: 'MISSING_SSO_TOKEN'
            });
        }

        console.log('[SSOAuth] Validating SSO token using JWKS (RS256 only)...');
        console.log('[SSOAuth] Token preview:', sso_token.substring(0, 50) + '...');

        // Verify SSO token using JWKS (RS256 only) - same as ssoValidation.js
        let decoded;
        try {
            decoded = await jwtUtils.verifySSOTokenWithJWKS(sso_token);
            console.log('[SSOAuth] JWT validation successful');
            console.log('[SSOAuth] Token payload:', {
                sub: decoded.sub,
                userId: decoded.userId,
                email: decoded.email,
                name: decoded.name,
                role: decoded.role,
                iss: decoded.iss,
                aud: decoded.aud,
                iat: decoded.iat,
                exp: decoded.exp
            });
        } catch (jwtError) {
            console.error('[SSOAuth] JWT validation failed:', jwtError.message);
            return res.status(401).json({
                error: 'Invalid SSO token',
                message: jwtError.message,
                code: 'INVALID_SSO_TOKEN'
            });
        }
        
        // Extract user data from decoded token
        const userEmail = decoded.email;
        const userName = decoded.name;
        const tokenRole = decoded.role || decoded.user?.role || null;
        const userDepartment = decoded.department;
        const userDesignation = decoded.designation;
        const employeeCode = decoded.employeeCode || decoded.employee_id;

        console.log('[SSOAuth] Token decoded for user:', userEmail);

        // Find or create user in AMS
        let user = await User.findOne({ 
            email: userEmail,
            isActive: true 
        }).populate('shiftGroup');

        if (!user) {
            // Check if auto-provisioning is enabled
            const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
            if (!autoProvision) {
                return res.status(403).json({
                    error: 'User not found in AMS and auto-provisioning is disabled',
                    code: 'USER_NOT_FOUND'
                });
            }

            // Auto-provision new user
            console.log(`[SSOAuth] Auto-provisioning new user: ${userEmail}`);
            
            user = new User({
                email: userEmail,
                fullName: userName,
                employeeCode: employeeCode || `SSO_${Date.now()}`,
                role: DEFAULT_SSO_ROLE,
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
            console.log(`[SSOAuth] Successfully created new user: ${userEmail}`);
        } else {
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

                console.log(`[SSOAuth] Updated user data for: ${userEmail}`);
            }
        }

        // Create AMS JWT token
        const amsToken = createAMSToken(user);

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

        console.log(`[SSOAuth] Successfully authenticated user: ${user.email} via SSO`);

        res.json({
            message: 'SSO authentication successful',
            token: amsToken,
            user: userData
        });

    } catch (error) {
        console.error('[SSOAuth] SSO validation error:', error.message);
        
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
 * GET /api/auth/sso-status
 * Check SSO configuration status
 */
router.get('/sso-status', async (req, res) => {
    try {
        const ssoPortalUrl = process.env.SSO_PORTAL_URL;
        const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
        
        res.json({
            ssoEnabled: !!ssoPortalUrl,
            ssoPortalUrl,
            autoProvision,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[SSOAuth] SSO status check failed:', error.message);
        res.status(500).json({
            error: 'Failed to check SSO status',
            message: error.message
        });
    }
});

/**
 * Helper function to map SSO role to AMS role
 */
function mapSSORoleToAMS(ssoRole) {
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
}

/**
 * Helper function to create AMS JWT token
 */
function createAMSToken(user) {
    const payload = { 
        userId: user._id, 
        email: user.email, 
        role: user.role,
        authMethod: 'SSO'
    };
    
    return jwtUtils.sign(payload, { expiresIn: '9h' });
}

module.exports = router;

