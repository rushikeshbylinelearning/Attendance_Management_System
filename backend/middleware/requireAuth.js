// backend/middleware/requireAuth.js
/**
 * Authentication middleware that works with both regular JWT and SSO sessions
 */
const jwtUtils = require('../utils/jwtUtils');

function requireAuth(req, res, next) {
  // Check for SSO session first
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  // Check for JWT token in Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    const redirectUrl = process.env.NODE_ENV === 'production'
      ? 'https://sso.bylinelms.com/login'
      : 'http://localhost:3000/login';
    return res.redirect(redirectUrl);
  }

  try {
    const user = jwtUtils.verify(token);
    req.user = user; // Add the payload to the request object
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    const redirectUrl = process.env.NODE_ENV === 'production'
      ? 'https://sso.bylinelms.com/login'
      : 'http://localhost:3000/login';
    return res.redirect(redirectUrl);
  }
}

module.exports = requireAuth;



