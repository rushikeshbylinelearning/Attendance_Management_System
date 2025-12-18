// backend/services/analyticsEmailService.js

const { sendEmail } = require('./mailService');
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');

// Send late login notification
const sendLateLoginNotification = async (user, attendanceLog) => {
  try {
    const subject = "Late Login Notification - AMS Portal";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
        <div style="background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #d32f2f; margin: 0; font-size: 24px;">⚠️ Late Login Alert</h2>
          </div>
          
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #856404; font-weight: 500;">
              <strong>Dear ${user.fullName},</strong>
            </p>
            <p style="margin: 10px 0 0 0; color: #856404;">
              You logged in late on <strong>${attendanceLog.attendanceDate}</strong> at 
              <strong>${new Date(attendanceLog.clockInTime).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true })}</strong>.
            </p>
            <p style="margin: 10px 0 0 0; color: #856404;">
              <strong>Late by: ${attendanceLog.lateMinutes} minutes</strong>
            </p>
          </div>
          
          ${attendanceLog.isHalfDay ? `
          <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #721c24; font-weight: bold;">
              ⚠️ HALF DAY MARKED: As per company policy, this will be considered as Half Day.
            </p>
          </div>
          ` : ''}
          
          <div style="background-color: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #004085;">
              <strong>Please ensure you arrive on time to maintain good attendance records.</strong>
            </p>
          </div>
          
          <div style="border-top: 1px solid #dee2e6; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6c757d; font-size: 12px; margin: 0;">
              This is an automated notification from AMS Portal.<br>
              If you have any concerns, please contact HR.
            </p>
          </div>
        </div>
      </div>
    `;
    
    await sendEmail({
        isHREmail: true,
      to: user.email,
      subject,
      html
    });
    
    console.log(`Late login notification sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending late login notification:', error);
  }
};

// Send weekly late attendance warning
const sendWeeklyLateWarning = async (user, lateCount) => {
  try {
    const subject = "Late Attendance Notice - AMS Portal";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
        <div style="background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #d32f2f; margin: 0; font-size: 24px;">📋 Attendance Notice</h2>
          </div>
          
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 20px; margin-bottom: 20px;">
            <p style="margin: 0; color: #856404; font-size: 16px;">
              <strong>Dear ${user.fullName},</strong>
            </p>
            <p style="margin: 15px 0 0 0; color: #856404; font-size: 16px;">
              You have been late <strong>${lateCount} times this week</strong>. 
              Please discuss with HR regarding punctuality.
            </p>
          </div>
          
          <div style="background-color: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #004085;">
              <strong>We encourage all employees to maintain punctual attendance for a productive work environment.</strong>
            </p>
          </div>
          
          <div style="border-top: 1px solid #dee2e6; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6c757d; font-size: 12px; margin: 0;">
              This is an automated notification from AMS Portal.<br>
              Please contact HR if you have any questions or concerns.
            </p>
          </div>
        </div>
      </div>
    `;
    
    await sendEmail({
        isHREmail: true,
      to: user.email,
      subject,
      html
    });
    
    console.log(`Weekly late warning sent to ${user.email}`);
  } catch (error) {
    console.error('Error sending weekly late warning:', error);
  }
};

// Send notification to HR about employee's weekly late attendance
const sendHRWeeklyLateNotification = async (user, lateCount) => {
  try {
    // Get HR users
    const hrUsers = await User.find({ 
      role: { $in: ['HR', 'Admin'] },
      isActive: true 
    }).select('email fullName');
    
    if (hrUsers.length === 0) return;
    
    const hrEmails = hrUsers.map(hr => hr.email).join(', ');
    
    const subject = `Weekly Late Attendance Alert - ${user.fullName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8f9fa; padding: 20px;">
        <div style="background-color: #ffffff; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #d32f2f; margin: 0; font-size: 24px;">📊 HR Alert - Late Attendance</h2>
          </div>
          
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 20px; margin-bottom: 20px;">
            <p style="margin: 0; color: #856404; font-size: 16px;">
              <strong>Employee:</strong> ${user.fullName} (${user.email})
            </p>
            <p style="margin: 10px 0 0 0; color: #856404; font-size: 16px;">
              <strong>Department:</strong> ${user.department || 'Not specified'}
            </p>
            <p style="margin: 10px 0 0 0; color: #856404; font-size: 16px;">
              <strong>Late Count This Week:</strong> ${lateCount} times
            </p>
          </div>
          
          <div style="background-color: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #004085;">
              <strong>Action Required:</strong> Please follow up with the employee regarding punctuality.
            </p>
          </div>
          
          <div style="border-top: 1px solid #dee2e6; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6c757d; font-size: 12px; margin: 0;">
              This is an automated notification from AMS Portal.<br>
              Generated on ${new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' })}.
            </p>
          </div>
        </div>
      </div>
    `;
    
    await sendEmail({
        isHREmail: true,
      to: hrEmails,
      subject,
      html
    });
    
    console.log(`HR notification sent for ${user.fullName}'s late attendance`);
  } catch (error) {
    console.error('Error sending HR notification:', error);
  }
};

// Check and send weekly late warnings
const checkAndSendWeeklyLateWarnings = async () => {
  try {
    console.log('Checking for weekly late warnings...');
    
    // Get current week start and end dates
    const now = new Date();
    const currentDay = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - currentDay);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    
    // Get all users
    const users = await User.find({ isActive: true });
    
    for (const user of users) {
      // Count late days for this user in current week
      const lateCount = await AttendanceLog.countDocuments({
        user: user._id,
        attendanceDate: { $gte: weekStartStr, $lte: weekEndStr },
        isLate: true
      });
      
      // If user has been late 3 or more times this week
      if (lateCount >= 3) {
        // Send warning to employee
        await sendWeeklyLateWarning(user, lateCount);
        
        // Send notification to HR
        await sendHRWeeklyLateNotification(user, lateCount);
        
        console.log(`Weekly late warning sent for ${user.fullName} (${lateCount} late days)`);
      }
    }
    
    console.log('Weekly late warning check completed');
  } catch (error) {
    console.error('Error checking weekly late warnings:', error);
  }
};

module.exports = {
  sendLateLoginNotification,
  sendWeeklyLateWarning,
  sendHRWeeklyLateNotification,
  checkAndSendWeeklyLateWarnings
};



