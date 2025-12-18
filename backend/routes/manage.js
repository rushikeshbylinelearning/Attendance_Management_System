// backend/routes/manage.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
const { validateUserCreation, handleValidationErrors } = require('../middleware/validation');
const { logError } = require('../utils/logger');

// Middleware to check for Admin role only
const isAdmin = (req, res, next) => {
    console.log('isAdmin middleware - User role:', req.user?.role);
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin role.' });
    }
    next();
};

// Test route to verify the endpoint is accessible
router.get('/test', (req, res) => {
    res.json({ message: 'Manage endpoint is working' });
});

// GET /api/admin/manage - Get all users with their feature permissions
router.get('/', [authenticateToken, isAdmin], async (req, res) => {
    try {
        console.log('Manage endpoint accessed by user:', req.user?.userId);
        const users = await User.find({ isActive: true })
            .select('fullName email employeeCode role department designation featurePermissions')
            .sort({ fullName: 1 })
            .lean();

        const usersWithPermissions = users.map(user => ({
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            employeeCode: user.employeeCode,
            role: user.role,
            department: user.department,
            designation: user.designation,
            featurePermissions: user.featurePermissions || {
                leaves: true,
                breaks: true,
                extraFeatures: false,
                maxBreaks: 999, // No restrictions
                breakAfterHours: 0, // Can take break immediately
                breakWindows: [], // No time restrictions by default
                canCheckIn: true,
                canCheckOut: true,
                canTakeBreak: true,
                canViewAnalytics: false, // New field for analytics access
                privilegeLevel: 'normal',
                restrictedFeatures: {
                    canViewReports: false,
                    canViewOtherLogs: false,
                    canEditProfile: true,
                    canRequestExtraBreak: true
                },
                advancedFeatures: {
                    canBulkActions: false,
                    canExportData: false
                }
            }
        }));

        res.json(usersWithPermissions);
    } catch (error) {
        logError(error, { operation: 'get_all_users_permissions' });
        res.status(500).json({ error: 'Failed to fetch users and permissions.' });
    }
});

// GET /api/admin/manage/:userId - Get specific user's feature permissions
router.get('/:userId', [authenticateToken, isAdmin], async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('fullName email employeeCode role department designation featurePermissions')
            .lean();

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const userWithPermissions = {
            _id: user._id,
            fullName: user.fullName,
            email: user.email,
            employeeCode: user.employeeCode,
            role: user.role,
            department: user.department,
            designation: user.designation,
            featurePermissions: user.featurePermissions || {
                leaves: true,
                breaks: true,
                extraFeatures: false,
                maxBreaks: 999, // No restrictions
                breakAfterHours: 0, // Can take break immediately
                breakWindows: [], // No time restrictions by default
                canCheckIn: true,
                canCheckOut: true,
                canTakeBreak: true,
                canViewAnalytics: false, // New field for analytics access
                privilegeLevel: 'normal',
                restrictedFeatures: {
                    canViewReports: false,
                    canViewOtherLogs: false,
                    canEditProfile: true,
                    canRequestExtraBreak: true
                },
                advancedFeatures: {
                    canBulkActions: false,
                    canExportData: false
                }
            }
        };

        res.json(userWithPermissions);
    } catch (error) {
        logError(error, { operation: 'get_user_permissions', userId: req.params.userId });
        res.status(500).json({ error: 'Failed to fetch user permissions.' });
    }
});

// GET /api/admin/manage/bulk/template - Get template for bulk permission updates
router.get('/bulk/template', [authenticateToken, isAdmin], async (req, res) => {
    try {
        const template = {
            featurePermissions: {
                leaves: true,
                breaks: true,
                extraFeatures: false,
                maxBreaks: 999, // No restrictions
                breakAfterHours: 0, // Can take break immediately
                breakWindows: [], // No time restrictions by default
                canCheckIn: true,
                canCheckOut: true,
                canTakeBreak: true,
                canViewAnalytics: false, // New field for analytics access
                privilegeLevel: 'normal',
                restrictedFeatures: {
                    canViewReports: false,
                    canViewOtherLogs: false,
                    canEditProfile: true,
                    canRequestExtraBreak: true
                },
                advancedFeatures: {
                    canBulkActions: false,
                    canExportData: false
                }
            }
        };

        res.json(template);
    } catch (error) {
        logError(error, { operation: 'get_bulk_template' });
        res.status(500).json({ error: 'Failed to fetch bulk template.' });
    }
});

