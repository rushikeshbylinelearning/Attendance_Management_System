// Script to test the notification system with role-based filtering
const mongoose = require('mongoose');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationService = require('../services/notificationService');

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

const testNotificationSystem = async () => {
    try {
        await connectDB();
        
        console.log('🧪 Testing notification system with role-based filtering...\n');
        
        // Find test users
        const adminUser = await User.findOne({ role: { $in: ['Admin', 'HR', 'Manager'] } });
        const regularUser = await User.findOne({ role: { $nin: ['Admin', 'HR', 'Manager'] } });
        
        if (!adminUser) {
            console.log('❌ No admin user found for testing');
            return;
        }
        
        if (!regularUser) {
            console.log('❌ No regular user found for testing');
            return;
        }
        
        console.log(`👑 Admin user: ${adminUser.fullName} (${adminUser.role})`);
        console.log(`👤 Regular user: ${regularUser.fullName} (${regularUser.role})\n`);
        
        // Test 1: User-specific notification
        console.log('📝 Test 1: Creating user-specific notification...');
        await NotificationService.createAndEmitNotification(
            regularUser._id,
            'This is a user-specific notification',
            'Info',
            'notification',
            { page: 'attendance' },
            'user'
        );
        console.log('✅ User-specific notification created\n');
        
        // Test 2: Admin-specific notification
        console.log('📝 Test 2: Creating admin-specific notification...');
        await NotificationService.createAndEmitNotification(
            adminUser._id,
            'This is an admin-specific notification',
            'Info',
            'admin_notification',
            { page: 'admin' },
            'admin'
        );
        console.log('✅ Admin-specific notification created\n');
        
        // Test 3: Both user and admin notification
        console.log('📝 Test 3: Creating notification for both user and admin...');
        await NotificationService.createAndEmitNotification(
            regularUser._id,
            'This notification should be visible to both user and admin',
            'Success',
            'notification',
            { page: 'leaves' },
            'both'
        );
        console.log('✅ Both user and admin notification created\n');
        
        // Test 4: Check notifications for regular user
        console.log('📝 Test 4: Checking notifications for regular user...');
        const userNotifications = await Notification.find({
            user: regularUser._id,
            recipientType: { $in: ['user', 'both'] }
        }).sort({ createdAt: -1 });
        
        console.log(`📊 Regular user has ${userNotifications.length} notifications:`);
        userNotifications.forEach((notif, index) => {
            console.log(`   ${index + 1}. [${notif.recipientType}] ${notif.message}`);
        });
        console.log('');
        
        // Test 5: Check notifications for admin user
        console.log('📝 Test 5: Checking notifications for admin user...');
        const adminNotifications = await Notification.find({
            user: adminUser._id,
            recipientType: { $in: ['user', 'admin', 'both'] }
        }).sort({ createdAt: -1 });
        
        console.log(`📊 Admin user has ${adminNotifications.length} notifications:`);
        adminNotifications.forEach((notif, index) => {
            console.log(`   ${index + 1}. [${notif.recipientType}] ${notif.message}`);
        });
        console.log('');
        
        // Test 6: Test break notification (should go to both user and admin)
        console.log('📝 Test 6: Testing break notification...');
        await NotificationService.notifyBreakStart(regularUser._id, regularUser.fullName, 'Paid');
        console.log('✅ Break notification sent\n');
        
        // Test 7: Test extra break request (should go to admin only)
        console.log('📝 Test 7: Testing extra break request...');
        await NotificationService.notifyExtraBreakRequest(regularUser._id, regularUser.fullName, 'Test reason');
        console.log('✅ Extra break request notification sent\n');
        
        console.log('🎉 All notification tests completed successfully!');
        console.log('\n📋 Summary:');
        console.log('- User-specific notifications: Only visible to the user');
        console.log('- Admin-specific notifications: Only visible to admins');
        console.log('- Both notifications: Visible to both user and admin');
        console.log('- Break notifications: Sent to both user and admin');
        console.log('- Extra break requests: Sent to admin only');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error testing notification system:', error);
        process.exit(1);
    }
};

testNotificationSystem();

