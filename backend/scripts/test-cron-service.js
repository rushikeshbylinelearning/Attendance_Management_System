// Script to test the cron service functionality
const mongoose = require('mongoose');
const { checkProbationAndInternshipEndings } = require('../services/cronService');

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

const testCronService = async () => {
    try {
        await connectDB();
        
        console.log('🧪 Testing cron service for probation/internship endings...');
        console.log('📅 Current time:', new Date().toLocaleString());
        
        // Run the cron service function
        await checkProbationAndInternshipEndings();
        
        console.log('✅ Cron service test completed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error testing cron service:', error);
        process.exit(1);
    }
};

testCronService();

