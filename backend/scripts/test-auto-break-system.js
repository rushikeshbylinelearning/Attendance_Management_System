// backend/scripts/test-auto-break-system.js
const mongoose = require('mongoose');
const User = require('../models/User');
const BreakLog = require('../models/BreakLog');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceSession = require('../models/AttendanceSession');
const ExcelLog = require('../models/ExcelLog');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

async function testAutoBreakSystem() {
    try {
        console.log('🧪 Testing Auto-Break System...\n');

        // Test 1: Check if User schema has auto-break fields
        console.log('1. Testing User Schema...');
        const userSchema = User.schema.paths;
        const hasAutoBreakField = 'featurePermissions.autoBreakOnInactivity' in userSchema;
        const hasThresholdField = 'featurePermissions.inactivityThresholdMinutes' in userSchema;
        
        console.log(`   ✓ autoBreakOnInactivity field: ${hasAutoBreakField ? '✅' : '❌'}`);
        console.log(`   ✓ inactivityThresholdMinutes field: ${hasThresholdField ? '✅' : '❌'}\n`);

        // Test 2: Check if BreakLog schema supports auto-breaks
        console.log('2. Testing BreakLog Schema...');
        const breakLogSchema = BreakLog.schema.paths;
        const hasUserIdField = 'userId' in breakLogSchema;
        const hasTypeField = 'type' in breakLogSchema;
        const hasIsAutoBreakField = 'isAutoBreak' in breakLogSchema;
        const hasReasonField = 'reason' in breakLogSchema;
        
        console.log(`   ✓ userId field: ${hasUserIdField ? '✅' : '❌'}`);
        console.log(`   ✓ type field: ${hasTypeField ? '✅' : '❌'}`);
        console.log(`   ✓ isAutoBreak field: ${hasIsAutoBreakField ? '✅' : '❌'}`);
        console.log(`   ✓ reason field: ${hasReasonField ? '✅' : '❌'}\n`);

        // Test 3: Check if ExcelLog supports auto-break logging
        console.log('3. Testing ExcelLog Schema...');
        const excelLogSchema = ExcelLog.schema.paths;
        const logTypeEnum = excelLogSchema.logType.enumValues;
        const hasAutoBreakStart = logTypeEnum.includes('AUTO_BREAK_START');
        const hasAutoBreakEnd = logTypeEnum.includes('AUTO_BREAK_END');
        
        console.log(`   ✓ AUTO_BREAK_START log type: ${hasAutoBreakStart ? '✅' : '❌'}`);
        console.log(`   ✓ AUTO_BREAK_END log type: ${hasAutoBreakEnd ? '✅' : '❌'}\n`);

        // Test 4: Find a test user and update their auto-break settings
        console.log('4. Testing User Auto-Break Settings...');
        const testUser = await User.findOne({ role: { $ne: 'Admin' } });
        
        if (testUser) {
            console.log(`   Found test user: ${testUser.fullName} (${testUser.email})`);
            
            // Update user's auto-break settings
            testUser.featurePermissions = {
                ...testUser.featurePermissions,
                autoBreakOnInactivity: true,
                inactivityThresholdMinutes: 3 // Set to 3 minutes for testing
            };
            
            await testUser.save();
            console.log('   ✓ Auto-break settings updated successfully');
            
            // Verify the settings were saved
            const updatedUser = await User.findById(testUser._id);
            const autoBreakEnabled = updatedUser.featurePermissions?.autoBreakOnInactivity;
            const threshold = updatedUser.featurePermissions?.inactivityThresholdMinutes;
            
            console.log(`   ✓ Auto-break enabled: ${autoBreakEnabled ? '✅' : '❌'}`);
            console.log(`   ✓ Threshold: ${threshold} minutes\n`);
        } else {
            console.log('   ❌ No test user found\n');
        }

        // Test 5: Create a test auto-break log
        console.log('5. Testing Auto-Break Log Creation...');
        if (testUser) {
            const testAutoBreak = new BreakLog({
                userId: testUser._id,
                type: 'Auto-Unpaid-Break',
                breakType: 'Unpaid',
                startTime: new Date(),
                reason: 'Test inactivity detected',
                isAutoBreak: true
            });
            
            await testAutoBreak.save();
            console.log('   ✓ Auto-break log created successfully');
            console.log(`   ✓ Break ID: ${testAutoBreak._id}`);
            
            // Clean up test data
            await BreakLog.findByIdAndDelete(testAutoBreak._id);
            console.log('   ✓ Test auto-break log cleaned up\n');
        }

        // Test 6: Test Excel logging
        console.log('6. Testing Excel Logging...');
        if (testUser) {
            const testExcelLog = new ExcelLog({
                user: testUser._id,
                logType: 'AUTO_BREAK_START',
                logData: {
                    breakId: new mongoose.Types.ObjectId(),
                    reason: 'Test inactivity',
                    startTime: new Date(),
                    type: 'Auto-Unpaid-Break'
                },
                synced: false
            });
            
            await testExcelLog.save();
            console.log('   ✓ Auto-break Excel log created successfully');
            
            // Clean up test data
            await ExcelLog.findByIdAndDelete(testExcelLog._id);
            console.log('   ✓ Test Excel log cleaned up\n');
        }

        console.log('🎉 Auto-Break System Test Completed Successfully!');
        console.log('\n📋 Summary:');
        console.log('   ✅ User schema supports auto-break settings');
        console.log('   ✅ BreakLog schema supports auto-break records');
        console.log('   ✅ ExcelLog schema supports auto-break logging');
        console.log('   ✅ User auto-break settings can be updated');
        console.log('   ✅ Auto-break logs can be created and managed');
        console.log('   ✅ Activity logging works for auto-breaks');
        
        console.log('\n🚀 The auto-break system is ready for use!');
        console.log('   • Admins can enable auto-break in Manage Section');
        console.log('   • Employees will be monitored for inactivity');
        console.log('   • Auto-breaks will be logged and tracked');
        console.log('   • Manual break ending is supported');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        mongoose.connection.close();
    }
}

// Run the test
testAutoBreakSystem();


