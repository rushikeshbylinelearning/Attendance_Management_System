// backend/middleware/authenticateToken.js
// Supports both AMS local tokens and SSO tokens (RS256)
const jwt = require('jsonwebtoken');
const jwtUtils = require('../utils/jwtUtils');
const { normalizeEmail } = require('../utils/emailUtils');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        console.log('[AuthenticateToken] No authorization header or token found');
        return res.sendStatus(401); // Unauthorized
    }

    // Use async IIFE to handle async token verification
    (async () => {
        try {
            // Ensure MongoDB connection before proceeding
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.log('[AuthenticateToken] MongoDB not ready, waiting...');
                await new Promise((resolve, reject) => {
                    if (mongoose.connection.readyState === 1) return resolve();
                    const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 5000);
                    mongoose.connection.once('connected', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }

            // Decode token header to determine type
            const decodedHeader = jwt.decode(token, { complete: true });
            if (!decodedHeader || !decodedHeader.header) {
                throw new Error('Invalid token format: missing header');
            }

            const kid = decodedHeader.header.kid;
            const alg = decodedHeader.header.alg;

            console.log('[AuthenticateToken] Token header - kid:', kid || 'MISSING', 'alg:', alg || 'MISSING');

            let user;

            // Determine token type and verify accordingly
            if (alg === 'HS256') {
                console.log('[AuthenticateToken] Detected legacy HS256 token, verifying with JWT_SECRET...');
                const decoded = jwtUtils.verify(token);
                user = {
                    userId: decoded.userId || decoded.id,
                    email: decoded.email,
                    role: decoded.role,
                    authMethod: decoded.authMethod || 'local'
                };
                console.log('[AuthenticateToken] ✅ HS256 token verified for user:', user.userId);
            } else if (!kid) {
                throw new Error('Missing kid (key ID) in token header');
            } else if (kid.startsWith('sso-key-')) {
                // SSO token - verify using JWKS
                console.log('[AuthenticateToken] Detected SSO token (kid: ' + kid + '), verifying with JWKS...');
                const decoded = await jwtUtils.verifySSOTokenWithJWKS(token);
                
                // Normalize email, but also try exact raw lowercase for admin-created emails
                const rawEmail = decoded.email;
                const normalizedEmail = normalizeEmail(rawEmail);
                const rawLowerEmail = String(rawEmail).toLowerCase();

                // For SSO tokens, find user by normalized OR exact raw lowercase
                const User = require('../models/User');
                const dbUser = await User.findOne({ 
                    isActive: true,
                    $or: [
                        { email: normalizedEmail },
                        { email: rawLowerEmail }
                    ]
                }).lean();
                
                if (!dbUser) {
                    throw new Error('User not found for SSO token email: ' + normalizedEmail + ' (raw: ' + rawEmail + ')');
                }
                
                user = {
                    userId: dbUser._id.toString(),
                    email: dbUser.email,
                    role: dbUser.role,
                    authMethod: 'SSO'
                };
                console.log('[AuthenticateToken] ✅ SSO token verified for user:', user.email);
                if (rawEmail !== normalizedEmail) {
                    console.log('[AuthenticateToken] Email normalization matched:', rawEmail, '->', normalizedEmail);
                }
            } else {
                if (alg !== 'RS256') {
                    throw new Error(`Invalid algorithm: ${alg}. Only RS256 or HS256 (fallback) are supported.`);
                }

                // AMS local token - verify using local public key
                console.log('[AuthenticateToken] Detected AMS local token (kid: ' + kid + '), verifying...');
                const decoded = jwtUtils.verify(token);
                user = {
                    userId: decoded.userId || decoded.id,
                    email: decoded.email,
                    role: decoded.role,
                    authMethod: decoded.authMethod || 'local'
                };
                console.log('[AuthenticateToken] ✅ AMS token verified for user:', user.userId);
            }

            req.user = user; // Add the payload to the request object
            next();
        } catch (err) {
            console.error('[AuthenticateToken] ❌ Token verification failed');
            console.error('[AuthenticateToken] Error:', err.message);
            console.error('[AuthenticateToken] Token preview:', token.substring(0, 50) + '...');
            
            // Try to decode token for debugging
            try {
                const decoded = jwt.decode(token, { complete: true });
                if (decoded && decoded.header) {
                    console.error('[AuthenticateToken] Token header:', {
                        alg: decoded.header.alg,
                        kid: decoded.header.kid || 'MISSING',
                        typ: decoded.header.typ
                    });
                }
            } catch (decodeError) {
                console.error('[AuthenticateToken] Could not decode token:', decodeError.message);
            }
            
            return res.status(403).json({ 
                error: 'Invalid token',
                message: err.message,
                code: 'TOKEN_VERIFICATION_FAILED'
            }); // Forbidden (token is no longer valid)
        }
    })();
}

module.exports = authenticateToken;