// backend/scripts/test-permission-system.js
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function testPermissionSystem() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Find a test user (non-admin)
        const testUser = await User.findOne({ 
            role: { $in: ['Employee', 'Intern'] },
            isActive: true 
        });

        if (!testUser) {
            console.log('No test user found. Creating one...');
            return;
        }

        console.log(`Testing with user: ${testUser.fullName} (${testUser.employeeCode})`);
        console.log('Current permissions:', JSON.stringify(testUser.featurePermissions, null, 2));

        // Test 1: Disable leaves permission
        console.log('\n=== Test 1: Disable Leaves Permission ===');
        testUser.featurePermissions.leaves = false;
        await testUser.save();
        console.log('✅ Leaves permission disabled');

        // Test 2: Set privilege level to restricted
        console.log('\n=== Test 2: Set Privilege Level to Restricted ===');
        testUser.featurePermissions.privilegeLevel = 'restricted';
        testUser.featurePermissions.restrictedFeatures.canViewReports = false;
        await testUser.save();
        console.log('✅ Privilege level set to restricted');

        // Test 3: Add break windows
        console.log('\n=== Test 3: Add Break Windows ===');
        testUser.featurePermissions.breakWindows = [
            {
                type: 'Paid',
                name: 'Lunch Break',
                startTime: '12:00',
                endTime: '13:00',
                isActive: true
            },
            {
                type: 'Unpaid',
                name: 'Tea Break',
                startTime: '15:00',
                endTime: '15:15',
                isActive: true
            }
        ];
        await testUser.save();
        console.log('✅ Break windows added');

        // Test 4: Reset to defaults
        console.log('\n=== Test 4: Reset to Defaults ===');
        testUser.featurePermissions = {
            leaves: true,
            breaks: true,
            extraFeatures: false,
            maxBreaks: 999,
            breakAfterHours: 0,
            breakWindows: [],
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
        await testUser.save();
        console.log('✅ Permissions reset to defaults');

        console.log('\n=== Final Permissions ===');
        const updatedUser = await User.findById(testUser._id);
        console.log(JSON.stringify(updatedUser.featurePermissions, null, 2));

        console.log('\n✅ All permission tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the test
testPermissionSystem();


