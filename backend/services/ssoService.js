// backend/services/ssoService.js
const jwt = require('jsonwebtoken');
const jwtUtils = require('../utils/jwtUtils');
const axios = require('axios');
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

// Note: This service is legacy and uses old public key fetching.
// New code should use jwtUtils.verifySSOTokenWithJWKS() for RS256 verification.

class SSOService {
    constructor() {
        this.publicKey = null;
        this.publicKeyUrl = process.env.SSO_PUBLIC_KEY_URL;
        this.appId = process.env.SSO_APP_ID || 'ams-portal';
        this.keyCacheExpiry = null;
        this.keyCacheDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    }

    /**
     * Fetch and cache the SSO public key
     */
    async fetchPublicKey() {
        if (!this.publicKeyUrl) {
            throw new Error('SSO_PUBLIC_KEY_URL environment variable is not set');
        }

        // Check if we have a cached key that's still valid
        if (this.publicKey && this.keyCacheExpiry && Date.now() < this.keyCacheExpiry) {
            return this.publicKey;
        }

        try {
            console.log(`[SSOService] Fetching public key from: ${this.publicKeyUrl}`);
            const response = await axios.get(this.publicKeyUrl, {
                timeout: 10000, // 10 second timeout
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'AMS-Portal/1.0'
                }
            });

            if (response.data && response.data.publicKey) {
                this.publicKey = response.data.publicKey;
                this.keyCacheExpiry = Date.now() + this.keyCacheDuration;
                console.log('[SSOService] Public key fetched and cached successfully');
                return this.publicKey;
            } else {
                throw new Error('Invalid response format from SSO public key endpoint');
            }
        } catch (error) {
            console.error('[SSOService] Failed to fetch public key:', error.message);
            throw new Error(`Failed to fetch SSO public key: ${error.message}`);
        }
    }

    /**
     * Validate SSO JWT token
     */
    async validateToken(token) {
        try {
            if (!token) {
                throw new Error('SSO token is required');
            }

            // Fetch public key if not cached
            const publicKey = await this.fetchPublicKey();

            // Verify the token
            const decoded = jwt.verify(token, publicKey, {
                algorithms: ['RS256', 'RS384', 'RS512'], // Common RSA algorithms
                audience: this.appId, // Verify audience matches our app ID
                issuer: process.env.SSO_ISSUER || undefined, // Optional issuer validation
            });

            // Validate required claims
            if (!decoded.id && !decoded.sub) {
                throw new Error('Token missing required user identifier');
            }

            if (!decoded.email) {
                throw new Error('Token missing required email claim');
            }

            // Map SSO user data to AMS format
            const ssoUser = {
                id: decoded.id || decoded.sub,
                email: decoded.email,
                name: decoded.name || decoded.fullName || decoded.email.split('@')[0],
                role: this.mapSSORoleToAMS(decoded.role),
                department: decoded.department || null,
                designation: decoded.designation || null,
                domain: decoded.domain || null,
                employeeCode: decoded.employeeCode || decoded.employee_id || null,
            };

            console.log(`[SSOService] Token validated for user: ${ssoUser.email}`);
            return ssoUser;

        } catch (error) {
            console.error('[SSOService] Token validation failed:', error.message);
            throw new Error(`SSO token validation failed: ${error.message}`);
        }
    }

    /**
     * Map SSO role to AMS role
     */
    mapSSORoleToAMS(ssoRole) {
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
     * Find or create user from SSO data
     */
    async findOrCreateUser(ssoUser) {
        try {
            // First, try to find user by email
            let user = await User.findOne({ 
                email: ssoUser.email,
                isActive: true 
            }).populate('shiftGroup');

            if (user) {
                console.log(`[SSOService] Found existing user: ${ssoUser.email}`);
                
                // Update user data from SSO if needed
                const needsUpdate = 
                    (ssoUser.department && user.department !== ssoUser.department) ||
                    (ssoUser.designation && user.designation !== ssoUser.designation) ||
                    (ssoUser.employeeCode && user.employeeCode !== ssoUser.employeeCode);

                if (needsUpdate) {
                    const updateData = {
                        authMethod: 'SSO'
                    };

                    if (ssoUser.department) updateData.department = ssoUser.department;
                    if (ssoUser.designation) updateData.designation = ssoUser.designation;
                    if (ssoUser.employeeCode) updateData.employeeCode = ssoUser.employeeCode;

                    user = await User.findByIdAndUpdate(
                        user._id,
                        updateData,
                        { new: true }
                    ).populate('shiftGroup');

                    console.log(`[SSOService] Updated user data for: ${ssoUser.email}`);
                }

                return user;
            }

            // User doesn't exist, check if auto-provisioning is enabled
            const autoProvision = process.env.SSO_AUTO_PROVISION === 'true';
            if (!autoProvision) {
                throw new Error(`User ${ssoUser.email} not found in AMS and auto-provisioning is disabled`);
            }

            // Auto-provision new user
            console.log(`[SSOService] Auto-provisioning new user: ${ssoUser.email}`);
            
            const newUser = new User({
                email: ssoUser.email,
                fullName: ssoUser.name,
                employeeCode: ssoUser.employeeCode || `SSO_${Date.now()}`, // Generate unique employee code if not provided
                role: ssoUser.role || DEFAULT_SSO_ROLE,
                department: ssoUser.department || 'Unknown',
                designation: ssoUser.designation || 'Employee',
                domain: ssoUser.domain || 'Unknown',
                passwordHash: 'SSO_USER_NO_PASSWORD', // Placeholder for SSO users
                joiningDate: new Date(),
                isActive: true,
                authMethod: 'SSO',
                // Set default feature permissions for SSO users
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

            await newUser.save();
            console.log(`[SSOService] Successfully created new user: ${ssoUser.email}`);

            return await User.findById(newUser._id).populate('shiftGroup');

        } catch (error) {
            console.error('[SSOService] Error finding/creating user:', error.message);
            throw error;
        }
    }

    /**
     * Create AMS JWT token for SSO user
     * Uses RS256 with AMS local private key
     */
    createAMSToken(user) {
        const payload = { 
            userId: user._id.toString(), // Ensure userId is a string
            email: user.email, 
            role: user.role,
            authMethod: 'SSO' // Flag to indicate this is an SSO login
        };
        
        console.log('[SSOService] Creating AMS token with payload:', payload);
        
        // Use jwtUtils.sign which handles RS256 signing with proper key pair
        const token = jwtUtils.sign(payload, { expiresIn: '8h' });
        
        console.log('[SSOService] ✅ AMS token created successfully');
        return token;
    }

    /**
     * Initialize SSO service (fetch public key on startup)
     */
    async initialize() {
        if (!this.publicKeyUrl) {
            console.log('[SSOService] SSO_PUBLIC_KEY_URL not configured, SSO functionality disabled');
            return;
        }

        try {
            await this.fetchPublicKey();
            console.log('[SSOService] SSO service initialized successfully');
        } catch (error) {
            console.error('[SSOService] Failed to initialize SSO service:', error.message);
            // Don't throw error here to prevent server startup failure
            // SSO will be disabled until the public key can be fetched
        }
    }
}

module.exports = new SSOService();

