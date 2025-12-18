// Script to create test users for notification testing
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

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

const createTestUsers = async () => {
    try {
        await connectDB();
        
        console.log('👥 Creating test users for notification testing...\n');
        
        // Check if test users already exist
        const existingAdmin = await User.findOne({ email: 'admin@test.com' });
        const existingUser = await User.findOne({ email: 'user@test.com' });
        
        if (existingAdmin) {
            console.log('✅ Admin test user already exists:', existingAdmin.fullName);
        } else {
            // Create admin test user
            const adminUser = new User({
                employeeCode: 'ADMIN001',
                fullName: 'Test Admin',
                email: 'admin@test.com',
                role: 'Admin',
                domain: 'IT',
                designation: 'System Administrator',
                department: 'IT',
                joiningDate: new Date(),
                isActive: true,
                passwordHash: await bcrypt.hash('password123', 10),
                leaveBalances: { paid: 12, sick: 6 }
            });
            
            await adminUser.save();
            console.log('✅ Created admin test user:', adminUser.fullName);
        }
        
        if (existingUser) {
            console.log('✅ Regular test user already exists:', existingUser.fullName);
        } else {
            // Create regular test user
            const regularUser = new User({
                employeeCode: 'USER001',
                fullName: 'Test User',
                email: 'user@test.com',
                role: 'Employee',
                domain: 'IT',
                designation: 'Software Developer',
                department: 'IT',
                joiningDate: new Date(),
                isActive: true,
                passwordHash: await bcrypt.hash('password123', 10),
                leaveBalances: { paid: 12, sick: 6 }
            });
            
            await regularUser.save();
            console.log('✅ Created regular test user:', regularUser.fullName);
        }
        
        console.log('\n🎉 Test users ready for notification testing!');
        console.log('📧 Admin: admin@test.com');
        console.log('📧 User: user@test.com');
        console.log('🔑 Password for both: password123');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating test users:', error);
        process.exit(1);
    }
};

createTestUsers();

