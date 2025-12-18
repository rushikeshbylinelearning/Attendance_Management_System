// backend/services/cronService.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Setting = require('../models/Setting');
const LeaveRequest = require('../models/LeaveRequest'); // <-- NEW
const { sendEmail } = require('./mailService');
const { checkAndSendWeeklyLateWarnings } = require('./analyticsEmailService');
const ProbationTrackingService = require('./probationTrackingService');

// --- CONFIGURATION (from .env) ---
const PROBATION_PERIOD_DAYS = parseInt(process.env.PROBATION_PERIOD_DAYS, 10) || 90;
// const INTERN_PERIOD_DAYS = parseInt(process.env.INTERN_PERIOD_DAYS, 10) || 180; // No longer needed
const REMINDER_WINDOW_DAYS = 7;

/**
 * A daily job to check for employees whose probation or internship is ending soon.
 */
const checkProbationAndInternshipEndings = async () => {
    console.log(`[CRON] Running daily check for probation/internship endings at ${new Date().toLocaleString()}`);

    // Check if database is connected before running queries
    if (mongoose.connection.readyState !== 1) {
        console.log('[CRON] Database not connected, skipping daily check');
        return;
    }

    try {
        // First try to get hiring-specific email setting
        let recipients = null;
        
        const hiringEmailSetting = await Setting.findOne({ key: 'hiringNotificationEmails' });
        if (hiringEmailSetting && Array.isArray(hiringEmailSetting.value) && hiringEmailSetting.value.length > 0) {
            recipients = hiringEmailSetting.value.join(',');
        } else {
            // Fallback to general HR emails if hiring emails not configured
            const hrEmailSetting = await Setting.findOne({ key: 'hrNotificationEmails' });
            if (hrEmailSetting && Array.isArray(hrEmailSetting.value) && hrEmailSetting.value.length > 0) {
                recipients = hrEmailSetting.value.join(',');
            }
        }

        if (!recipients) {
            console.log('[CRON] No hiring/HR email recipients configured. Skipping reminder emails.');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const targetUsers = await User.find({
            isActive: true,
            employmentStatus: { $in: ['Probation', 'Intern'] }
        }).lean();

        for (const user of targetUsers) {
            const joiningDate = new Date(user.joiningDate);
            let endDate;
            let periodType = user.employmentStatus;

            if (user.employmentStatus === 'Probation') {
                endDate = new Date(joiningDate.getTime());
                endDate.setDate(joiningDate.getDate() + PROBATION_PERIOD_DAYS);
            } else if (user.employmentStatus === 'Intern' && user.internshipDurationMonths > 0) {
                // --- START: Internship Extension Logic ---
                // 1. Calculate base end date
                const baseEndDate = new Date(joiningDate.getTime());
                baseEndDate.setMonth(baseEndDate.getMonth() + user.internshipDurationMonths);

                // 2. Find all approved Planned or Sick leaves for this intern
                const approvedLeaves = await LeaveRequest.find({
                    employee: user._id,
                    status: 'Approved',
                    requestType: { $in: ['Planned', 'Sick'] }
                }).lean();

                // 3. Calculate total leave days to extend the internship
                let totalLeaveDays = 0;
                approvedLeaves.forEach(leave => {
                    const duration = leave.leaveDates.length * (leave.leaveType === 'Full Day' ? 1 : 0.5);
                    totalLeaveDays += duration;
                });
                
                // 4. Calculate the actual, extended end date
                endDate = new Date(baseEndDate.getTime());
                endDate.setDate(baseEndDate.getDate() + Math.ceil(totalLeaveDays)); // Use ceil to be safe
                // --- END: Internship Extension Logic ---
            }

            if (!endDate) continue; // Skip if no valid end date could be calculated
            
            const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (daysUntilEnd > 0 && daysUntilEnd <= REMINDER_WINDOW_DAYS) {
                console.log(`[CRON] Sending reminder for ${user.fullName} whose ${periodType} period ends on ${endDate.toLocaleDateString()}`);

                const subject = `Reminder: ${user.fullName}'s ${periodType} Period Ending Soon`;
                const html = `
                    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                        <h2 style="color: #D32F2F;">Automated Reminder</h2>
                        <p>This is a notification that the <strong>${periodType}</strong> period for the following employee is scheduled to end soon:</p>
                        <ul>
                            <li><strong>Employee Name:</strong> ${user.fullName}</li>
                            <li><strong>Employee Code:</strong> ${user.employeeCode}</li>
                            <li><strong>Calculated End Date:</strong> ${endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                        </ul>
                        <p>Please take the necessary action (e.g., confirmation, extension, etc.) in the admin panel.</p>
                        <p style="font-size: 0.9em; color: #777;">This is an automated message from the Attendance Management System.</p>
                    </div>
                `;
                
                sendEmail({ to: recipients, subject, html, isHREmail: true }).catch(err => {
                    console.error(`[CRON] Failed to send reminder email for ${user.fullName}:`, err);
                });
            }
        }
    } catch (error) {
        console.error('[CRON] Error during daily check:', error);
    }
};

/**
 * Weekly job to check for employees with 3+ late days and send warnings
 */
const checkWeeklyLateWarnings = async () => {
    console.log(`[CRON] Running weekly late attendance check at ${new Date().toLocaleString()}`);
    
    if (mongoose.connection.readyState !== 1) {
        console.log('[CRON] Database not connected, skipping weekly late check');
        return;
    }

    try {
        await checkAndSendWeeklyLateWarnings();
    } catch (error) {
        console.error('[CRON] Error during weekly late check:', error);
    }
};

/**
 * Daily job to check for probation completions
 */
const checkProbationCompletions = async () => {
    console.log(`[CRON] Running daily probation completion check at ${new Date().toLocaleString()}`);
    
    if (mongoose.connection.readyState !== 1) {
        console.log('[CRON] Database not connected, skipping probation completion check');
        return;
    }

    try {
        await ProbationTrackingService.checkProbationCompletions();
    } catch (error) {
        console.error('[CRON] Error during probation completion check:', error);
    }
};

/**
 * Starts the scheduled jobs for the application.
 */
const startScheduledJobs = () => {
    // Daily jobs
    checkProbationAndInternshipEndings();
    setInterval(checkProbationAndInternshipEndings, 24 * 60 * 60 * 1000);
    
    // Daily probation completion check
    checkProbationCompletions();
    setInterval(checkProbationCompletions, 24 * 60 * 60 * 1000);
    
    // Weekly jobs (every Monday at 9 AM)
    checkWeeklyLateWarnings();
    setInterval(checkWeeklyLateWarnings, 7 * 24 * 60 * 60 * 1000);
    
    console.log('✅ Scheduled jobs (probation reminders, probation completions, weekly late warnings) have been started.');
};

module.exports = { startScheduledJobs, checkProbationAndInternshipEndings };