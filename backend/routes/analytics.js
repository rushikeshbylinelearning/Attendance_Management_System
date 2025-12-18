// backend/routes/analytics.js

const express = require('express');
const mongoose = require('mongoose');
const authenticateToken = require('../middleware/authenticateToken');
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceSession = require('../models/AttendanceSession');
const BreakLog = require('../models/BreakLog');
const LeaveRequest = require('../models/LeaveRequest');
const Setting = require('../models/Setting'); // <-- IMPORT SETTING MODEL
const { sendEmail } = require('../services/mailService');

const router = express.Router();

// Helper function to calculate analytics metrics
const calculateAnalyticsMetrics = async (userId, startDate, endDate, monthlyContextDays) => { // <-- ADDED PARAM
  // Ensure dates are in YYYY-MM-DD format (string comparison for MongoDB)
  const normalizedStartDate = typeof startDate === 'string' ? startDate : new Date(startDate).toISOString().slice(0, 10);
  const normalizedEndDate = typeof endDate === 'string' ? endDate : new Date(endDate).toISOString().slice(0, 10);
  
  const logs = await AttendanceLog.find({
    user: userId,
    attendanceDate: { $gte: normalizedStartDate, $lte: normalizedEndDate }
  }).sort({ attendanceDate: 1 });

  const metrics = {
    totalDays: logs.length,
    onTimeDays: 0,
    lateDays: 0,
    halfDays: 0,
    absentDays: 0,
    totalWorkingHours: 0,
    averageWorkingHours: 0,
    lateMinutes: 0,
    averageLateMinutes: 0
  };
  // Read dynamic late-grace setting so our derivation matches runtime behavior
  let lateGraceMinutes = 30;
  try {
    const graceSetting = await Setting.findOne({ key: 'lateGraceMinutes' });
    if (graceSetting && !isNaN(Number(graceSetting.value))) {
      lateGraceMinutes = Number(graceSetting.value);
    }
  } catch (err) {
    console.error('Failed to fetch late grace setting for analytics derivation, using default 30 minutes', err);
  }

  logs.forEach(log => {
    // Some logs may not have attendanceStatus set (legacy or not yet processed).
    // Derive status from available fields to ensure accurate counts per employee.
    let status = log.attendanceStatus;
    if (!status) {
      const lm = log.lateMinutes || 0;

      // Consistent rules:
      // - If clockInTime exists, employee was present (not absent)
      // - If lm <= lateGraceMinutes -> On-time (within grace period)
      // - If lm > lateGraceMinutes -> Half-day
      // - Else -> Absent
      // Grace period allows employees to arrive late without penalty
      if (log.clockInTime) {
        // Employee was present, determine if on-time or half-day
        if (log.isHalfDay || lm > lateGraceMinutes) {
          status = 'Half-day';
        } else {
          status = 'On-time';
        }
      } else {
        // No clock-in time means truly absent
        status = 'Absent';
      }
    }

    if (status === 'On-time') metrics.onTimeDays++;
    else if (status === 'Late') metrics.lateDays++;
    else if (status === 'Half-day') metrics.halfDays++;
    else if (status === 'Absent') metrics.absentDays++;

    // Only count working hours for days that have been completed (clocked out)
    if (log.clockOutTime && log.totalWorkingHours) {
      metrics.totalWorkingHours += log.totalWorkingHours;
    }
    metrics.lateMinutes += log.lateMinutes || 0;
  });

  // Calculate average working hours only for completed days
  const completedDays = logs.filter(log => log.clockOutTime && log.totalWorkingHours).length;
  metrics.averageWorkingHours = completedDays > 0 ? (metrics.totalWorkingHours / completedDays) : 0;
  
  // Add additional metrics for better debugging
  metrics.completedDays = completedDays;
  metrics.incompleteDays = metrics.totalDays - completedDays;
  metrics.averageLateMinutes = metrics.lateDays > 0 ? (metrics.lateMinutes / metrics.lateDays) : 0;

  // Calculate monthly working days context
  const startDateObj = new Date(normalizedStartDate);
  const endDateObj = new Date(normalizedEndDate);
  
  // Get leave requests for the period (all statuses to show applied leaves count)
  let leaveRequests = [];
  try {
    leaveRequests = await LeaveRequest.find({
      employee: userId,
      leaveDates: {
        $elemMatch: {
          $gte: startDateObj,
          $lte: endDateObj
        }
      }
    });
  } catch (leaveError) {
    console.error('Error fetching leave requests:', leaveError);
    leaveRequests = [];
  }

  // Calculate total leave days for the requested period
  let totalLeaveDays = 0;
  leaveRequests.forEach(leave => {
    const leaveDaysInPeriod = leave.leaveDates.filter(date => {
      const leaveDate = new Date(date);
      return leaveDate >= startDateObj && leaveDate <= endDateObj;
    }).length;
    totalLeaveDays += leaveDaysInPeriod;
  });

  // Additionally compute Year-To-Date and All-Time leave aggregates so UI can show
  // leaves even when current table period is a different month
  const nowIST = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
  const ytdStart = new Date(nowIST.getFullYear(), 0, 1);
  const todayDate = nowIST;

  let leaveRequestsYTD = [];
  try {
    leaveRequestsYTD = await LeaveRequest.find({
      employee: userId,
      leaveDates: { $elemMatch: { $gte: ytdStart, $lte: todayDate } }
    }).lean();
  } catch (leaveYTDError) {
    console.error('Error fetching YTD leave requests:', leaveYTDError);
    leaveRequestsYTD = [];
  }

  let totalLeaveDaysYTD = 0;
  leaveRequestsYTD.forEach(leave => {
    totalLeaveDaysYTD += leave.leaveDates.filter(d => {
      const ld = new Date(d);
      return ld >= ytdStart && ld <= todayDate;
    }).length;
  });

  // All-time aggregates (no date filter)
  let leaveRequestsAllTime = [];
  try {
    leaveRequestsAllTime = await LeaveRequest.find({ employee: userId }).lean();
  } catch (leaveAllTimeError) {
    console.error('Error fetching all-time leave requests:', leaveAllTimeError);
    leaveRequestsAllTime = [];
  }
  const totalLeaveDaysAllTime = leaveRequestsAllTime.reduce((sum, leave) => sum + (leave.leaveDates?.length || 0), 0);

  // --- START OF FIX ---
  // Use the monthlyContextDays from settings for the denominator.
  metrics.totalDaysInPeriod = monthlyContextDays;
  metrics.workingDaysRatio = monthlyContextDays > 0 ? (metrics.totalDays / monthlyContextDays) : 0;
  metrics.totalLeaveDays = totalLeaveDays;
  metrics.leaveRequests = leaveRequests.length;
  metrics.totalLeaveDaysYTD = totalLeaveDaysYTD;
  metrics.leaveRequestsYTD = leaveRequestsYTD.length;
  metrics.totalLeaveDaysAllTime = totalLeaveDaysAllTime;
  metrics.leaveRequestsAllTime = leaveRequestsAllTime.length;
  metrics.monthlyContext = `${metrics.totalDays}/${monthlyContextDays} days worked`;
  // --- END OF FIX ---

  return metrics;
};

