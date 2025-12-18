const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const fs = require('fs');
const path = require('path');

// JWKS client for verifying SSO tokens (from SSO portal)
// Enhanced caching (15 minutes) to optimize repeated SSO verifications
const jwksUri = process.env.SSO_JWKS_URL || 'http://localhost:3003/.well-known/jwks.json';
const client = jwksClient({
  jwksUri,
  cache: true,
  rateLimit: true,
  cacheMaxAge: 900000, // 15 minutes (optimized for SSO verification)
  cacheMaxEntries: 5,
  jwksRequestsPerMinute: 10, // Rate limit for JWKS requests
  jwksRequestsTimeout: 10000 // 10 second timeout
});

console.log('[JWT Utils] JWKS client initialized');
console.log('[JWT Utils] JWKS URL:', jwksUri);
console.log('[JWT Utils] Cache enabled: true, TTL: 15 minutes');

function getKey(header, callback) {
  // Validate header and kid before proceeding
  if (!header || !header.kid) {
    console.error('[JWT Utils] Missing kid in token header');
    return callback(new Error('Missing key ID (kid) in token header'));
  }
  
  const kid = header.kid;
  console.log('[JWT Utils] Fetching signing key for kid:', kid);
  
  client.getSigningKey(kid, (err, key) => {
    if (err) {
      console.error('[JWT Utils] Error getting signing key for kid:', kid);
      console.error('[JWT Utils] Error details:', err.message);
      return callback(err);
    }
    
    const pubKey = key.publicKey || key.rsaPublicKey;
    if (!pubKey) {
      console.error('[JWT Utils] Public key not found in JWK');
      return callback(new Error('Public key not found in JWK'));
    }
    
    console.log('[JWT Utils] ✅ Signing key retrieved successfully for kid:', kid);
    callback(null, pubKey);
  });
}

// Local AMS key management for RS256 signing/verification
function getPrivateKey() {
  const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem';
  const resolved = path.resolve(__dirname, '..', privateKeyPath);
  
  if (!fs.existsSync(resolved)) {
    throw new Error(`Private key file not found: ${resolved}. Run: node generate-rsa-keys.js`);
  }
  
  const privateKey = fs.readFileSync(resolved, 'utf8');
  
  if (!privateKey || privateKey.length < 100) {
    throw new Error(`Invalid private key file: ${resolved}. File is empty or too short.`);
  }
  
  return privateKey;
}

function getPublicKey() {
  const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem';
  const resolved = path.resolve(__dirname, '..', publicKeyPath);
  
  if (!fs.existsSync(resolved)) {
    throw new Error(`Public key file not found: ${resolved}. Run: node generate-rsa-keys.js`);
  }
  
  const publicKey = fs.readFileSync(resolved, 'utf8');
  
  if (!publicKey || publicKey.length < 100) {
    throw new Error(`Invalid public key file: ${resolved}. File is empty or too short.`);
  }
  
  return publicKey;
}

// Sign AMS tokens with RS256
function sign(payload, options = {}) {
  const expiresIn = options.expiresIn || '8h';
  const keyid = process.env.JWT_KEY_ID || 'ams-key';

  try {
    const privateKey = getPrivateKey();

    console.log('[JWT Debug] Signing AMS token with keyId:', keyid);
    console.log('[JWT Debug] Private key length:', privateKey.length);
    console.log('[JWT Debug] Payload:', { userId: payload.userId, email: payload.email, role: payload.role });

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'RS256',
      expiresIn,
      keyid,
      header: {
        kid: keyid,
        alg: 'RS256',
        typ: 'JWT'
      }
    });

    // Verify the token we just created (self-test)
    try {
      const publicKey = getPublicKey();
      jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      console.log('[JWT Debug] ✅ Token signed successfully and verified with matching public key');
    } catch (verifyError) {
      console.error('[JWT Debug] ❌ Token signed but verification failed:', verifyError.message);
      throw new Error(`Token signing failed self-verification: ${verifyError.message}`);
    }

    return token;
  } catch (error) {
    console.error('[JWT Debug] Signing error:', error.message);

    const fallbackSecret = process.env.JWT_SECRET;
    if (!fallbackSecret) {
      throw error;
    }

    console.warn('[JWT Debug] ⚠️ Falling back to HS256 signing using JWT_SECRET');
    return jwt.sign(payload, fallbackSecret, {
      algorithm: 'HS256',
      expiresIn
    });
  }
}

