// backend/seed.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('./models/User');
const Shift = require('./models/Shift');

const seed = async () => {
  try {
    console.log('🔁 Connecting to MongoDB...');
    // Use your .env variable and specify the database name
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // --- Seeding Default Shift ---
    console.log('🔄 Checking for default shift...');
    // Use findOneAndUpdate with upsert:true to create the shift only if it doesn't exist.
    const shift = await Shift.findOneAndUpdate(
      { shiftName: 'Default Shift' }, // The query to find the document
      { // The data to insert if it's not found
        shiftName: 'Default Shift',
        shiftType: 'Fixed',
        startTime: '09:00:00',
        endTime: '18:00:00',
        durationHours: 9, // Corrected to 9
        paidBreakMinutes: 30,
      },
      { 
        upsert: true, // Create the document if it does not exist
        new: true,    // Return the new document if created, or the existing one if found
        setDefaultsOnInsert: true
      }
    );
    console.log('✅ Default shift ensured:', shift.shiftName);

    // --- Seeding Admin User ---
    console.log('🔄 Checking for admin user...');
    const adminEmail = 'admin@example.com';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log('✅ Admin user already exists.');
    } else {
      console.log('👤 Admin user not found, creating new admin...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const adminUser = await User.create({
        employeeCode: 'EMP001',
        fullName: 'Admin User',
        email: adminEmail,
        passwordHash: hashedPassword,
        role: 'Admin',
        joiningDate: new Date(),
        shiftGroup: shift._id,
      });
      console.log('✅ Admin user created:', adminUser.email);
    }

    console.log('🌱 Seeding process complete.');
    process.exit(0);

  } catch (err) {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  }
};

seed();