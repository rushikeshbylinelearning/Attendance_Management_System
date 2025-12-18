// backend/services/weeklyLateTrackingService.js

const WeeklyLateTracking = require('../models/WeeklyLateTracking');

/**
 * Get the start and end dates of the current week (Monday to Sunday)
 */
const getCurrentWeekDates = () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Handle Sunday as start of week
  
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  return {
    startDate: weekStart.toISOString().slice(0, 10),
    endDate: weekEnd.toISOString().slice(0, 10)
  };
};

/**
 * Track a late login for a user
 */
const trackLateLogin = async (userId, attendanceDate) => {
  try {
    const weekDates = getCurrentWeekDates();
    
    // Find or create weekly tracking record
    let trackingRecord = await WeeklyLateTracking.findOne({
      user: userId,
      weekStartDate: weekDates.startDate
    });
    
    if (!trackingRecord) {
      trackingRecord = new WeeklyLateTracking({
        user: userId,
        weekStartDate: weekDates.startDate,
        weekEndDate: weekDates.endDate,
        lateCount: 0,
        lateDates: []
      });
    }
    
    // Check if this date is already tracked
    if (!trackingRecord.lateDates.includes(attendanceDate)) {
      trackingRecord.lateCount += 1;
      trackingRecord.lateDates.push(attendanceDate);
      
        // Previously the system locked user accounts on the 4th late login.
        // Policy change (2025): Do NOT lock user accounts automatically for repeated late logins.
        // Instead, we only track the lateCount and let higher-level processes (email/hr) handle notifications.
        // No automatic call to lockUserAccount here.
      
      await trackingRecord.save();
    }
    
    return trackingRecord;
  } catch (error) {
    console.error('Error tracking late login:', error);
    throw error;
  }
};

/**
 * Get weekly late statistics for a user
 */
const getWeeklyLateStats = async (userId) => {
  try {
    const weekDates = getCurrentWeekDates();
    const trackingRecord = await WeeklyLateTracking.findOne({
      user: userId,
      weekStartDate: weekDates.startDate
    });
    
    return {
      currentWeekLateCount: trackingRecord?.lateCount || 0,
      lateDates: trackingRecord?.lateDates || [],
      remainingLateLogins: Math.max(0, 3 - (trackingRecord?.lateCount || 0))
    };
  } catch (error) {
    console.error('Error getting weekly late stats:', error);
    return {
      currentWeekLateCount: 0,
      lateDates: [],
      remainingLateLogins: 3
    };
  }
};

module.exports = {
  trackLateLogin,
  getWeeklyLateStats,
  getCurrentWeekDates
};

