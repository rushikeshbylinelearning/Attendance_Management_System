// backend/services/geofencingService.js
const OfficeLocation = require('../models/OfficeLocation');

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Check if user is within office geofence
 * @param {number} userLat - User's latitude
 * @param {number} userLon - User's longitude
 * @param {string} userRole - User's role
 * @returns {Promise<{isWithinGeofence: boolean, officeLocation: object|null, distance: number}>}
 */
async function checkGeofence(userLat, userLon, userRole) {
    try {
        // Admin and HR can access from anywhere
        if (userRole === 'Admin' || userRole === 'HR') {
            return {
                isWithinGeofence: true,
                officeLocation: null,
                distance: 0,
                bypassReason: 'Admin/HR access'
            };
        }

        // Get all active office locations
        const officeLocations = await OfficeLocation.find({ isActive: true });
        
        if (officeLocations.length === 0) {
            // If no office locations are configured, allow access
            return {
                isWithinGeofence: true,
                officeLocation: null,
                distance: 0,
                bypassReason: 'No office locations configured'
            };
        }

        // Check if user is within any office location
        for (const office of officeLocations) {
            const distance = calculateDistance(
                userLat, userLon,
                office.latitude, office.longitude
            );
            
            if (distance <= office.radius) {
                return {
                    isWithinGeofence: true,
                    officeLocation: office,
                    distance: Math.round(distance)
                };
            }
        }

        // User is not within any office geofence
        const nearestOffice = officeLocations.reduce((nearest, office) => {
            const distance = calculateDistance(
                userLat, userLon,
                office.latitude, office.longitude
            );
            return distance < nearest.distance ? { office, distance } : nearest;
        }, { office: null, distance: Infinity });

        return {
            isWithinGeofence: false,
            officeLocation: nearestOffice.office,
            distance: Math.round(nearestOffice.distance)
        };

    } catch (error) {
        console.error('Geofencing check error:', error);
        // In case of error, allow access to prevent system lockout
        return {
            isWithinGeofence: true,
            officeLocation: null,
            distance: 0,
            bypassReason: 'System error - allowing access'
        };
    }
}

/**
 * Validate coordinates
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {boolean}
 */
function validateCoordinates(lat, lon) {
    return (
        typeof lat === 'number' && 
        typeof lon === 'number' &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180 &&
        !isNaN(lat) && !isNaN(lon)
    );
}

module.exports = {
    checkGeofence,
    calculateDistance,
    validateCoordinates
};