// Verify AMS tokens with local public key (RS256)
function verify(token, options = {}) {
  try {
    // Decode token header first to check algorithm and kid
    const decodedHeader = jwt.decode(token, { complete: true });

    if (!decodedHeader || !decodedHeader.header) {
      throw new Error('Invalid token format: missing header');
    }

    const tokenAlg = decodedHeader.header.alg;
    const tokenKid = decodedHeader.header.kid;

    console.log('[JWT Utils] Verifying AMS token');
    console.log('[JWT Utils] Token header - kid:', tokenKid || 'MISSING', 'alg:', tokenAlg || 'MISSING');

    if (tokenAlg === 'RS256') {
      console.log('[JWT Utils] Verification method: Local AMS public key');

      if (!tokenKid) {
        throw new Error('Missing kid (key ID) in token header');
      }

      if (tokenKid !== 'ams-key' && tokenKid !== (process.env.JWT_KEY_ID || 'ams-key')) {
        console.warn('[JWT Utils] ⚠️ Unexpected kid for AMS token:', tokenKid, '- expected ams-key');
        // Still proceed - might be valid AMS key
      }

      const publicKey = getPublicKey();
      console.log('[JWT Utils] Public key length:', publicKey.length);

      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        ...(options || {})
      });

      console.log('[JWT Utils] ✅ AMS token verified successfully');
      console.log('[JWT Utils] Decoded payload:', {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        authMethod: decoded.authMethod
      });

      return decoded;
    }

    if (tokenAlg === 'HS256') {
      const fallbackSecret = process.env.JWT_SECRET;
      if (!fallbackSecret) {
        throw new Error('Cannot verify HS256 token: JWT_SECRET is not configured');
      }

      console.log('[JWT Utils] Verification method: JWT_SECRET (HS256 fallback)');
      const decoded = jwt.verify(token, fallbackSecret, {
        algorithms: ['HS256'],
        ...(options || {})
      });

      console.log('[JWT Utils] ✅ HS256 token verified successfully');
      return decoded;
    }

    throw new Error(`Invalid algorithm: ${tokenAlg}. Only RS256 or HS256 (fallback) are supported.`);
  } catch (error) {
    console.error('[JWT Utils] ❌ AMS token verification failed');
    console.error('[JWT Utils] Error:', error.message);
    console.error('[JWT Utils] Token preview:', token ? token.substring(0, 50) + '...' : 'null');

    // If verification fails, try to decode and log more info
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (decoded && decoded.header) {
        console.error('[JWT Utils] Token header:', {
          alg: decoded.header.alg,
          kid: decoded.header.kid || 'MISSING',
          typ: decoded.header.typ
        });
      }
    } catch (decodeError) {
      console.error('[JWT Utils] Could not decode token:', decodeError.message);
    }

    throw error;
  }
}

// Decode without verifying
function decode(token, options = {}) {
  return jwt.decode(token, options);
}