// Timezone-aware shift start time helper (same as in attendance.js)
const getShiftDateTimeIST = (onDate, shiftTime) => {
  const [hours, minutes] = shiftTime.split(':').map(Number);
  const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const [{ value: year },, { value: month },, { value: day }] = istDateFormatter.formatToParts(onDate);
  const shiftDateTimeISO_IST = `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000+05:30`;
  return new Date(shiftDateTimeISO_IST);
};

// Helper function to check if login is late and update attendance log
const checkAndUpdateLateStatus = async (attendanceLog, user) => {
  if (!user.shiftGroup || !user.shiftGroup.startTime) return;

  const clockInTime = new Date(attendanceLog.clockInTime);
  
  // Use the proper timezone-aware function to get shift start time
  const shiftStartTime = getShiftDateTimeIST(clockInTime, user.shiftGroup.startTime);
  
  const lateMinutes = Math.max(0, Math.floor((clockInTime - shiftStartTime) / (1000 * 60)));
  
  let isLate = false;
  let isHalfDay = false;
  let attendanceStatus = 'On-time';
  // Grace period: configurable via settings (default 30 minutes)
  let GRACE_PERIOD_MINUTES = 30;
  try {
    const graceSetting = await Setting.findOne({ key: 'lateGraceMinutes' });
    if (graceSetting && !isNaN(Number(graceSetting.value))) {
      GRACE_PERIOD_MINUTES = Number(graceSetting.value);
    }
  } catch (err) {
    console.error('Failed to fetch late grace setting, falling back to 30 minutes', err);
  }

  // Consistent rules:
  // - If lateMinutes <= GRACE_PERIOD_MINUTES -> On-time (within grace period)
  // - If lateMinutes > GRACE_PERIOD_MINUTES -> Half-day
  // - Employee is always present if they clocked in (never absent)
  // Grace period allows employees to arrive late without penalty
  if (lateMinutes <= GRACE_PERIOD_MINUTES) {
    isLate = false;
    isHalfDay = false;
    attendanceStatus = 'On-time';
  } else if (lateMinutes > GRACE_PERIOD_MINUTES) {
    isHalfDay = true;
    isLate = false;
    attendanceStatus = 'Half-day';
  }

  // Update the attendance log
  await AttendanceLog.findByIdAndUpdate(attendanceLog._id, {
    isLate,
    isHalfDay,
    lateMinutes,
    attendanceStatus
  });

  // Send email notification if late and not already sent
  if (isLate && !attendanceLog.lateNotificationSent) {
    try {
      // Convert minutes to hours and minutes for better readability
      const lateHours = Math.floor(lateMinutes / 60);
      const remainingMinutes = lateMinutes % 60;
      const lateTimeText = lateHours > 0 
        ? `${lateHours}h ${remainingMinutes}m` 
        : `${remainingMinutes}m`;

      const subject = "Late Login Notification - AMS Portal";
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
          <!-- Header with Company Logo -->
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #ddd;">
            <img src="https://bylinelearning.com/wp-content/uploads/2023/08/Byline-Logo.png" alt="Byline Learning" style="height: 40px; max-width: 200px;">
          </div>
          
          <!-- Main Content -->
          <div style="padding: 30px;">
            <!-- Alert Header -->
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                <span style="color: #856404; font-size: 20px; font-weight: bold;">⚠️</span>
              </div>
              <h2 style="color: #d32f2f; margin: 0; font-size: 24px;">Late Login Alert</h2>
            </div>

            <!-- Login Details -->
            <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0; font-size: 16px;">Dear <strong>${user.fullName}</strong>,</p>
              <p style="margin: 0 0 10px 0; font-size: 16px;">You logged in late on <strong>${attendanceLog.attendanceDate}</strong> at <strong>${clockInTime.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true })}</strong>.</p>
              <p style="margin: 0; font-size: 16px; color: #d32f2f; font-weight: bold;">Late by: <strong>${lateTimeText}</strong></p>
            </div>

            <!-- Policy Notification -->
            ${isHalfDay ? `
            <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <div style="display: flex; align-items: center;">
                <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 10px;">
                  <span style="color: #856404; font-size: 16px; font-weight: bold;">⚠️</span>
                </div>
                <p style="margin: 0; color: #d32f2f; font-weight: bold; font-size: 16px;">HALF DAY MARKED: As per company policy, this will be considered as Half Day.</p>
              </div>
            </div>
            ` : ''}

            <!-- Reminder -->
            <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <p style="margin: 0; color: #0c5460; font-size: 16px;">Please ensure you arrive on time to maintain good attendance records.</p>
            </div>

            <!-- Footer -->
            <div style="border-top: 1px solid #ddd; padding-top: 20px; text-align: center;">
              <p style="color: #666; font-size: 12px; margin: 0 0 5px 0;">This is an automated notification from AMS Portal.</p>
              <p style="color: #666; font-size: 12px; margin: 0;">If you have any concerns, please contact HR.</p>
            </div>
          </div>
        </div>
      `;
      
      await sendEmail({
        to: user.email,
        subject,
        html
      });
      
      // Mark that notification has been sent
      await AttendanceLog.findByIdAndUpdate(attendanceLog._id, {
        lateNotificationSent: true
      });
      
      console.log(`Late login notification sent to ${user.email} for ${attendanceLog.attendanceDate}`);
    } catch (error) {
      console.error('Error sending late login notification:', error);
    }
  }

  return { isLate, isHalfDay, lateMinutes, attendanceStatus };
};

// GET /api/analytics/monthly-overview - Get monthly overview data for charts
router.get('/monthly-overview', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all active users
    const users = await User.find({ isActive: true }).lean();
    const userIds = users.map(user => user._id);
    
    // Generate monthly data for the last 3 months
    const monthlyData = [];
    
    for (let i = 2; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      
      const monthLogs = await AttendanceLog.find({
        user: { $in: userIds },
        attendanceDate: { 
          $gte: monthStart.toISOString().slice(0, 10),
          $lte: monthEnd.toISOString().slice(0, 10)
        }
      }).populate('user', 'fullName email department').lean();
      
      const monthMetrics = {
        month: monthStart.toLocaleDateString('en-US', { month: 'short' }),
        onTime: monthLogs.filter(log => log.attendanceStatus === 'On-time').length,
        late: monthLogs.filter(log => log.attendanceStatus === 'Late').length,
        halfDay: monthLogs.filter(log => log.attendanceStatus === 'Half-day').length,
        absent: monthLogs.filter(log => log.attendanceStatus === 'Absent').length
      };
      
      monthlyData.push(monthMetrics);
    }
    
    console.log('Monthly overview data:', monthlyData);
    res.json({ monthlyData });

  } catch (error) {
    console.error('Error fetching monthly overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/overview - Get today's overview for dashboard cards
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    const { date } = req.query;
    
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const targetDate = date || new Date().toISOString().slice(0, 10);
    
    // Get all active users
    const users = await User.find({ isActive: true }).lean();
    const userIds = users.map(user => user._id);
    
    // Get today's attendance logs
    const todayLogs = await AttendanceLog.find({
      user: { $in: userIds },
      attendanceDate: targetDate
    }).populate('user', 'fullName email department').lean();
    
    // Calculate overview metrics
    const totalEmployees = users.length;
    const presentEmployees = todayLogs.length;
    const lateEmployees = todayLogs.filter(log => log.isLate).length;
    const halfDayEmployees = todayLogs.filter(log => log.isHalfDay).length;
    const absentEmployees = totalEmployees - presentEmployees;
    
    console.log('Analytics overview calculation:', {
      targetDate,
      totalEmployees,
      presentEmployees,
      lateEmployees,
      halfDayEmployees,
      absentEmployees,
      todayLogsCount: todayLogs.length
    });
    
    // Get detailed lists for clickable cards
    const lateEmployeesList = todayLogs
      .filter(log => log.isLate)
      .map(log => ({
        id: log.user._id,
        name: log.user.fullName,
        email: log.user.email,
        department: log.user.department,
        loginTime: log.clockInTime,
        lateMinutes: log.lateMinutes,
        status: log.attendanceStatus
      }));
    
    const halfDayEmployeesList = todayLogs
      .filter(log => log.isHalfDay)
      .map(log => ({
        id: log.user._id,
        name: log.user.fullName,
        email: log.user.email,
        department: log.user.department,
        loginTime: log.clockInTime,
        lateMinutes: log.lateMinutes,
        status: log.attendanceStatus
      }));
    
    const absentEmployeesList = users
      .filter(user => !todayLogs.some(log => log.user._id.toString() === user._id.toString()))
      .map(user => ({
        id: user._id,
        name: user.fullName,
        email: user.email,
        department: user.department,
        status: 'Absent'
      }));
    
    // Present employees include ALL who have attendance logs (on-time, late, half-day)
    const presentEmployeesList = todayLogs
      .map(log => ({
        id: log.user._id,
        name: log.user.fullName,
        email: log.user.email,
        department: log.user.department,
        loginTime: log.clockInTime,
        lateMinutes: log.lateMinutes || 0,
        status: log.attendanceStatus || 'Present'
      }));

    const responseData = {
      date: targetDate,
      overview: {
        totalEmployees,
        presentEmployees,
        lateEmployees,
        halfDayEmployees,
        absentEmployees
      },
      details: {
        lateEmployees: lateEmployeesList,
        halfDayEmployees: halfDayEmployeesList,
        absentEmployees: absentEmployeesList,
        presentEmployees: presentEmployeesList
      }
    };
    
    console.log('Analytics overview response:', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error fetching overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/employee/:id - Get analytics for specific employee
router.get('/employee/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user;
    const { startDate, endDate } = req.query;

    // Check permissions
    if (role !== 'Admin' && role !== 'HR' && userId !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid employee ID' });
    }
    
    console.log('Analytics request for user ID:', id);

    const user = await User.findById(id).populate('shiftGroup');
    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Default to last 3 months if no dates provided to get more data
    // Use IST timezone for consistent date calculations
    const now = new Date();
    const nowIST = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const defaultStartDate = new Date(nowIST.getFullYear(), nowIST.getMonth() - 3, 1).toISOString().slice(0, 10);
    const defaultEndDate = new Date(nowIST.getFullYear(), nowIST.getMonth() + 1, 0).toISOString().slice(0, 10);
    
    const start = startDate || defaultStartDate;
    const end = endDate || defaultEndDate;
    
    console.log(`Fetching analytics for user ${id} from ${start} to ${end}`);
    
    // Debug: Log the date range and timezone info
    console.log('Analytics API - Date info:', {
      serverTime: now.toISOString(),
      serverTimeIST: nowIST.toISOString(),
      startDate: start,
      endDate: end,
      startDateObj: new Date(start),
      endDateObj: new Date(end)
    });

    // Get attendance logs with analytics data (including sessions and breaks)
    let logs = [];
    try {
      logs = await AttendanceLog.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(id), attendanceDate: { $gte: start, $lte: end } } },
        { $lookup: { from: 'attendancesessions', localField: '_id', foreignField: 'attendanceLog', as: 'sessions' } },
        { $lookup: { from: 'breaklogs', localField: '_id', foreignField: 'attendanceLog', as: 'breaks' } },
        { $sort: { attendanceDate: -1 } }
      ]);
      
      console.log(`Found ${logs.length} attendance logs for user ${id}`);
      console.log('Log dates:', logs.map(log => ({
        date: log.attendanceDate,
        hasSessions: log.sessions && log.sessions.length > 0,
        hasBreaks: log.breaks && log.breaks.length > 0,
        clockInTime: log.clockInTime,
        clockOutTime: log.clockOutTime
      })));
    } catch (aggregationError) {
      console.error('Aggregation error details:', {
        error: aggregationError.message,
        stack: aggregationError.stack,
        employeeId: id,
        dateRange: { start, end }
      });
      // Fallback to simple find query if aggregation fails
      try {
        logs = await AttendanceLog.find({
          user: id,
          attendanceDate: { $gte: start, $lte: end }
        }).sort({ attendanceDate: -1 });
        console.log(`Fallback: Found ${logs.length} attendance logs for user ${id}`);
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError);
        throw new Error(`Failed to fetch attendance logs: ${fallbackError.message}`);
      }
    }

    // Fetch the monthly context setting
    let monthlyContextDays = 30;
    try {
      const contextSetting = await Setting.findOne({ key: 'monthlyContextDays' });
      monthlyContextDays = contextSetting ? parseInt(contextSetting.value) : 30;
      console.log(`Using monthlyContextDays: ${monthlyContextDays}`);
    } catch (settingError) {
      console.error('Setting query error:', {
        error: settingError.message,
        stack: settingError.stack
      });
      // Use default value
      monthlyContextDays = 30;
    }

    // Calculate metrics
    let metrics;
    try {
      metrics = await calculateAnalyticsMetrics(id, start, end, monthlyContextDays);
      console.log('Calculated metrics successfully:', {
        totalDays: metrics.totalDays,
        onTimeDays: metrics.onTimeDays,
        totalWorkingHours: metrics.totalWorkingHours
      });
    } catch (metricsError) {
      console.error('Error calculating metrics:', {
        error: metricsError.message,
        stack: metricsError.stack,
        employeeId: id,
        dateRange: { start, end },
        monthlyContextDays
      });
      // Return default metrics if calculation fails
      metrics = {
        totalDays: 0,
        onTimeDays: 0,
        presentDays: 0,
        lateDays: 0,
        halfDays: 0,
        absentDays: 0,
        totalWorkingHours: 0,
        averageWorkingHours: 0,
        completedDays: 0,
        totalLeaveDays: 0,
        leaveRequests: 0,
        totalLeaveDaysYTD: 0,
        leaveRequestsYTD: 0,
        totalLeaveDaysAllTime: 0,
        leaveRequestsAllTime: 0
      };
    }
    
    // Calculate actual working hours from attendance sessions if not available
    if (metrics.totalWorkingHours === 0 && metrics.totalDays > 0) {
      console.log('Calculating working hours from attendance sessions for user:', id);
      
      try {
        let totalCalculatedHours = 0;
        let daysWithSessions = 0;
      
      for (const log of logs) {
        // Use sessions data if available, otherwise fall back to clockInTime/clockOutTime
        let workingHours = 0;
        
        if (log.sessions && log.sessions.length > 0) {
          // Calculate from sessions
          let totalSessionMinutes = 0;
          for (const session of log.sessions) {
            if (session.startTime && session.endTime) {
              const sessionMinutes = (new Date(session.endTime) - new Date(session.startTime)) / (1000 * 60);
              totalSessionMinutes += sessionMinutes;
            }
          }
          workingHours = totalSessionMinutes / 60;
        } else if (log.clockInTime && log.clockOutTime) {
          // Fallback to clock-in/out times
          const workingMinutes = (new Date(log.clockOutTime) - new Date(log.clockInTime)) / (1000 * 60);
          workingHours = workingMinutes / 60;
        }
        
        if (workingHours > 0) {
          // Calculate break time from breaks array
          let totalBreakMinutes = 0;
          if (log.breaks && log.breaks.length > 0) {
            for (const breakItem of log.breaks) {
              if (breakItem.startTime && breakItem.endTime) {
                const breakMinutes = (new Date(breakItem.endTime) - new Date(breakItem.startTime)) / (1000 * 60);
                totalBreakMinutes += breakMinutes;
              }
            }
          } else {
            // Fallback to stored break minutes
            totalBreakMinutes = (log.paidBreakMinutesTaken || 0) + (log.unpaidBreakMinutesTaken || 0);
          }
          
          const netWorkingHours = Math.max(0, workingHours - (totalBreakMinutes / 60));
          
          totalCalculatedHours += netWorkingHours;
          daysWithSessions++;
          
          // Update the log with calculated working hours
          await AttendanceLog.findByIdAndUpdate(log._id, {
            totalWorkingHours: netWorkingHours
          });
        }
      }
      
        if (daysWithSessions > 0) {
          metrics.totalWorkingHours = totalCalculatedHours;
          metrics.averageWorkingHours = totalCalculatedHours / daysWithSessions;
          metrics.completedDays = daysWithSessions;
          console.log(`Calculated working hours for user ${id}: ${totalCalculatedHours.toFixed(2)}h total, ${(totalCalculatedHours / daysWithSessions).toFixed(2)}h average`);
        }
      } catch (workingHoursError) {
        console.error('Error calculating working hours:', workingHoursError);
        // Continue with existing metrics
      }
    }
    
    // Debug logging
    console.log(`Analytics for user ${id}:`, {
      totalDays: metrics.totalDays,
      totalWorkingHours: metrics.totalWorkingHours,
      averageWorkingHours: metrics.averageWorkingHours,
      completedDays: metrics.completedDays,
      incompleteDays: metrics.incompleteDays,
      logsWithWorkingHours: logs.filter(log => log.totalWorkingHours > 0).length
    });
    
    // Additional debug: Log all attendance logs with their working hours
    console.log('All attendance logs for user:', logs.map(log => ({
      date: log.attendanceDate,
      clockInTime: log.clockInTime,
      clockOutTime: log.clockOutTime,
      totalWorkingHours: log.totalWorkingHours,
      attendanceStatus: log.attendanceStatus
    })));

    // Get detailed logs with sessions and breaks
    const detailedLogs = await Promise.all(logs.map(async (log) => {
      // If log already has sessions and breaks from aggregation, use them
      // Otherwise, fetch them separately
      let sessions = log.sessions || [];
      let breaks = log.breaks || [];
      
      // If not populated by aggregation, fetch separately
      if (!log.sessions || log.sessions.length === 0) {
        sessions = await AttendanceSession.find({ attendanceLog: log._id }).sort({ startTime: 1 });
      }
      if (!log.breaks || log.breaks.length === 0) {
        breaks = await BreakLog.find({ attendanceLog: log._id }).sort({ startTime: 1 });
      }
      
      // Convert to plain object if it's a Mongoose document
      const logObject = log.toObject ? log.toObject() : { ...log };
      
      return {
        ...logObject,
        sessions,
        breaks
      };
    }));

    // Calculate weekly and monthly trends for charts
    const weeklyData = [];
    const monthlyData = [];
    
    // Generate weekly data for the last 8 weeks
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + (i * 7)));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      const weekLogs = await AttendanceLog.find({
        user: id,
        attendanceDate: { 
          $gte: weekStart.toISOString().slice(0, 10),
          $lte: weekEnd.toISOString().slice(0, 10)
        }
      });
      
      const weekMetrics = {
        week: `Week ${8-i}`,
        onTime: weekLogs.filter(log => log.attendanceStatus === 'On-time').length,
        late: weekLogs.filter(log => log.attendanceStatus === 'Late').length,
        halfDay: weekLogs.filter(log => log.attendanceStatus === 'Half-day').length,
        absent: weekLogs.filter(log => log.attendanceStatus === 'Absent').length,
        avgWorkingHours: weekLogs.length > 0 ? 
          (weekLogs.reduce((sum, log) => sum + (log.totalWorkingHours || 0), 0) / weekLogs.length) : 0
      };
      
      weeklyData.push(weekMetrics);
    }
    
    // Generate monthly data for the last 6 months
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      
      const monthLogs = await AttendanceLog.find({
        user: id,
        attendanceDate: { 
          $gte: monthStart.toISOString().slice(0, 10),
          $lte: monthEnd.toISOString().slice(0, 10)
        }
      });
      
      const monthMetrics = {
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        onTime: monthLogs.filter(log => log.attendanceStatus === 'On-time').length,
        late: monthLogs.filter(log => log.attendanceStatus === 'Late').length,
        halfDay: monthLogs.filter(log => log.attendanceStatus === 'Half-day').length,
        absent: monthLogs.filter(log => log.attendanceStatus === 'Absent').length,
        avgWorkingHours: monthLogs.length > 0 ? 
          (monthLogs.reduce((sum, log) => sum + (log.totalWorkingHours || 0), 0) / monthLogs.length) : 0
      };
      
      monthlyData.push(monthMetrics);
    }

    res.json({
      employee: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        department: user.department,
        designation: user.designation
      },
      period: { start, end },
      metrics,
      logs: detailedLogs,
      charts: {
        weekly: weeklyData,
        monthly: monthlyData
      }
    });

  } catch (error) {
    console.error('Error fetching employee analytics:', {
      error: error.message,
      stack: error.stack,
      employeeId: req.params.id,
      query: req.query
    });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/analytics/all - Get analytics for all employees (Admin/HR only)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    const { startDate, endDate, department, employeeId } = req.query;

    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    
    const start = startDate || defaultStartDate;
    const end = endDate || defaultEndDate;

    // --- START OF FIX ---
    // Fetch the monthly context setting before processing employees
    const contextSetting = await Setting.findOne({ key: 'monthlyContextDays' });
    const monthlyContextDays = contextSetting ? contextSetting.value : 30; // Default to 30 if not set
    // --- END OF FIX ---

    // Build query for users
    let userQuery = { isActive: true };
    if (department) userQuery.department = department;
    if (employeeId) userQuery._id = employeeId;

    const users = await User.find(userQuery).populate('shiftGroup');
    
    // Get analytics for each user
    const employeeAnalytics = await Promise.all(users.map(async (user) => {
      // Pass the fetched setting to the metrics calculator
      const metrics = await calculateAnalyticsMetrics(user._id, start, end, monthlyContextDays);
      
      // Calculate actual working hours from attendance sessions if not available
      if (metrics.totalWorkingHours === 0 && metrics.totalDays > 0) {
        console.log(`Calculating working hours from attendance sessions for user: ${user.fullName}`);
        
        // Get attendance logs for this user
        const userLogs = await AttendanceLog.find({
          user: user._id,
          attendanceDate: { $gte: start, $lte: end }
        }).sort({ attendanceDate: -1 });
        
        let totalCalculatedHours = 0;
        let daysWithSessions = 0;
        
        for (const log of userLogs) {
          if (log.clockInTime && log.clockOutTime) {
            // Calculate working hours from clock-in to clock-out
            const workingMinutes = (new Date(log.clockOutTime) - new Date(log.clockInTime)) / (1000 * 60);
            const workingHours = workingMinutes / 60;
            
            // Subtract break time if available
            const breakMinutes = (log.paidBreakMinutesTaken || 0) + (log.unpaidBreakMinutesTaken || 0);
            const netWorkingHours = Math.max(0, workingHours - (breakMinutes / 60));
            
            totalCalculatedHours += netWorkingHours;
            daysWithSessions++;
            
            // Update the log with calculated working hours
            await AttendanceLog.findByIdAndUpdate(log._id, {
              totalWorkingHours: netWorkingHours
            });
          }
        }
        
        if (daysWithSessions > 0) {
          metrics.totalWorkingHours = totalCalculatedHours;
          metrics.averageWorkingHours = totalCalculatedHours / daysWithSessions;
          metrics.completedDays = daysWithSessions;
          console.log(`Calculated working hours for user ${user.fullName}: ${totalCalculatedHours.toFixed(2)}h total, ${(totalCalculatedHours / daysWithSessions).toFixed(2)}h average`);
        }
      }
      
      // Get recent logs for this user
      const recentLogs = await AttendanceLog.find({
        user: user._id,
        attendanceDate: { $gte: start, $lte: end }
      }).sort({ attendanceDate: -1 }).limit(5);

      return {
        employee: {
          id: user._id,
          name: user.fullName,
          email: user.email,
          department: user.department,
          designation: user.designation
        },
        metrics,
        recentLogs
      };
    }));

    // Calculate overall statistics
    const overallStats = {
      totalEmployees: employeeAnalytics.length,
      totalOnTimeDays: employeeAnalytics.reduce((sum, emp) => sum + emp.metrics.onTimeDays, 0),
      totalLateDays: employeeAnalytics.reduce((sum, emp) => sum + emp.metrics.lateDays, 0),
      totalHalfDays: employeeAnalytics.reduce((sum, emp) => sum + emp.metrics.halfDays, 0),
      totalAbsentDays: employeeAnalytics.reduce((sum, emp) => sum + emp.metrics.absentDays, 0),
      averageWorkingHours: employeeAnalytics.length > 0 
        ? employeeAnalytics.reduce((sum, emp) => sum + emp.metrics.averageWorkingHours, 0) / employeeAnalytics.length 
        : 0
    };

    res.json({
      period: { start, end },
      filters: { department, employeeId },
      overallStats,
      employees: employeeAnalytics
    });

  } catch (error) {
    console.error('Error fetching all analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/analytics - Create/update analytics entry (Admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userId, attendanceDate, isLate, isHalfDay, lateMinutes, attendanceStatus, notes } = req.body;

    if (!userId || !attendanceDate) {
      return res.status(400).json({ error: 'User ID and attendance date are required' });
    }

    // Find or create attendance log
    let attendanceLog = await AttendanceLog.findOne({ user: userId, attendanceDate });
    
    if (!attendanceLog) {
      const user = await User.findById(userId).populate('shiftGroup');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      attendanceLog = await AttendanceLog.create({
        user: userId,
        attendanceDate,
        clockInTime: new Date(),
        shiftDurationMinutes: user.shiftGroup?.durationHours * 60 || 480,
        penaltyMinutes: 0,
        paidBreakMinutesTaken: 0,
        unpaidBreakMinutesTaken: 0,
        isLate: isLate || false,
        isHalfDay: isHalfDay || false,
        lateMinutes: lateMinutes || 0,
        attendanceStatus: attendanceStatus || 'On-time',
        notes: notes || ''
      });
    } else {
      // Update existing log
      const updateData = {};
      if (isLate !== undefined) updateData.isLate = isLate;
      if (isHalfDay !== undefined) updateData.isHalfDay = isHalfDay;
      if (lateMinutes !== undefined) updateData.lateMinutes = lateMinutes;
      if (attendanceStatus) updateData.attendanceStatus = attendanceStatus;
      if (notes !== undefined) updateData.notes = notes;

      // Recalculate total working hours if clock-in/out times exist
      if (attendanceLog.clockInTime && attendanceLog.clockOutTime) {
        const workingMinutes = (new Date(attendanceLog.clockOutTime) - new Date(attendanceLog.clockInTime)) / (1000 * 60);
        const totalBreakMinutes = (attendanceLog.paidBreakMinutesTaken || 0) + (attendanceLog.unpaidBreakMinutesTaken || 0);
        const netWorkingMinutes = Math.max(0, workingMinutes - totalBreakMinutes);
        updateData.totalWorkingHours = netWorkingMinutes / 60;
      }

      attendanceLog = await AttendanceLog.findByIdAndUpdate(
        attendanceLog._id,
        updateData,
        { new: true }
      );
    }

    // Emit Socket.IO event to notify all clients about the attendance log update
    try {
      const { getIO } = require('../socketManager');
      const io = getIO();
      if (io) {
        io.emit('attendance_log_updated', {
          logId: attendanceLog._id,
          userId: attendanceLog.user,
          attendanceDate: attendanceLog.attendanceDate,
          attendanceStatus: attendanceLog.attendanceStatus,
          isHalfDay: attendanceLog.isHalfDay,
          isLate: attendanceLog.isLate,
          totalWorkingHours: attendanceLog.totalWorkingHours,
          clockInTime: attendanceLog.clockInTime,
          clockOutTime: attendanceLog.clockOutTime,
          updatedBy: req.user.userId,
          timestamp: new Date().toISOString(),
          message: `Analytics entry updated - Working hours: ${attendanceLog.totalWorkingHours.toFixed(2)}h`
        });
        console.log(`📡 Emitted attendance_log_updated event for analytics update ${attendanceLog._id}`);
      }
    } catch (socketError) {
      console.error('Failed to emit Socket.IO event:', socketError);
    }

    res.status(201).json({ message: 'Analytics entry updated successfully', attendanceLog });

  } catch (error) {
    console.error('Error creating/updating analytics entry:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/monthly-context-settings - Get monthly context settings
router.get('/monthly-context-settings', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const setting = await Setting.findOne({ key: 'monthlyContextDays' });
    const days = setting ? setting.value : 30; // Default to 30 days

    res.json({ days });
  } catch (error) {
    console.error('Error fetching monthly context settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/late-grace-settings - Get late grace minutes setting
router.get('/late-grace-settings', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const setting = await Setting.findOne({ key: 'lateGraceMinutes' });
    const minutes = setting ? Number(setting.value) : 30; // default 30
    res.json({ minutes });
  } catch (error) {
    console.error('Error fetching late grace settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/analytics/late-grace-settings - Update late grace minutes setting
router.put('/late-grace-settings', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { minutes } = req.body;
    const numeric = Number(minutes);
    if (isNaN(numeric) || numeric < 0 || numeric > 1440) {
      return res.status(400).json({ error: 'Minutes must be a valid number between 0 and 1440' });
    }

    const setting = await Setting.findOneAndUpdate(
      { key: 'lateGraceMinutes' },
      { value: numeric },
      { upsert: true, new: true }
    );

    res.json({ minutes: setting.value });
  } catch (error) {
    console.error('Error updating late grace settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/analytics/monthly-context-settings - Update monthly context settings
router.put('/monthly-context-settings', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { days } = req.body;

    if (!days || typeof days !== 'number' || days < 1 || days > 365) {
      return res.status(400).json({ error: 'Days must be a number between 1 and 365' });
    }

    // Update or create the setting
    const setting = await Setting.findOneAndUpdate(
      { key: 'monthlyContextDays' },
      { value: days },
      { upsert: true, new: true }
    );

    res.json({ days: setting.value });
  } catch (error) {
    console.error('Error updating monthly context settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/analytics/:id - Update analytics record with admin override
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { 
      isLate, 
      isHalfDay, 
      lateMinutes, 
      attendanceStatus, 
      notes, 
      adminOverride, 
      overrideReason 
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid analytics record ID' });
    }

    const updateData = {};
    if (isLate !== undefined) updateData.isLate = isLate;
    if (isHalfDay !== undefined) updateData.isHalfDay = isHalfDay;
    if (lateMinutes !== undefined) updateData.lateMinutes = lateMinutes;
    if (attendanceStatus) updateData.attendanceStatus = attendanceStatus;
    if (notes !== undefined) updateData.notes = notes;
    if (adminOverride) updateData.adminOverride = adminOverride;
    if (overrideReason !== undefined) updateData.overrideReason = overrideReason;

    // Handle admin overrides
    if (adminOverride === 'Override Half Day') {
      updateData.isHalfDay = false;
      updateData.attendanceStatus = isLate ? 'Late' : 'On-time';
    } else if (adminOverride === 'Override Late') {
      updateData.isLate = false;
      updateData.lateMinutes = 0;
      updateData.attendanceStatus = 'On-time';
    }

    // Get the current log to check for working hours recalculation
    const currentLog = await AttendanceLog.findById(id);
    if (!currentLog) {
      return res.status(404).json({ error: 'Analytics record not found' });
    }

    // Recalculate total working hours if clock-in/out times exist
    if (currentLog.clockInTime && currentLog.clockOutTime) {
      const workingMinutes = (new Date(currentLog.clockOutTime) - new Date(currentLog.clockInTime)) / (1000 * 60);
      const totalBreakMinutes = (currentLog.paidBreakMinutesTaken || 0) + (currentLog.unpaidBreakMinutesTaken || 0);
      const netWorkingMinutes = Math.max(0, workingMinutes - totalBreakMinutes);
      updateData.totalWorkingHours = netWorkingMinutes / 60;
    }

    const attendanceLog = await AttendanceLog.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('user', 'fullName email');

    // Emit Socket.IO event to notify all clients about the attendance log update
    try {
      const { getIO } = require('../socketManager');
      const io = getIO();
      if (io) {
        io.emit('attendance_log_updated', {
          logId: attendanceLog._id,
          userId: attendanceLog.user,
          attendanceDate: attendanceLog.attendanceDate,
          attendanceStatus: attendanceLog.attendanceStatus,
          isHalfDay: attendanceLog.isHalfDay,
          isLate: attendanceLog.isLate,
          totalWorkingHours: attendanceLog.totalWorkingHours,
          clockInTime: attendanceLog.clockInTime,
          clockOutTime: attendanceLog.clockOutTime,
          updatedBy: req.user.userId,
          timestamp: new Date().toISOString(),
          message: `Analytics record updated - Working hours: ${attendanceLog.totalWorkingHours.toFixed(2)}h`
        });
        console.log(`📡 Emitted attendance_log_updated event for analytics record update ${attendanceLog._id}`);
      }
    } catch (socketError) {
      console.error('Failed to emit Socket.IO event:', socketError);
    }

    res.json({ 
      message: 'Analytics record updated successfully', 
      attendanceLog,
      overrideApplied: adminOverride !== 'None'
    });

  } catch (error) {
    console.error('Error updating analytics record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/analytics/:id - Delete analytics record
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid analytics record ID' });
    }

    const attendanceLog = await AttendanceLog.findByIdAndDelete(id);

    if (!attendanceLog) {
      return res.status(404).json({ error: 'Analytics record not found' });
    }

    res.json({ message: 'Analytics record deleted successfully' });

  } catch (error) {
    console.error('Error deleting analytics record:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/export - Export analytics to Excel/CSV
router.get('/export', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    const { startDate, endDate, format = 'csv' } = req.query;

    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Default to current month if no dates provided
    const now = new Date();
    const defaultStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const defaultEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    
    const start = startDate || defaultStartDate;
    const end = endDate || defaultEndDate;

    // Get all attendance logs in the date range
    const logs = await AttendanceLog.find({
      attendanceDate: { $gte: start, $lte: end }
    }).populate('user', 'fullName email department designation');

    if (format === 'csv') {
      // Generate CSV
      const csvHeader = 'Date,Employee Name,Email,Department,Designation,Login Time,Status,Late Minutes,Working Hours,Notes\n';
      const csvRows = logs.map(log => {
        const loginTime = log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '';
        return `${log.attendanceDate},"${log.user.fullName}","${log.user.email}","${log.user.department || ''}","${log.user.designation || ''}","${loginTime}","${log.attendanceStatus}",${log.lateMinutes || 0},${log.totalWorkingHours || 0},"${log.notes || ''}"`;
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${start}-to-${end}.csv"`);
      res.send(csvHeader + csvRows);
    } else {
      // Return JSON for Excel generation
      res.json({
        period: { start, end },
        data: logs.map(log => ({
          date: log.attendanceDate,
          employeeName: log.user.fullName,
          email: log.user.email,
          department: log.user.department || '',
          designation: log.user.designation || '',
          loginTime: log.clockInTime ? new Date(log.clockInTime).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
          status: log.attendanceStatus,
          lateMinutes: log.lateMinutes || 0,
          workingHours: log.totalWorkingHours || 0,
          notes: log.notes || ''
        }))
      });
    }

  } catch (error) {
    console.error('Error exporting analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/employee-features - Get employee features settings
router.get('/employee-features', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin' && role !== 'HR') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // For now, return default features. In production, this would come from a database
    const defaultFeatures = [
      { id: 1, name: 'Attendance Tracking', description: 'Track daily attendance', enabled: true },
      { id: 2, name: 'Leave Management', description: 'Manage leave requests', enabled: true },
      { id: 3, name: 'Performance Analytics', description: 'View performance metrics', enabled: true },
      { id: 4, name: 'Time Tracking', description: 'Track working hours', enabled: false }
    ];

    res.json(defaultFeatures);

  } catch (error) {
    console.error('Error fetching employee features:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/analytics/employee-features - Add new employee feature
router.post('/employee-features', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, description, enabled } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    // For now, generate a simple ID. In production, this would be saved to database
    const newFeature = {
      id: Date.now(), // Simple ID generation
      name,
      description,
      enabled: enabled !== undefined ? enabled : true
    };

    res.status(201).json(newFeature);

  } catch (error) {
    console.error('Error adding employee feature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/analytics/employee-features/:id - Update employee feature
router.put('/employee-features/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;
    const { name, description, enabled } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Feature ID is required' });
    }

    // For now, just return success. In production, this would update the database
    const updatedFeature = {
      id: parseInt(id),
      name: name || 'Updated Feature',
      description: description || 'Updated description',
      enabled: enabled !== undefined ? enabled : true
    };

    res.json(updatedFeature);

  } catch (error) {
    console.error('Error updating employee feature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/analytics/employee-features/:id - Delete employee feature
router.delete('/employee-features/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'Admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Feature ID is required' });
    }

    // For now, just return success. In production, this would delete from database
    res.json({ message: 'Feature deleted successfully', id: parseInt(id) });

  } catch (error) {
    console.error('Error deleting employee feature:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;