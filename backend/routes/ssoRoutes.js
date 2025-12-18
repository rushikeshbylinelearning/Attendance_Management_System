// backend/routes/ssoRoutes.js
const express = require('express');
const router = express.Router();

/**
 * GET /api/sso/login
 * AMS SSO login endpoint
 * This endpoint indicates that AMS supports SSO authentication
 */
router.get('/login', (req, res) => {
  try {
    console.log('[SSO Routes] SSO login endpoint accessed');
    res.json({
      success: true,
      message: 'AMS SSO login endpoint active.'
    });
  } catch (error) {
    console.error('[SSO Routes] Error in /login endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;


























