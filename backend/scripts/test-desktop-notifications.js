// Script to test desktop notifications end-to-end
const mongoose = require('mongoose');
const User = require('../models/User');
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

const testDesktopNotifications = async () => {
    try {
        await connectDB();
        
        console.log('🧪 Testing desktop notifications end-to-end...\n');
        
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
        
        // Test 1: Direct user notification
        console.log('📝 Test 1: Sending direct user notification...');
        await NotificationService.createAndEmitNotification(
            regularUser._id,
            'Test desktop notification for user',
            'Success',
            'notification',
            { page: 'attendance' },
            'user'
        );
        console.log('✅ User notification sent\n');
        
        // Test 2: Admin notification
        console.log('📝 Test 2: Sending admin notification...');
        await NotificationService.notifyAdmins(
            'Test admin notification',
            'Info',
            'admin_notification',
            { page: 'admin' }
        );
        console.log('✅ Admin notification sent\n');
        
        // Test 3: Break notification (should go to both user and admin)
        console.log('📝 Test 3: Sending break notification...');
        await NotificationService.notifyBreakStart(regularUser._id, regularUser.fullName, 'Paid');
        console.log('✅ Break notification sent\n');
        
        // Test 4: Extra break request (should go to admin only)
        console.log('📝 Test 4: Sending extra break request...');
        await NotificationService.notifyExtraBreakRequest(regularUser._id, regularUser.fullName, 'Test reason');
        console.log('✅ Extra break request sent\n');
        
        console.log('🎉 All notification tests completed!');
        console.log('\n📋 Instructions for testing:');
        console.log('1. Open the frontend application in your browser');
        console.log('2. Log in as a regular user');
        console.log('3. Check browser console for socket connection logs');
        console.log('4. Check if desktop notifications appear');
        console.log('5. Log in as an admin user and repeat the test');
        console.log('\n🔍 Debugging tips:');
        console.log('- Check browser console for socket connection status');
        console.log('- Verify notification permissions are granted');
        console.log('- Check if socket events are being received');
        console.log('- Look for any JavaScript errors in the console');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error testing desktop notifications:', error);
        process.exit(1);
    }
};

testDesktopNotifications();

