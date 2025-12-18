const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('../models/User');

const ADMIN_EMAIL = 'rpj9011@gmail.com';
const ADMIN_PASSWORD = 'password123';

const createOrUpdateAdmin = async () => {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    'mongodb://localhost:27017/attendance-system';

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const existingUser = await User.findOne({ email: ADMIN_EMAIL });
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    if (existingUser) {
      existingUser.role = 'Admin';
      existingUser.passwordHash = passwordHash;
      existingUser.authMethod = 'local';
      existingUser.isActive = true;
      existingUser.accountLocked = false;
      existingUser.joiningDate = existingUser.joiningDate || new Date();
      existingUser.fullName = existingUser.fullName || 'Administrator';
      existingUser.employeeCode =
        existingUser.employeeCode || `ADMIN-${Date.now()}`;

      await existingUser.save();
      console.log(`✅ Updated existing admin account: ${ADMIN_EMAIL}`);
    } else {
      const uniqueSuffix = Date.now().toString(36).toUpperCase();
      const employeeCode = `ADMIN-${uniqueSuffix}`;

      await User.create({
        employeeCode,
        fullName: 'Administrator',
        email: ADMIN_EMAIL,
        role: 'Admin',
        authMethod: 'local',
        joiningDate: new Date(),
        isActive: true,
        accountLocked: false,
        passwordHash,
      });

      console.log(`✅ Created new admin account: ${ADMIN_EMAIL}`);
    }
  } catch (error) {
    console.error('❌ Failed to create or update admin account:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

createOrUpdateAdmin();







