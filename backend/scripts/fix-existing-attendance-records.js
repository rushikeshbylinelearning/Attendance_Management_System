// backend/scripts/fix-existing-attendance-records.js
// Script to fix existing attendance records with correct grace period logic

const mongoose = require('mongoose');
require('dotenv').config();

const AttendanceLog = require('../models/AttendanceLog');
const Setting = require('../models/Setting');

async function fixExistingAttendanceRecords() {
    try {
        console.log('🔧 Starting to fix existing attendance records...');
        
        // Get grace period setting
        let GRACE_PERIOD_MINUTES = 30;
        try {
            const graceSetting = await Setting.findOne({ key: 'lateGraceMinutes' });
            if (graceSetting && !isNaN(Number(graceSetting.value))) {
                GRACE_PERIOD_MINUTES = Number(graceSetting.value);
            }
        } catch (err) {
            console.error('Failed to fetch late grace setting, using default 30 minutes', err);
        }
        
        console.log(`📅 Using grace period: ${GRACE_PERIOD_MINUTES} minutes`);
        
        // Find all attendance records that have clockInTime but incorrect isLate/isHalfDay status
        const attendanceRecords = await AttendanceLog.find({
            clockInTime: { $exists: true, $ne: null },
            $or: [
                { isLate: true },
                { isHalfDay: true },
                { attendanceStatus: { $in: ['Late', 'Half-day'] } }
            ]
        }).lean();
        
        console.log(`📊 Found ${attendanceRecords.length} records to potentially fix`);
        
        let fixedCount = 0;
        let skippedCount = 0;
        
        for (const record of attendanceRecords) {
            const lateMinutes = record.lateMinutes || 0;
            let newIsLate = false;
            let newIsHalfDay = false;
            let newAttendanceStatus = 'On-time';
            
            // Apply correct grace period logic
            if (lateMinutes <= GRACE_PERIOD_MINUTES) {
                // Within grace period = On-time
                newIsLate = false;
                newIsHalfDay = false;
                newAttendanceStatus = 'On-time';
            } else if (lateMinutes > GRACE_PERIOD_MINUTES) {
                // Beyond grace period = Half-day
                newIsHalfDay = true;
                newIsLate = false;
                newAttendanceStatus = 'Half-day';
            }
            
            // Only update if the status has changed
            if (record.isLate !== newIsLate || 
                record.isHalfDay !== newIsHalfDay || 
                record.attendanceStatus !== newAttendanceStatus) {
                
                await AttendanceLog.findByIdAndUpdate(record._id, {
                    isLate: newIsLate,
                    isHalfDay: newIsHalfDay,
                    attendanceStatus: newAttendanceStatus
                });
                
                fixedCount++;
                console.log(`✅ Fixed record for user ${record.user} on ${record.attendanceDate}: ${record.attendanceStatus} → ${newAttendanceStatus}`);
            } else {
                skippedCount++;
            }
        }
        
        console.log(`\n🎉 Fix completed!`);
        console.log(`✅ Fixed: ${fixedCount} records`);
        console.log(`⏭️  Skipped: ${skippedCount} records (already correct)`);
        console.log(`📊 Total processed: ${attendanceRecords.length} records`);
        
    } catch (error) {
        console.error('❌ Error fixing attendance records:', error);
    }
}

// Run the script if called directly
if (require.main === module) {
    mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system')
        .then(() => {
            console.log('🔗 Connected to MongoDB');
            return fixExistingAttendanceRecords();
        })
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = fixExistingAttendanceRecords;

