// backend/routes/newNotifications.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authenticateToken = require('../middleware/authenticateToken');
const NewNotification = require('../models/NewNotification');
const User = require('../models/User');

const isAdminOrHr = (req, res, next) => {
    if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin or HR role.' });
    }
    next();
};

// Admin Activity Log Route
router.get('/activity-log', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 25;
        const skip = (page - 1) * limit;
        // For activity logs, we want to show system notifications and user notifications
        // System notifications are visible to all admins, user notifications are visible to specific users
        const query = {
            $or: [
                // System notifications visible to all admins
                { isSystemNotification: true, targetRoles: { $in: ['Admin', 'HR'] } },
                // User-specific notifications
                { isSystemNotification: { $ne: true } }
            ]
        };

        if (req.query.type) query.type = req.query.type;
        if (req.query.category) query.category = req.query.category;
        if (req.query.priority) query.priority = req.query.priority;

        if (req.query.startDate && req.query.endDate) {
            query.createdAt = {
                $gte: new Date(req.query.startDate),
                $lte: new Date(new Date(req.query.endDate).setHours(23, 59, 59, 999))
            };
        }

        if (req.query.search) {
            const searchRegex = new RegExp(req.query.search, 'i');
            const matchingUsers = await User.find({ $or: [{ fullName: searchRegex }, { employeeCode: searchRegex }] }).select('_id');
            const userIds = matchingUsers.map(u => u._id);
            query.$or = [{ message: searchRegex }, { userName: searchRegex }, { userId: { $in: userIds } }];
        }

        // For admin activity logs, we want to show both user-specific and system notifications
        // System notifications (where userId is null) should be visible to all admins
        const notifications = await NewNotification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
        const totalCount = await NewNotification.countDocuments(query);

        res.json({
            notifications, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit)
        });
    } catch (error) {
        console.error('Error fetching admin activity log:', error);
        res.status(500).json({ error: 'Failed to fetch activity log.' });
    }
});

// User's Notification Drawer Route
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { userId, role } = req.user;
        const query = { archived: false };
        
        if (['Admin', 'HR'].includes(role)) {
            // Admins can see admin notifications and system notifications
            query.$or = [
                { recipientType: { $in: ['admin', 'both'] } },
                { isSystemNotification: true, targetRoles: { $in: [role] } }
            ];
        } else {
            query.userId = userId;
            query.recipientType = { $in: ['user', 'both'] };
        }

        const notifications = await NewNotification.find(query).sort({ createdAt: -1 }).limit(50).lean();
        const unreadCountQuery = { ...query, read: false };
        const unreadCount = await NewNotification.countDocuments(unreadCountQuery);
        res.json({ notifications, unreadCount });
    } catch (error) {
        console.error('Error fetching new notifications for drawer:', error);
        res.status(500).json({ error: 'Failed to fetch notifications.' });
    }
});

// Mark a single notification as read
router.post('/:id/read', authenticateToken, async (req, res) => {
    try {
        const notification = await NewNotification.findOne({ id: req.params.id });
        if (!notification) return res.status(404).json({ error: 'Notification not found.' });

        // Allow access if:
        // 1. User owns the notification, OR
        // 2. User is Admin/HR and notification is for admins, OR  
        // 3. Notification is a system notification and user has the target role
        const hasAccess = (
            notification.userId && notification.userId.toString() === req.user.userId ||
            ['Admin', 'HR'].includes(req.user.role) && ['admin', 'both'].includes(notification.recipientType) ||
            notification.isSystemNotification && notification.targetRoles && notification.targetRoles.includes(req.user.role)
        );
        
        if (!hasAccess) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await notification.markAsRead();
        res.status(200).json({ message: 'Notification marked as read.' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read.' });
    }
});

// Mark all of a user's notifications as read
router.post('/mark-all-read', authenticateToken, async (req, res) => {
    try {
        const query = { read: false };
        if (['Admin', 'HR'].includes(req.user.role)) {
            // Admins can mark admin notifications and system notifications as read
            query.$or = [
                { recipientType: { $in: ['admin', 'both'] } },
                { isSystemNotification: true, targetRoles: { $in: [req.user.role] } }
            ];
        } else {
            query.userId = req.user.userId;
            query.recipientType = { $in: ['user', 'both'] };
        }
        await NewNotification.updateMany(query, { $set: { read: true, readAt: new Date() } });
        res.status(200).json({ message: 'All notifications marked as read.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notifications as read.' });
    }
});

// A user deleting a SINGLE one of their own notifications from the drawer
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { userId, role } = req.user;
        const query = { id: req.params.id };

        // A user can only delete their own notifications. An admin can delete any admin/system notifications.
        if (!['Admin', 'HR'].includes(role)) {
            query.userId = userId;
        } else {
            // For admins, allow deletion of admin notifications and system notifications
            query.$or = [
                { recipientType: { $in: ['admin', 'both'] } },
                { isSystemNotification: true, targetRoles: { $in: [role] } }
            ];
        }

        const result = await NewNotification.findOneAndDelete(query);
        if (!result) return res.status(404).json({ error: 'Notification not found or you do not have permission.' });
        res.status(200).json({ message: 'Notification deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user notification:', error);
        res.status(500).json({ error: 'Failed to delete notification.' });
    }
});