// PUT /api/admin/manage/bulk - Apply settings to multiple users
router.put('/bulk', [authenticateToken, isAdmin], async (req, res) => {
    try {
        const { userIds, featurePermissions, applyToAll } = req.body;

        if (!featurePermissions) {
            return res.status(400).json({ error: 'Feature permissions are required.' });
        }

        // Validate the feature permissions structure (same as single user update)
        const validPermissionKeys = [
            'leaves', 'breaks', 'extraFeatures', 'maxBreaks', 'breakAfterHours',
            'canCheckIn', 'canCheckOut', 'canTakeBreak', 'canViewAnalytics', 'privilegeLevel',
            'restrictedFeatures', 'advancedFeatures', 'breakWindows',
            'autoBreakOnInactivity', 'inactivityThresholdMinutes'
        ];

        const invalidKeys = Object.keys(featurePermissions).filter(key => !validPermissionKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({ 
                error: `Invalid permission keys: ${invalidKeys.join(', ')}` 
            });
        }

        // Validate privilege level
        if (featurePermissions.privilegeLevel && !['restricted', 'normal', 'advanced'].includes(featurePermissions.privilegeLevel)) {
            return res.status(400).json({ error: 'Invalid privilege level.' });
        }

        // Validate inactivity threshold
        if (featurePermissions.inactivityThresholdMinutes && 
            (featurePermissions.inactivityThresholdMinutes < 1 || featurePermissions.inactivityThresholdMinutes > 60)) {
            return res.status(400).json({ error: 'Inactivity threshold must be between 1 and 60 minutes.' });
        }

        // Validate break windows if provided (same validation as single user)
        if (featurePermissions.breakWindows) {
            if (!Array.isArray(featurePermissions.breakWindows)) {
                return res.status(400).json({ error: 'Break windows must be an array.' });
            }
            
            for (const window of featurePermissions.breakWindows) {
                if (!window.type || !['Paid', 'Unpaid', 'Extra'].includes(window.type)) {
                    return res.status(400).json({ error: 'Invalid break window type.' });
                }
                if (!window.name || typeof window.name !== 'string') {
                    return res.status(400).json({ error: 'Break window name is required.' });
                }
                if (!window.startTime || !window.endTime) {
                    return res.status(400).json({ error: 'Break window start and end times are required.' });
                }
                const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
                if (!timeRegex.test(window.startTime) || !timeRegex.test(window.endTime)) {
                    return res.status(400).json({ error: 'Invalid time format. Use HH:MM format.' });
                }
            }
        }

        let targetUserIds = [];

        if (applyToAll) {
            // Get all active user IDs
            const allUsers = await User.find({ isActive: true }).select('_id');
            targetUserIds = allUsers.map(user => user._id);
        } else if (userIds && Array.isArray(userIds) && userIds.length > 0) {
            targetUserIds = userIds;
        } else {
            return res.status(400).json({ error: 'Either userIds array or applyToAll flag is required.' });
        }

        // Validate that all target users exist
        const existingUsers = await User.find({ _id: { $in: targetUserIds } }).select('_id');
        const existingUserIds = existingUsers.map(user => user._id.toString());
        const invalidUserIds = targetUserIds.filter(id => !existingUserIds.includes(id.toString()));
        
        if (invalidUserIds.length > 0) {
            return res.status(400).json({ 
                error: `Invalid user IDs: ${invalidUserIds.join(', ')}` 
            });
        }

        // --- FIX START ---
        // Build the update payload using dot notation for atomic updates.
        // This is safe and prevents crashes from spreading undefined values.
        const updatePayload = {};
        for (const [key, value] of Object.entries(featurePermissions)) {
            // Check for nested objects that are NOT arrays (like restrictedFeatures)
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                for (const [nestedKey, nestedValue] of Object.entries(value)) {
                    updatePayload[`featurePermissions.${key}.${nestedKey}`] = nestedValue;
                }
            } else {
                // Handle top-level primitives (booleans, strings, numbers) and arrays
                updatePayload[`featurePermissions.${key}`] = value;
            }
        }

        // Update all target users in a single operation
        const updateResult = await User.updateMany(
            { _id: { $in: targetUserIds } },
            { $set: updatePayload }
        );
        // --- FIX END ---

        // Invalidate cache for all affected users
        const cacheService = require('../services/cacheService');
        const { getIO } = require('../socketManager');
        const io = getIO();
        
        targetUserIds.forEach(userId => {
            cacheService.invalidateUser(userId);
            
            // Notify each user about permission changes via socket
            if (io) {
                io.to(`user_${userId}`).emit('permissions_updated', {
                    message: 'Your permissions have been updated. Please refresh the page to see changes.',
                    timestamp: new Date().toISOString()
                });
            }
        });

        res.json({
            message: `Successfully updated permissions for ${updateResult.modifiedCount} users.`,
            modifiedCount: updateResult.modifiedCount,
            targetCount: targetUserIds.length
        });

    } catch (error) {
        logError(error, { operation: 'bulk_update_permissions', body: req.body });
        res.status(500).json({ error: 'Failed to update user permissions in bulk.' });
    }
});

