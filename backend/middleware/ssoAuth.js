// backend/middleware/ssoAuth.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const NodeRSA = require('node-rsa');
const User = require('../models/User');

class SSOAuthMiddleware {
    constructor() {
        this.ssoPortalUrl = process.env.SSO_PORTAL_URL || 'http://localhost:5000';
        this.jwksUrl = `${this.ssoPortalUrl}/api/auth/jwks`;
        this.validateUrl = `${this.ssoPortalUrl}/api/auth/validate`;
        this.publicKeys = new Map(); // Cache for public keys
        this.keyCacheExpiry = null;
        this.cacheDuration = 24 * 60 * 60 * 1000; // 24 hours
        this.requestTimeout = 10000; // 10 seconds
    }

    /**
     * Fetch and cache JWKS from SSO Portal
     */
    async fetchJWKS() {
        // Check if we have valid cached keys
        if (this.publicKeys.size > 0 && this.keyCacheExpiry && Date.now() < this.keyCacheExpiry) {
            return this.publicKeys;
        }

        try {
            console.log(`[SSOAuth] Fetching JWKS from: ${this.jwksUrl}`);
            
            const response = await axios.get(this.jwksUrl, {
                timeout: this.requestTimeout,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'AMS-Portal/1.0'
                }
            });

            if (!response.data || !response.data.keys) {
                throw new Error('Invalid JWKS response format');
            }

            // Clear existing keys
            this.publicKeys.clear();

            // Process each key in the JWKS
            for (const key of response.data.keys) {
                if (key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256') {
                    try {
                        // Convert JWK to PEM format
                        const rsaKey = new NodeRSA();
                        rsaKey.importKey({
                            n: key.n,
                            e: key.e,
                            kty: key.kty,
                            use: key.use,
                            alg: key.alg,
                            kid: key.kid
                        }, 'jwk');
                        
                        const publicKeyPem = rsaKey.exportKey('public');
                        this.publicKeys.set(key.kid, publicKeyPem);
                        
                        console.log(`[SSOAuth] Cached public key: ${key.kid}`);
                    } catch (keyError) {
                        console.warn(`[SSOAuth] Failed to process key ${key.kid}:`, keyError.message);
                    }
                }
            }

            if (this.publicKeys.size === 0) {
                throw new Error('No valid RSA keys found in JWKS');
            }

            // Set cache expiry
            this.keyCacheExpiry = Date.now() + this.cacheDuration;
            console.log(`[SSOAuth] Successfully cached ${this.publicKeys.size} public keys`);

            return this.publicKeys;
        } catch (error) {
            console.error('[SSOAuth] Failed to fetch JWKS:', error.message);
            throw new Error(`Failed to fetch SSO public keys: ${error.message}`);
        }
    }

    /**
     * Get public key by key ID
     */
    async getPublicKey(keyId) {
        // Ensure we have keys cached
        await this.fetchJWKS();
        
        const publicKey = this.publicKeys.get(keyId);
        if (!publicKey) {
            throw new Error(`Public key not found for key ID: ${keyId}`);
        }
        
        return publicKey;
    }

    /**
     * Validate JWT token using SSO Portal public keys
     */
    async validateToken(token) {
        try {
            if (!token) {
                throw new Error('Token is required');
            }

            // Decode token header to get key ID
            const decodedHeader = jwt.decode(token, { complete: true });
            if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
                throw new Error('Token missing key ID in header');
            }

            const keyId = decodedHeader.header.kid;
            console.log(`[SSOAuth] Validating token with key ID: ${keyId}`);

            // Get the appropriate public key
            let publicKey;
            try {
                publicKey = await this.getPublicKey(keyId);
            } catch (keyError) {
                // If specific key not found, try to refresh JWKS and try again
                console.log(`[SSOAuth] Key ${keyId} not found, refreshing JWKS...`);
                this.keyCacheExpiry = null; // Force refresh
                await this.fetchJWKS();
                publicKey = await this.getPublicKey(keyId);
            }

            // Verify the token
            const decoded = jwt.verify(token, publicKey, {
                algorithms: ['RS256'],
                issuer: 'sso-portal',
                audience: (aud) => {
                    // Allow both general audience and specific app audience
                    return aud === 'sso-apps' || typeof aud === 'string';
                }
            });

            // Validate required claims
            if (!decoded.sub && !decoded.user?.id) {
                throw new Error('Token missing required user identifier');
            }

            const identityEmail = decoded.appEmail || decoded.email || decoded.user?.email;
            if (!identityEmail) {
                throw new Error('Token missing required email claim');
            }

            console.log(`[SSOAuth] Token validated successfully for user: ${identityEmail}`);
            return decoded;

        } catch (error) {
            console.error('[SSOAuth] Token validation failed:', error.message);
            
            if (error.name === 'TokenExpiredError') {
                throw new Error('Token has expired');
            } else if (error.name === 'JsonWebTokenError') {
                throw new Error('Invalid token format');
            } else if (error.name === 'NotBeforeError') {
                throw new Error('Token not yet valid');
            }
            
            throw new Error(`Token validation failed: ${error.message}`);
        }
    }

    /**
     * Main middleware function
     */
    protect = async (req, res, next) => {
        try {
            // Extract token from Authorization header
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.log('[SSOAuth] No valid authorization header found');
                return res.status(401).json({ 
                    error: 'Authorization header required',
                    code: 'MISSING_AUTH_HEADER'
                });
            }

            const token = authHeader.substring(7); // Remove 'Bearer ' prefix
            console.log(`[SSOAuth] Validating token for ${req.method} ${req.path}`);

            // Validate the token
            const decoded = await this.validateToken(token);

            const identityEmail = decoded.appEmail || decoded.email || decoded.user?.email;

            if (!identityEmail) {
                console.error('[SSOAuth] Token missing email claim after verification');
                return res.status(400).json({
                    error: 'Token missing required email claim',
                    code: 'MISSING_EMAIL'
                });
            }

            const user = await User.findOne({ email: identityEmail, isActive: true }).lean();

            if (!user) {
                console.warn(`[SSOAuth] Local user not found for email ${identityEmail}`);
                return res.status(403).json({
                    error: 'User not found in application database',
                    code: 'USER_NOT_FOUND'
                });
            }

            req.user = {
                id: user._id,
                userId: user._id,
                email: user.email,
                name: user.fullName || user.name || identityEmail,
                role: user.role,
                department: user.department,
                position: user.designation || user.position,
                employeeId: user.employeeCode || user.employeeId,
                authMethod: 'SSO',
                token: decoded
            };

            console.log(`[SSOAuth] User authenticated: ${req.user.email} (role from DB: ${req.user.role})`);
            next();

        } catch (error) {
            console.error('[SSOAuth] Authentication failed:', error.message);
            
            let errorCode = 'AUTH_FAILED';
            let statusCode = 401;
            
            if (error.message.includes('expired')) {
                errorCode = 'TOKEN_EXPIRED';
            } else if (error.message.includes('Invalid token')) {
                errorCode = 'INVALID_TOKEN';
            } else if (error.message.includes('missing')) {
                errorCode = 'MISSING_AUTH_HEADER';
            }

            return res.status(statusCode).json({
                error: 'Authentication failed',
                message: error.message,
                code: errorCode
            });
        }
    };

    /**
     * Initialize the middleware (fetch keys on startup)
     */
    async initialize() {
        // Only initialize if SSO is properly configured
        if (!this.ssoPortalUrl || this.ssoPortalUrl === 'http://localhost:5000') {
            console.log('[SSOAuth] SSO middleware disabled - no valid SSO_PORTAL_URL configured');
            return;
        }

        try {
            await this.fetchJWKS();
            console.log('[SSOAuth] SSO authentication middleware initialized successfully');
        } catch (error) {
            console.error('[SSOAuth] Failed to initialize SSO middleware:', error.message);
            console.log('[SSOAuth] SSO middleware will be disabled until SSO portal is available');
            // Don't throw error to prevent server startup failure
            // Middleware will attempt to fetch keys on first use
        }
    }
}

// Create singleton instance
const ssoAuthMiddleware = new SSOAuthMiddleware();

// Initialize on module load
ssoAuthMiddleware.initialize();

module.exports = ssoAuthMiddleware;

