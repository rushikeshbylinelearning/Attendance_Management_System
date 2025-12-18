// backend/scripts/migrate-feature-permissions.js
// Migration script to add featurePermissions to existing users

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
        console.log('MongoDB connected for migration');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// User model (simplified for migration)
const userSchema = new mongoose.Schema({
    employeeCode: String,
    fullName: String,
    email: String,
    role: String,
    featurePermissions: {
        leaves: { type: Boolean, default: true },
        breaks: { type: Boolean, default: true },
        extraFeatures: { type: Boolean, default: false },
        maxBreaks: { type: Number, default: 999, min: 0 }, // No restrictions
        breakAfterHours: { type: Number, default: 0, min: 0 }, // Can take break immediately
        canCheckIn: { type: Boolean, default: true },
        canCheckOut: { type: Boolean, default: true },
        canTakeBreak: { type: Boolean, default: true },
        privilegeLevel: { 
            type: String, 
            enum: ['restricted', 'normal', 'advanced'], 
            default: 'normal' 
        },
        restrictedFeatures: {
            canViewReports: { type: Boolean, default: false },
            canViewOtherLogs: { type: Boolean, default: false },
            canEditProfile: { type: Boolean, default: true },
            canRequestExtraBreak: { type: Boolean, default: true }
        },
        advancedFeatures: {
            canBulkActions: { type: Boolean, default: false },
            canExportData: { type: Boolean, default: false },
            canViewAnalytics: { type: Boolean, default: false }
        }
    }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Default permissions based on role
const getDefaultPermissions = (role) => {
    const basePermissions = {
        leaves: true,
        breaks: true,
        extraFeatures: false,
        maxBreaks: 999, // No restrictions
        breakAfterHours: 0, // Can take break immediately
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

    // Role-specific adjustments
    switch (role) {
        case 'Admin':
            return {
                ...basePermissions,
                privilegeLevel: 'advanced',
                extraFeatures: true,
                advancedFeatures: {
                    canBulkActions: true,
                    canExportData: true,
                    canViewAnalytics: true
                }
            };
        case 'HR':
            return {
                ...basePermissions,
                privilegeLevel: 'normal',
                extraFeatures: true,
                advancedFeatures: {
                    canBulkActions: false,
                    canExportData: true,
                    canViewAnalytics: false
                }
            };
        case 'Employee':
            return basePermissions;
        case 'Intern':
            return {
                ...basePermissions,
                privilegeLevel: 'restricted',
                restrictedFeatures: {
                    canViewReports: false,
                    canViewOtherLogs: false,
                    canEditProfile: true,
                    canRequestExtraBreak: false
                }
            };
        default:
            return basePermissions;
    }
};

// Migration function
const migrateFeaturePermissions = async () => {
    try {
        console.log('Starting feature permissions migration...');
        
        // Find all users without featurePermissions
        const usersToMigrate = await User.find({
            $or: [
                { featurePermissions: { $exists: false } },
                { featurePermissions: null }
            ]
        });

        console.log(`Found ${usersToMigrate.length} users to migrate`);

        if (usersToMigrate.length === 0) {
            console.log('No users need migration. All users already have featurePermissions.');
            return;
        }

        // Update each user with default permissions based on their role
        const updatePromises = usersToMigrate.map(async (user) => {
            const defaultPermissions = getDefaultPermissions(user.role);
            
            await User.findByIdAndUpdate(user._id, {
                $set: { featurePermissions: defaultPermissions }
            });
            
            console.log(`Updated permissions for ${user.fullName} (${user.role})`);
        });

        await Promise.all(updatePromises);
        
        console.log(`Successfully migrated ${usersToMigrate.length} users`);
        
        // Verify migration
        const remainingUsers = await User.find({
            $or: [
                { featurePermissions: { $exists: false } },
                { featurePermissions: null }
            ]
        });
        
        if (remainingUsers.length === 0) {
            console.log('✅ Migration completed successfully! All users now have featurePermissions.');
        } else {
            console.log(`⚠️ Warning: ${remainingUsers.length} users still need migration`);
        }
        
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
};

// Main execution
const main = async () => {
    try {
        await connectDB();
        await migrateFeaturePermissions();
        console.log('Migration script completed');
    } catch (error) {
        console.error('Migration script failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Run migration if this script is executed directly
if (require.main === module) {
    main();
}

module.exports = { migrateFeaturePermissions, getDefaultPermissions };


