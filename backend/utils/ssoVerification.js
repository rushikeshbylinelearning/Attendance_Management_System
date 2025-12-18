// backend/utils/ssoVerification.js
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

/**
 * SSO Token Verification Utility - RS256 ONLY
 * Uses JWKS-RSA for proper RS256 token verification
 * All fallback methods removed for security
 */
class SSOVerification {
  constructor(config) {
    this.config = config;
    this.jwksClient = null;
    
    // Initialize JWKS client if URL is provided
    if (process.env.SSO_JWKS_URL) {
      this.jwksClient = jwksClient({
        jwksUri: process.env.SSO_JWKS_URL,
        cache: true,
        cacheMaxAge: 600000, // 10 minutes
        cacheMaxEntries: 5,
        jwksRequestsPerMinute: 10,
        requestHeaders: {},
        timeout: 30000
      });
      
      console.log('[SSOVerification] JWKS client initialized with URL:', process.env.SSO_JWKS_URL);
    } else {
      throw new Error('SSO_JWKS_URL environment variable is required for RS256 verification');
    }
  }

  /**
   * Get signing key using JWKS client
   * @param {Object} header - JWT header
   * @param {Function} callback - Callback function
   */
  getKey(header, callback) {
    if (!this.jwksClient) {
      return callback(new Error('JWKS client not initialized'));
    }

    console.log('[SSOVerification] Getting signing key for kid:', header.kid);
    
    this.jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) {
        console.error('[SSOVerification] Error getting signing key:', err.message);
        return callback(err);
      }
      
      const signingKey = key.getPublicKey();
      console.log('[SSOVerification] Successfully retrieved signing key');
      callback(null, signingKey);
    });
  }

  /**
   * Verify SSO token using JWKS-based verification (RS256 ONLY)
   * @param {string} token - JWT token to verify
   * @returns {Promise<Object>} Decoded token payload
   */
  async verifyToken(token) {
    if (!token) {
      throw new Error('No token provided');
    }

    console.log('[SSOVerification] Starting RS256 token verification...');
    console.log('[SSOVerification] Token preview:', token.substring(0, 50) + '...');

    // Decode token header to check algorithm
    let decodedHeader;
    try {
      decodedHeader = jwt.decode(token, { complete: true });
      console.log('[SSOVerification] Token header:', {
        alg: decodedHeader.header.alg,
        typ: decodedHeader.header.typ,
        kid: decodedHeader.header.kid
      });
      
      // Enforce RS256 algorithm
      if (decodedHeader.header.alg !== 'RS256') {
        throw new Error(`Unsupported algorithm: ${decodedHeader.header.alg}. Only RS256 is supported.`);
      }
    } catch (e) {
      console.warn('[SSOVerification] Could not decode token header:', e.message);
      throw new Error('Invalid token format or unsupported algorithm');
    }

    // Check if SSO is configured
    if (!this.isConfigured()) {
      throw new Error('SSO not configured - JWKS URL required');
    }

    let decoded = null;

    // JWKS-based verification (ONLY METHOD)
    if (this.jwksClient && decodedHeader.header.kid) {
      try {
        console.log('[SSOVerification] Attempting JWKS-based verification');
        
        decoded = await new Promise((resolve, reject) => {
          jwt.verify(token, (header, callback) => {
            this.getKey(header, callback);
          }, {
            algorithms: ['RS256'], // RS256 ONLY
            issuer: this.config.issuer,
            audience: this.config.audience
          }, (err, decoded) => {
            if (err) {
              reject(err);
            } else {
              resolve(decoded);
            }
          });
        });
        
        console.log('[SSOVerification] Successfully verified with JWKS');
        console.log('[SSOVerification] Token verified for user:', decoded.sub || decoded.user?.email);
        
      } catch (e) {
        console.error('[SSOVerification] JWKS verification failed:', e.message);
        console.error('[SSOVerification] JWKS URL:', process.env.SSO_JWKS_URL);
        throw new Error(`Token verification failed: ${e.message}`);
      }
    } else {
      throw new Error('JWKS client not available or token missing kid');
    }

    if (!decoded) {
      console.error('[SSOVerification] Token verification failed');
      throw new Error('Token verification failed');
    }

    // Validate required claims
    this.validateClaims(decoded);
    
    console.log('[SSOVerification] Token verification successful for user:', decoded.sub || decoded.user?.email);
    return decoded;
  }

  /**
   * Validate required claims in the token
   * @param {Object} decoded - Decoded token payload
   */
  validateClaims(decoded) {
    // Require either appEmail (preferred) or email (fallback)
    const hasEmail = decoded.appEmail || decoded.email || decoded.user?.email;
    const missingClaims = [];

    if (!decoded.sub) {
      missingClaims.push('sub');
    }

    if (!hasEmail) {
      missingClaims.push('appEmail or email');
    }
    
    if (missingClaims.length > 0) {
      throw new Error(`Missing required claims: ${missingClaims.join(', ')}`);
    }
    
    console.log('[SSOVerification] Token claims validated successfully');
    if (decoded.appEmail) {
      console.log('[SSOVerification] ✅ Token includes app-specific credentials');
    }
  }

  /**
   * Extract user claims from decoded token
   * Uses appEmail (app-specific) if available, falls back to SSO email
   * @param {Object} decoded - Decoded token payload
   * @returns {Object} User claims
   */
  extractUserClaims(decoded) {
    // Use appEmail as primary (from AppCredential), fallback to SSO email
    const email = decoded.appEmail || decoded.email || decoded.user?.email;
    const appPassword = decoded.appPassword;
    
    console.log('[SSOVerification] Extracting user claims:', {
      appEmail: email ? email.substring(0, 10) + '...' : 'MISSING',
      ssoEmail: decoded.email ? decoded.email.substring(0, 10) + '...' : 'MISSING',
      hasAppPassword: !!appPassword,
      usingAppCredentials: !!decoded.appEmail
    });
    
    if (!email) {
      throw new Error('Missing email in token (neither appEmail nor email found)');
    }
    
    return {
      id: decoded.sub,
      email,
      appEmail: decoded.appEmail || null,
      appPassword,
      name: decoded.name || decoded.fullName || email.split('@')[0],
      role: null,
      tokenRole: decoded.role || decoded.user?.role || null,
      department: decoded.department || null,
      designation: decoded.designation || null,
      domain: decoded.domain || null,
      employeeCode: decoded.employeeCode || decoded.employee_id || null,
      authMethod: 'SSO'
    };
  }

  /**
   * Check if SSO is properly configured
   * @returns {boolean} True if configured
   */
  isConfigured() {
    const hasJwksUrl = !!process.env.SSO_JWKS_URL;
    const hasJwksClient = !!this.jwksClient;
    
    console.log('[SSOVerification] Configuration check:', {
      hasJwksUrl,
      hasJwksClient,
      jwksUrl: process.env.SSO_JWKS_URL
    });
    
    return hasJwksUrl && hasJwksClient;
  }
}

module.exports = SSOVerification;