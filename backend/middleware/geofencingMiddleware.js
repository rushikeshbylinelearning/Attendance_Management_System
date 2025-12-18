// backend/middleware/geofencingMiddleware.js
const { checkGeofence, validateCoordinates } = require('../services/geofencingService');

/**
 * Middleware to check geofencing for non-admin users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function geofencingMiddleware(req, res, next) {
    try {
        // Skip geofencing check for admin and HR users
        if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR')) {
            return next();
        }

        // Get location from request body or headers
        const { latitude, longitude } = req.body;
        
        if (!latitude || !longitude) {
            // For non-admin users, location is required for geofencing
            if (req.user && (req.user.role !== 'Admin' && req.user.role !== 'HR')) {
                return res.status(400).json({ 
                    error: 'Location coordinates are required for attendance tracking',
                    code: 'LOCATION_REQUIRED'
                });
            }
            // For admin/HR users, skip geofencing check
            return next();
        }

        // Validate coordinates
        if (!validateCoordinates(latitude, longitude)) {
            return res.status(400).json({ 
                error: 'Invalid location coordinates',
                code: 'INVALID_COORDINATES'
            });
        }

        // Check geofence
        const geofenceResult = await checkGeofence(
            latitude, 
            longitude, 
            req.user ? req.user.role : 'Employee'
        );

        if (!geofenceResult.isWithinGeofence) {
            return res.status(403).json({
                error: 'Access denied: You must be within office premises to access this system',
                code: 'GEOFENCE_VIOLATION',
                details: {
                    distance: geofenceResult.distance,
                    nearestOffice: geofenceResult.officeLocation ? {
                        name: geofenceResult.officeLocation.name,
                        address: geofenceResult.officeLocation.address
                    } : null
                }
            });
        }

        // Add geofence info to request for logging
        req.geofenceInfo = geofenceResult;
        next();

    } catch (error) {
        console.error('Geofencing middleware error:', error);
        // In case of error, allow access to prevent system lockout
        next();
    }
}

/**
 * Middleware specifically for login endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function loginGeofencingMiddleware(req, res, next) {
    try {
        const { latitude, longitude, email, password } = req.body;
        
        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({ error: 'Email/Employee Code and password are required.' });
        }

        // For now, we'll check geofencing after user authentication
        // Store location in request for later use
        if (latitude && longitude) {
            if (!validateCoordinates(latitude, longitude)) {
                return res.status(400).json({ 
                    error: 'Invalid location coordinates',
                    code: 'INVALID_COORDINATES'
                });
            }
            req.userLocation = { latitude, longitude };
        } else {
            // Location not provided - will be handled after user authentication
            req.userLocation = null;
        }

        next();

    } catch (error) {
        console.error('Login geofencing middleware error:', error);
        next();
    }
}

module.exports = {
    geofencingMiddleware,
    loginGeofencingMiddleware
};