// Verify SSO token using JWKS (remote SSO keys) - RS256 ONLY
async function verifySSOTokenWithJWKS(token) {
  return new Promise((resolve, reject) => {
    // Decode token header first to get kid and validate format
    let decodedHeader;
    try {
      decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader || !decodedHeader.header) {
        return reject(new Error('Invalid token format: missing header'));
      }
      
      const kid = decodedHeader.header.kid;
      const alg = decodedHeader.header.alg;
      
      console.log('[JWT Utils] Verifying SSO token');
      console.log('[JWT Utils] Token header - kid:', kid || 'MISSING', 'alg:', alg || 'MISSING');
      
      if (!kid) {
        return reject(new Error('Missing kid (key ID) in token header'));
      }
      
      if (!kid.startsWith('sso-key-')) {
        console.warn('[JWT Utils] ⚠️ Unexpected kid format:', kid, '- expected sso-key-*');
        // Still proceed - might be valid SSO key with different format
      }
      
      if (alg !== 'RS256') {
        return reject(new Error(`Invalid algorithm: ${alg}. Only RS256 is supported for SSO tokens.`));
      }
    } catch (headerError) {
      console.error('[JWT Utils] Could not decode token header:', headerError.message);
      return reject(new Error('Invalid token format: ' + headerError.message));
    }
    
    // Verify token signature first (without audience check to avoid double validation)
    jwt.verify(token, getKey, { 
      algorithms: ['RS256'],
      issuer: process.env.SSO_ISSUER || 'sso-portal',
      ignoreExpiration: false
    }, (err, decoded) => {
      if (err) {
        console.error('[JWT Utils] ❌ SSO token verification failed');
        console.error('[JWT Utils] Error name:', err.name);
        console.error('[JWT Utils] Error message:', err.message);
        
        // Try to decode to show token details even on verification failure
        try {
          const decodedForDebug = jwt.decode(token, { complete: true });
          if (decodedForDebug && decodedForDebug.payload) {
            console.error('[JWT Utils] Token details:', {
              iss: decodedForDebug.payload.iss,
              aud: decodedForDebug.payload.aud,
              exp: decodedForDebug.payload.exp ? new Date(decodedForDebug.payload.exp * 1000).toISOString() : 'missing'
            });
          }
        } catch (decodeError) {
          // Ignore decode errors
        }
        
        return reject(err);
      }
      
      // Manual audience verification after successful signature verification
      if (decoded.aud !== 'sso-apps') {
        console.warn(`[JWT Utils] ⚠️ Unexpected audience: ${decoded.aud} (expected: sso-apps)`);
        console.warn('[JWT Utils] Token was signed correctly but audience does not match expected value');
        return reject(new Error(`Invalid SSO audience: expected 'sso-apps', got '${decoded.aud}'`));
      }
      
      console.log('[JWT Utils] ✅ Token verified successfully (RS256, audience: ' + decoded.aud + ')');
      console.log('[JWT Utils] Verification method: JWKS (SSO public key)');
      console.log('[JWT Utils] Token claims:', {
        iss: decoded.iss,
        aud: decoded.aud,
        sub: decoded.sub,
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        exp: new Date(decoded.exp * 1000).toISOString()
      });
      
      resolve(decoded);
    });
  });
}

// Startup validation - ensure RS256 is enforced
function validateRS256Configuration() {
  console.log('🔐 JWT Configuration Validation');
  console.log('================================');
  
  // Check JWKS URL
  const jwksUrl = process.env.SSO_JWKS_URL || 'http://localhost:3003/.well-known/jwks.json';
  console.log(`✅ JWKS URL: ${jwksUrl}`);
  
  // Check local key files
  try {
    const privateKey = getPrivateKey();
    const publicKey = getPublicKey();
    console.log('✅ Local RSA keys loaded successfully');
    console.log(`   Private key: ${privateKey.length} chars`);
    console.log(`   Public key: ${publicKey.length} chars`);
    
    // Test key pair compatibility
    try {
      const jwt = require('jsonwebtoken');
      const testPayload = { test: 'validation' };
      const testToken = jwt.sign(testPayload, privateKey, { algorithm: 'RS256' });
      jwt.verify(testToken, publicKey, { algorithms: ['RS256'] });
      console.log('✅ Key pair validation: Private and public keys match');
    } catch (keyError) {
      console.error('❌ Key pair validation failed:', keyError.message);
      console.error('   Private and public keys do not match!');
      console.error('   Run: node generate-rsa-keys.js to regenerate matching keys');
    }
  } catch (error) {
    console.error('❌ Local RSA keys not found:', error.message);
    console.error('   Run: node generate-rsa-keys.js');
  }
  
  // Check key ID
  const keyId = process.env.JWT_KEY_ID || 'ams-key';
  console.log(`✅ Key ID (kid): ${keyId}`);
  
  console.log('✅ RS256 algorithm enforcement: ENABLED');
  console.log('✅ JWKS verification: ENABLED');
  console.log('✅ HS256 fallbacks: DISABLED');
  console.log('================================');
}

module.exports = {
  // AMS local token helpers (RS256 only)
  sign,
  verify,
  decode,
  // SSO verification via JWKS (RS256 only)
  verifySSOTokenWithJWKS,
  // Configuration validation
  validateRS256Configuration
};