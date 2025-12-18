// backend/scripts/migrate-break-windows.js
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function migrateBreakWindows() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
        console.log('Connected to MongoDB');

        // Update all users to include breakWindows array in featurePermissions
        const result = await User.updateMany(
            { 'featurePermissions.breakWindows': { $exists: false } },
            { 
                $set: { 
                    'featurePermissions.breakWindows': []
                }
            }
        );

        console.log(`Migration completed successfully. Updated ${result.modifiedCount} users.`);

        // Verify the migration
        const usersWithBreakWindows = await User.countDocuments({
            'featurePermissions.breakWindows': { $exists: true }
        });
        
        const totalUsers = await User.countDocuments();
        console.log(`Verification: ${usersWithBreakWindows}/${totalUsers} users now have breakWindows field.`);

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateBreakWindows();
}

module.exports = migrateBreakWindows;


