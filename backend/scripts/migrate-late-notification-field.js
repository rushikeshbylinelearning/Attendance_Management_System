// Migration script to add lateNotificationSent field to existing AttendanceLog documents
const mongoose = require('mongoose');
require('dotenv').config();

const AttendanceLog = require('../models/AttendanceLog');

async function migrateLateNotificationField() {
    try {
        console.log('🔄 Starting migration to add lateNotificationSent field...\n');

        // Connect to database
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to database');

        // Update all existing attendance logs to add the lateNotificationSent field
        const result = await AttendanceLog.updateMany(
            { lateNotificationSent: { $exists: false } },
            { $set: { lateNotificationSent: false } }
        );

        console.log(`✅ Migration completed successfully!`);
        console.log(`📊 Updated ${result.modifiedCount} attendance log documents`);
        console.log(`📊 Matched ${result.matchedCount} documents`);
        
        if (result.modifiedCount > 0) {
            console.log('\n📝 Migration Summary:');
            console.log('   ✅ Added lateNotificationSent field to all existing attendance logs');
            console.log('   ✅ Set default value to false for existing records');
            console.log('   ✅ New attendance logs will have this field by default');
            console.log('   ✅ Email spam issue should now be resolved');
        } else {
            console.log('\n📝 No documents needed updating - migration already applied');
        }

        console.log('\n🎯 What this migration does:');
        console.log('   1. Adds lateNotificationSent field to AttendanceLog model');
        console.log('   2. Sets default value to false for existing records');
        console.log('   3. Prevents duplicate email notifications for the same late login');
        console.log('   4. Ensures only one email per employee per day for late logins');

        console.log('\n🔍 How the fix works:');
        console.log('   1. When employee clocks in late, system checks lateNotificationSent field');
        console.log('   2. If field is false, sends email and sets field to true');
        console.log('   3. If field is true, skips sending email (prevents duplicates)');
        console.log('   4. Field resets to false for new attendance logs (new days)');

    } catch (error) {
        console.error('❌ Migration failed with error:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from database');
    }
}

// Run the migration
migrateLateNotificationField();
