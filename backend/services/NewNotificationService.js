// backend/services/NewNotificationService.js
const NewNotification = require('../models/NewNotification');
const User = require('../models/User');
const { getIO } = require('../socketManager');

class NewNotificationService {
    static async createNotification(notificationData) {
        try {
            const generatedId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const notificationWithId = { ...notificationData, id: generatedId };
            const notification = await NewNotification.create(notificationWithId);
            console.log('[SVC] Step 1: Notification document created in DB. ID:', notification.id);
            return notification;
        } catch (error) {
            console.error('[SVC] CRITICAL ERROR in createNotification:', error);
            throw error;
        }
    }

    static emitNotification(notification) {
        const io = getIO();
        if (!io) {
            console.error('[SVC] Step 2: FAILED to emit. Socket.IO instance is not available.');
            return;
        }
        const targetRoom = `user_${notification.userId}`;
        console.log(`[SVC] Step 2: Emitting 'new_notification' event to room: ${targetRoom}`);
        io.to(targetRoom).emit('new_notification', { ...notification.toObject() });
        console.log(`[SVC] Step 3: Event emitted successfully to ${targetRoom}.`);
    }

    static async createAndEmitNotification(notificationData) {
        try {
            const notification = await this.createNotification(notificationData);
            this.emitNotification(notification);
            return notification;
        } catch (error) {
            console.error('[SVC] Error in createAndEmitNotification:', error.message);
        }
    }

    static async broadcastToAdmins(commonData, originatingUserId = null) {
        try {
            console.log('[SVC] Broadcasting to admins. Common Data:', commonData);
            
            // Create a single notification that can be seen by all admins
            // Use a special "admin" user ID or null to indicate this is for all admins
            const adminNotificationData = {
                ...commonData,
                userId: null, // Special value to indicate this is for all admins
                userName: 'System',
                recipientType: 'admin',
                // Add metadata to indicate this is a system-wide admin notification
                isSystemNotification: true,
                targetRoles: ['Admin', 'HR']
            };

            // Create the notification
            const notification = await this.createNotification(adminNotificationData);
            
            // Emit to all admin users
            const io = getIO();
            if (io) {
                // Find all admin users and emit to their individual rooms
                const admins = await User.find({ role: { $in: ['Admin', 'HR'] } }).select('_id fullName').lean();
                
                // Skip self-notification for the originating user
                const filteredAdmins = admins.filter(admin => 
                    !originatingUserId || admin._id.toString() !== originatingUserId.toString()
                );

                console.log(`[SVC] Emitting notification to ${filteredAdmins.length} admins.`);
                
                for (const admin of filteredAdmins) {
                    const targetRoom = `user_${admin._id}`;
                    console.log(`[SVC] Emitting to room: ${targetRoom}`);
                    io.to(targetRoom).emit('new_notification', { 
                        ...notification.toObject(),
                        // Override userName for display purposes
                        userName: 'System'
                    });
                }
            }

            console.log('[SVC] Admin notification created and broadcasted successfully.');
        } catch (error) {
            console.error('[SVC] CRITICAL ERROR in broadcastToAdmins:', error);
        }
    }

    // --- Specific Notification Event Handlers ---
    // Pass originatingUserId to broadcastToAdmins to prevent self-notifications
    static async notifyCheckIn(userId, userName) {
        const message = `${userName} clocked in.`;
        await this.broadcastToAdmins({
            message, type: 'checkin', category: 'attendance', priority: 'medium',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);
    }

    static async notifyCheckOut(userId, userName) {
        const message = `${userName} clocked out.`;
        await this.broadcastToAdmins({
            message, type: 'checkout', category: 'attendance', priority: 'medium',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);
    }

    static async notifyBreakStart(userId, userName, breakType) {
        const message = `${userName} started a ${breakType} break.`;
        await this.broadcastToAdmins({
            message, type: 'break_start', category: 'break', priority: 'low',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);
    }

    static async notifyBreakEnd(userId, userName, breakType) {
        const message = `${userName} ended their ${breakType} break.`;
        await this.broadcastToAdmins({
            message, type: 'break_end', category: 'break', priority: 'low',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);
    }

    static async notifyLeaveRequest(userId, userName, leaveType, startDate, endDate) {
        const message = `${userName} requested ${leaveType} leave from ${startDate} to ${endDate}.`;
        await this.broadcastToAdmins({
            message, type: 'leave_request', category: 'leave', priority: 'high',
            navigationData: { page: 'admin/leaves' }
        }, userId);
    }
    
    // This is user-facing, so it doesn't need the broadcast helper.
    static async notifyLeaveResponse(userId, userName, status, leaveType, rejectionNotes = null) {
        let message = `Your ${leaveType} leave request has been ${status.toLowerCase()}.`;
        
        // Add rejection reason if provided
        if (status === 'Rejected' && rejectionNotes) {
            message += ` Reason: ${rejectionNotes}`;
        }
        
        await this.createAndEmitNotification({
            message, userId, userName,
            type: status === 'Approved' ? 'leave_approval' : 'leave_rejection',
            recipientType: 'user', category: 'leave', priority: 'high',
            navigationData: { page: 'leaves' },
            metadata: { 
                fromAdmin: true,
                ...(rejectionNotes ? { rejectionNotes } : {})
            }
        });
    }

    static async notifyExtraBreakRequest(userId, userName, reason) {
        const message = `${userName} requested an extra break. Reason: ${reason}`;
        await this.broadcastToAdmins({
            message, type: 'extra_break_request', category: 'break', priority: 'high',
            navigationData: { page: 'admin/dashboard' }
        }, userId);
    }

    static async notifyAutoBreakStart(userId, userName, reason = 'Inactivity detected') {
        // Notify admins
        const adminMessage = `${userName} was placed on auto-break due to inactivity.`;
        await this.broadcastToAdmins({
            message: adminMessage, 
            type: 'auto_break', 
            category: 'break', 
            priority: 'high',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);

        // Notify user
        const userMessage = `You have been placed on an unpaid break due to inactivity. Please click "End Break" when you return to work.`;
        await this.createAndEmitNotification({
            message: userMessage,
            userId,
            userName,
            type: 'auto_break',
            recipientType: 'user',
            category: 'break',
            priority: 'high',
            navigationData: { page: 'dashboard' }
        });
    }

    static async notifyAutoBreakEnd(userId, userName, duration) {
        // Notify admins
        const adminMessage = `${userName} ended their auto-break after ${duration} minutes.`;
        await this.broadcastToAdmins({
            message: adminMessage, 
            type: 'auto_break_end', 
            category: 'break', 
            priority: 'medium',
            navigationData: { page: 'attendance', params: { userId } }
        }, userId);

        // Notify user
        const userMessage = `Your auto-break has ended. You are now back to work. Duration: ${duration} minutes.`;
        await this.createAndEmitNotification({
            message: userMessage,
            userId,
            userName,
            type: 'auto_break_end',
            recipientType: 'user',
            category: 'break',
            priority: 'medium',
            navigationData: { page: 'dashboard' }
        });
    }
}

module.exports = NewNotificationService;

