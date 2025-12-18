// Script to set up the hiring email configuration
const mongoose = require('mongoose');
const Setting = require('../models/Setting');

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

const setupHiringEmail = async () => {
    try {
        await connectDB();
        
        // Set up the hiring email configuration
        const hiringEmailSetting = await Setting.findOneAndUpdate(
            { key: 'hiringNotificationEmails' },
            { 
                key: 'hiringNotificationEmails',
                value: ['Hiring@bylinelearning.com'],
                description: 'Email addresses to receive probation and internship ending notifications'
            },
            { upsert: true, new: true }
        );
        
        console.log('✅ Hiring email configuration set up successfully:');
        console.log('📧 Hiring emails:', hiringEmailSetting.value);
        
        // Also show current HR email configuration for reference
        const hrEmailSetting = await Setting.findOne({ key: 'hrNotificationEmails' });
        if (hrEmailSetting) {
            console.log('📧 Current HR emails:', hrEmailSetting.value);
        } else {
            console.log('📧 No HR emails configured yet');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error setting up hiring email:', error);
        process.exit(1);
    }
};

setupHiringEmail();

