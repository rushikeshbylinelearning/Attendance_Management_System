// backend/models/NewNotification.js
const mongoose = require('mongoose');

const newNotificationSchema = new mongoose.Schema({
    // Core notification data
    id: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    type: { 
        type: String, 
        enum: ['checkin', 'checkout', 'break_start', 'break_end', 'leave_request', 'leave_approval', 'leave_rejection', 'extra_break_request', 'extra_break_approval', 'extra_break_rejection', 'auto_break', 'auto_break_end', 'system', 'info', 'success', 'warning', 'error'], 
        required: true 
    },
    
    // User and recipient information
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true }, // Allow null for system notifications
    userName: { type: String, required: true },
    recipientType: { 
        type: String, 
        enum: ['user', 'admin', 'both'], 
        default: 'user',
        index: true 
    },
    
    // Notification state
    read: { type: Boolean, default: false, index: true },
    archived: { type: Boolean, default: false, index: true },
    
    // Action data for interactive notifications
    actionData: {
        actionType: { type: String, enum: ['start_break', 'navigate', 'approve', 'reject', 'none'] },
        actionUrl: { type: String },
        actionParams: { type: mongoose.Schema.Types.Mixed },
        requiresAction: { type: Boolean, default: false }
    },
    
    // Navigation data
    navigationData: {
        page: { type: String },
        params: { type: mongoose.Schema.Types.Mixed }
    },
    
    // Metadata
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    category: { type: String, enum: ['attendance', 'leave', 'break', 'system', 'admin'], default: 'system' },
    
    // System notification fields
    isSystemNotification: { type: Boolean, default: false },
    targetRoles: [{ type: String, enum: ['Admin', 'HR', 'Employee', 'Intern'] }],
    
    // Timestamps
    createdAt: { type: Date, default: Date.now, index: true },
    readAt: { type: Date },
    expiresAt: { type: Date, index: true }
}, { 
    timestamps: true,
    expireAfterSeconds: 2592000 // 30 days
});

// Indexes for better performance
newNotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
newNotificationSchema.index({ recipientType: 1, read: 1, createdAt: -1 });

// --- REMOVED pre('save') hook ---
// The ID generation logic is now moved to the service layer for reliability.

// Instance methods
newNotificationSchema.methods.markAsRead = function() {
    this.read = true;
    this.readAt = new Date();
    return this.save();
};

newNotificationSchema.methods.archive = function() {
    this.archived = true;
    return this.save();
};

// Static methods (unchanged)
newNotificationSchema.statics.getUnreadCount = function(userId, recipientType = 'user') {
    const query = { read: false, archived: false };
    if (recipientType === 'admin' || recipientType === 'HR') {
        query.recipientType = { $in: ['admin', 'both'] };
    } else {
        query.userId = userId;
        query.recipientType = { $in: ['user', 'both'] };
    }
    return this.countDocuments(query);
};

newNotificationSchema.statics.getUserNotifications = function(userId, recipientType = 'user', limit = 50, skip = 0) {
    const query = { archived: false };
     if (recipientType === 'admin' || recipientType === 'HR') {
        query.recipientType = { $in: ['admin', 'both'] };
    } else {
        query.userId = userId;
        query.recipientType = { $in: ['user', 'both'] };
    }
    
    return this.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .lean();
};

module.exports = mongoose.model('NewNotification', newNotificationSchema);