// **FIX**: A user clearing their OWN notifications from their drawer
router.delete('/user/clear-mine', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.user;
        const result = await NewNotification.deleteMany({
            userId: userId,
            recipientType: { $in: ['user', 'both'] }
        });
        res.status(200).json({ message: 'Your notifications have been cleared.', deletedCount: result.deletedCount });
    } catch(error) {
        console.error('Error clearing user notifications:', error);
        res.status(500).json({ error: 'Failed to clear your notifications.' });
    }
});


// **FIX**: Admin clears ALL activity logs from the system (more specific path)
router.delete('/admin/clear-all', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        // This targets ALL notifications meant for admins. For a full system wipe, use {}.
        const result = await NewNotification.deleteMany({ recipientType: { $in: ['admin', 'both'] } });
        res.status(200).json({ message: 'All admin activity logs cleared.', deletedCount: result.deletedCount });
    } catch (error) {
        console.error('Error clearing all admin notifications:', error);
        res.status(500).json({ error: 'Failed to clear notifications.' });
    }
});

// GET /api/newNotifications/activity-logs/download - Download all activity logs
router.get('/activity-logs/download', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        console.log('Activity logs download endpoint hit:', req.query);
        const { startDate, endDate, format = 'json' } = req.query;
        
        // Build query for activity logs
        const query = {};
        
        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }
        
        // Get all activity logs with user information
        const activityLogs = await NewNotification.find(query)
            .populate('userId', 'fullName employeeCode email department')
            .sort({ createdAt: -1 })
            .lean();
        
        // Format the data for export
        const formattedLogs = activityLogs.map(log => ({
            timestamp: log.createdAt,
            date: new Date(log.createdAt).toLocaleDateString('en-US'),
            time: new Date(log.createdAt).toLocaleTimeString('en-US'),
            user: log.userName,
            employeeCode: log.userId?.employeeCode || 'N/A',
            email: log.userId?.email || 'N/A',
            department: log.userId?.department || 'N/A',
            type: log.type,
            category: log.category,
            priority: log.priority,
            message: log.message,
            recipientType: log.recipientType,
            read: log.read ? 'Yes' : 'No',
            actionType: log.actionData?.actionType || 'N/A',
            actionUrl: log.actionData?.actionUrl || 'N/A'
        }));
        
        if (format === 'csv') {
            // Generate CSV
            const csvHeader = 'Date,Time,User,Employee Code,Email,Department,Type,Category,Priority,Message,Recipient Type,Read,Action Type,Action URL\n';
            const csvRows = formattedLogs.map(log => 
                `"${log.date}","${log.time}","${log.user}","${log.employeeCode}","${log.email}","${log.department}","${log.type}","${log.category}","${log.priority}","${log.message}","${log.recipientType}","${log.read}","${log.actionType}","${log.actionUrl}"`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="activity_logs_${startDate || 'all'}_to_${endDate || 'all'}.csv"`);
            res.send(csvHeader + csvRows);
        } else {
            // Return JSON
            res.json({
                period: { startDate, endDate },
                totalLogs: formattedLogs.length,
                logs: formattedLogs
            });
        }
        
    } catch (error) {
        console.error('Error downloading activity logs:', error);
        res.status(500).json({ error: 'Failed to download activity logs.' });
    }
});

module.exports = router;