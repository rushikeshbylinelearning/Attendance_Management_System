// Migration script to move canViewAnalytics from advancedFeatures to top-level
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function migrateAnalyticsPermission() {
    try {
        console.log('🔄 Starting migration: Moving canViewAnalytics to top-level...\n');

        // Connect to database
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to database');

        // Find all users
        const users = await User.find({});
        console.log(`📊 Found ${users.length} users to migrate\n`);

        let updatedCount = 0;
        let skippedCount = 0;

        for (const user of users) {
            const updates = {};
            let needsUpdate = false;

            // Check if user has canViewAnalytics in advancedFeatures
            if (user.featurePermissions?.advancedFeatures?.canViewAnalytics !== undefined) {
                // Move the value to top level
                updates['featurePermissions.canViewAnalytics'] = user.featurePermissions.advancedFeatures.canViewAnalytics;
                
                // Remove it from advancedFeatures
                updates['featurePermissions.advancedFeatures.canViewAnalytics'] = undefined;
                
                needsUpdate = true;
                console.log(`👤 ${user.fullName} (${user.employeeCode})`);
                console.log(`   Moving canViewAnalytics: ${user.featurePermissions.advancedFeatures.canViewAnalytics} → top-level`);
            } 
            // If user doesn't have canViewAnalytics at all, set default
            else if (user.featurePermissions && user.featurePermissions.canViewAnalytics === undefined) {
                updates['featurePermissions.canViewAnalytics'] = false;
                needsUpdate = true;
                console.log(`👤 ${user.fullName} (${user.employeeCode})`);
                console.log(`   Setting default canViewAnalytics: false`);
            }

            if (needsUpdate) {
                await User.updateOne({ _id: user._id }, { $set: updates, $unset: { 'featurePermissions.advancedFeatures.canViewAnalytics': 1 } });
                updatedCount++;
            } else {
                skippedCount++;
            }
        }

        console.log('\n✅ Migration completed successfully!');
        console.log(`   Updated: ${updatedCount} users`);
        console.log(`   Skipped: ${skippedCount} users (already migrated)`);

        // Verify migration
        console.log('\n🔍 Verifying migration...');
        const verifyUsers = await User.find({}).limit(5);
        
        for (const user of verifyUsers) {
            console.log(`\n👤 ${user.fullName}:`);
            console.log(`   canViewAnalytics (top-level): ${user.featurePermissions?.canViewAnalytics}`);
            console.log(`   canViewAnalytics (advanced): ${user.featurePermissions?.advancedFeatures?.canViewAnalytics || 'undefined'}`);
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from database');
    }
}

// Run migration
migrateAnalyticsPermission();