// PUT /api/admin/manage/:userId - Update user's feature permissions
router.put('/:userId', [authenticateToken, isAdmin], async (req, res) => {
    try {
        const { featurePermissions } = req.body;

        if (!featurePermissions) {
            return res.status(400).json({ error: 'Feature permissions are required.' });
        }

        // Validate the feature permissions structure
        const validPermissionKeys = [
            'leaves', 'breaks', 'extraFeatures', 'maxBreaks', 'breakAfterHours',
            'canCheckIn', 'canCheckOut', 'canTakeBreak', 'privilegeLevel',
            'restrictedFeatures', 'advancedFeatures', 'breakWindows',
            'autoBreakOnInactivity', 'inactivityThresholdMinutes'
        ];

        const invalidKeys = Object.keys(featurePermissions).filter(key => !validPermissionKeys.includes(key));
        if (invalidKeys.length > 0) {
            return res.status(400).json({ 
                error: `Invalid permission keys: ${invalidKeys.join(', ')}` 
            });
        }

        // Validate privilege level
        if (featurePermissions.privilegeLevel && !['restricted', 'normal', 'advanced'].includes(featurePermissions.privilegeLevel)) {
            return res.status(400).json({ error: 'Invalid privilege level.' });
        }

        // Validate inactivity threshold
        if (featurePermissions.inactivityThresholdMinutes && 
            (featurePermissions.inactivityThresholdMinutes < 1 || featurePermissions.inactivityThresholdMinutes > 60)) {
            return res.status(400).json({ error: 'Inactivity threshold must be between 1 and 60 minutes.' });
        }

        // Validate break windows if provided
        if (featurePermissions.breakWindows) {
            if (!Array.isArray(featurePermissions.breakWindows)) {
                return res.status(400).json({ error: 'Break windows must be an array.' });
            }
            
            for (const window of featurePermissions.breakWindows) {
                if (!window.type || !['Paid', 'Unpaid', 'Extra'].includes(window.type)) {
                    return res.status(400).json({ error: 'Invalid break window type.' });
                }
                if (!window.name || typeof window.name !== 'string') {
                    return res.status(400).json({ error: 'Break window name is required.' });
                }
                if (!window.startTime || !window.endTime) {
                    return res.status(400).json({ error: 'Break window start and end times are required.' });
                }
                // Validate time format (HH:MM)
                const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
                if (!timeRegex.test(window.startTime) || !timeRegex.test(window.endTime)) {
                    return res.status(400).json({ error: 'Invalid time format. Use HH:MM format.' });
                }
            }
        }

        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Update feature permissions with safe merging for nested objects
        const updatedPermissions = { 
            ...user.featurePermissions,
            // Ensure nested objects are properly initialized
            restrictedFeatures: user.featurePermissions.restrictedFeatures || {},
            advancedFeatures: user.featurePermissions.advancedFeatures || {}
        };
        
        // Handle top-level properties
        for (const [key, value] of Object.entries(featurePermissions)) {
            if (value !== undefined) {
                if (key === 'restrictedFeatures' && typeof value === 'object' && value !== null) {
                    updatedPermissions.restrictedFeatures = {
                        ...updatedPermissions.restrictedFeatures,
                        ...value
                    };
                } else if (key === 'advancedFeatures' && typeof value === 'object' && value !== null) {
                    updatedPermissions.advancedFeatures = {
                        ...updatedPermissions.advancedFeatures,
                        ...value
                    };
                } else {
                    updatedPermissions[key] = value;
                }
            }
        }
        
        user.featurePermissions = updatedPermissions;

        await user.save();

        // Invalidate user cache to ensure fresh data on next request
        const cacheService = require('../services/cacheService');
        cacheService.invalidateUser(req.params.userId);

        // Notify user about permission changes via socket
        const { getIO } = require('../socketManager');
        const io = getIO();
        if (io) {
            io.to(`user_${req.params.userId}`).emit('permissions_updated', {
                message: 'Your permissions have been updated. Please refresh the page to see changes.',
                timestamp: new Date().toISOString()
            });
        }

        // Return updated user data
        const updatedUser = await User.findById(req.params.userId)
            .select('fullName email employeeCode role department designation featurePermissions')
            .lean();

        res.json({
            message: 'User permissions updated successfully.',
            user: {
                _id: updatedUser._id,
                fullName: updatedUser.fullName,
                email: updatedUser.email,
                employeeCode: updatedUser.employeeCode,
                role: updatedUser.role,
                department: updatedUser.department,
                designation: updatedUser.designation,
                featurePermissions: updatedUser.featurePermissions
            }
        });

    } catch (error) {
        logError(error, { operation: 'update_user_permissions', userId: req.params.userId, body: req.body });
        res.status(500).json({ error: 'Failed to update user permissions.' });
    }
});

// POST /api/admin/manage/:userId/reset - Reset user's feature permissions to defaults
router.post('/:userId/reset', [authenticateToken, isAdmin], async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Reset to default permissions
        user.featurePermissions = {
            leaves: true,
            breaks: true,
            extraFeatures: false,
            maxBreaks: 2,
            breakAfterHours: 2,
            canCheckIn: true,
            canCheckOut: true,
            canTakeBreak: true,
            privilegeLevel: 'normal',
            restrictedFeatures: {
                canViewReports: false,
                canViewOtherLogs: false,
                canEditProfile: true,
                canRequestExtraBreak: true
            },
            advancedFeatures: {
                canBulkActions: false,
                canExportData: false,
                canViewAnalytics: false
            }
        };

        await user.save();

        // Invalidate user cache to ensure fresh data on next request
        const cacheService = require('../services/cacheService');
        cacheService.invalidateUser(req.params.userId);

        // Notify user about permission changes via socket
        const { getIO } = require('../socketManager');
        const io = getIO();
        if (io) {
            io.to(`user_${req.params.userId}`).emit('permissions_updated', {
                message: 'Your permissions have been reset to defaults. Please refresh the page to see changes.',
                timestamp: new Date().toISOString()
            });
        }

        res.json({ message: 'User permissions reset to defaults successfully.' });

    } catch (error) {
        logError(error, { operation: 'reset_user_permissions', userId: req.params.userId });
        res.status(500).json({ error: 'Failed to reset user permissions.' });
    }
});

module.exports = router;