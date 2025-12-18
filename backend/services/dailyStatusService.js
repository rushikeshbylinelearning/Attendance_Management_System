// backend/services/dailyStatusService.js
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceSession = require('../models/AttendanceSession');
const BreakLog = require('../models/BreakLog');
const ExtraBreakRequest = require('../models/ExtraBreakRequest');

const DEFAULT_OPTIONS = {
    includeSessions: true,
    includeBreaks: true,
    includeRequests: true,
    includeAutoBreak: true,
};

const getShiftDateTimeIST = (onDate, shiftTime) => {
    const [hours, minutes] = shiftTime.split(':').map(Number);
    const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const [{ value: year }, , { value: month }, , { value: day }] = istDateFormatter.formatToParts(onDate);
    const shiftDateTimeISO_IST = `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000+05:30`;
    return new Date(shiftDateTimeISO_IST);
};

const buildBaseResponse = (options) => ({
    status: 'Not Clocked In',
    sessions: options.includeSessions ? [] : undefined,
    breaks: options.includeBreaks ? [] : undefined,
    shift: null,
    attendanceLog: null,
    calculatedLogoutTime: null,
    pendingExtraBreakRequest: options.includeRequests ? null : undefined,
    approvedExtraBreak: options.includeRequests ? null : undefined,
    autoBreak: options.includeAutoBreak ? null : undefined,
    activeBreak: options.includeBreaks ? null : undefined,
});

const mapAttendanceLog = (attendanceLog) => ({
    penaltyMinutes: attendanceLog?.penaltyMinutes || 0,
    paidBreakMinutesTaken: attendanceLog?.paidBreakMinutesTaken || 0,
    unpaidBreakMinutesTaken: attendanceLog?.unpaidBreakMinutesTaken || 0,
    isLate: attendanceLog?.isLate || false,
    lateMinutes: attendanceLog?.lateMinutes || 0,
    attendanceStatus: attendanceLog?.attendanceStatus || 'On-time',
    isHalfDay: attendanceLog?.isHalfDay || false,
});

const mapAutoBreak = (autoBreakDoc) => autoBreakDoc ? ({
    id: autoBreakDoc._id,
    startTime: autoBreakDoc.startTime,
    type: autoBreakDoc.type,
    reason: autoBreakDoc.reason,
    duration: Math.floor((Date.now() - new Date(autoBreakDoc.startTime)) / (1000 * 60)),
}) : null;

const mapActiveBreak = (breakDoc) => breakDoc ? ({
    startTime: breakDoc.startTime,
    breakType: breakDoc.breakType,
    durationMinutes: Math.floor((Date.now() - new Date(breakDoc.startTime)) / (1000 * 60)),
}) : null;

const computeCalculatedLogoutTime = (sessions, breaks, attendanceLog, userShift, activeBreak = null) => {
    if (!sessions?.length || !userShift || !attendanceLog) {
        return null;
    }

    const firstClockInSession = sessions[0];
    const clockInTime = new Date(firstClockInSession.startTime);
    
    // Constants for shift calculation
    // Use the shift's paidBreakMinutes if available, otherwise default to 30 minutes
    const EXPECTED_BREAK_MINUTES = userShift.paidBreakMinutes || 30;
    const SHIFT_TOTAL_MINUTES = 9 * 60; // 540 minutes (9 hours total shift duration)

    // Helper function to set time on a date (in IST)
    const setTime = (date, timeString) => {
        const [hours, minutes] = timeString.split(':').map(Number);
        return getShiftDateTimeIST(date, timeString);
    };

    // Helper function to add minutes to a date
    const addMinutes = (date, minutes) => {
        const newDate = new Date(date);
        newDate.setMinutes(newDate.getMinutes() + minutes);
        return newDate;
    };

    // Helper function to calculate minutes between two dates
    const minutesBetween = (start, end) => {
        return Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
    };

    // Get total paid break minutes taken (from stored value, which includes all paid breaks)
    // This is more accurate than calculating from individual break objects because:
    // 1. It accounts for multiple paid breaks correctly
    // 2. It matches what's actually stored in the database
    // 3. It handles the case where break allowance is exceeded correctly
    const totalPaidBreakMinutes = attendanceLog.paidBreakMinutesTaken || 0;
    const hasTakenPaidBreak = totalPaidBreakMinutes > 0;

    // Calculate unpaid break minutes (Unpaid and Extra breaks extend the shift)
    const unpaidBreakMinutes = attendanceLog.unpaidBreakMinutesTaken || 0;
    let activeUnpaidBreakMinutes = 0;
    if (activeBreak && (activeBreak.breakType === 'Unpaid' || activeBreak.breakType === 'Extra') && activeBreak.startTime) {
        const now = new Date();
        const activeBreakDurationMs = now.getTime() - new Date(activeBreak.startTime).getTime();
        activeUnpaidBreakMinutes = Math.floor(activeBreakDurationMs / (1000 * 60));
    }
    const totalUnpaidBreakMinutes = unpaidBreakMinutes + activeUnpaidBreakMinutes;

    // SPECIAL CASE: 10 AM - 7 PM shift
    if (userShift.shiftType === 'Fixed' && userShift.startTime === '10:00' && userShift.endTime === '19:00') {
        const tenAM = setTime(clockInTime, '10:00');
        
        // If clock-in is before 10:00 AM, required logout is always 7:00 PM
        if (clockInTime < tenAM) {
            const sevenPM = setTime(clockInTime, '19:00');
            // Unpaid breaks still extend the shift
            if (totalUnpaidBreakMinutes > 0) {
                return addMinutes(sevenPM, totalUnpaidBreakMinutes).toISOString();
            }
            return sevenPM.toISOString();
        }
        
        // If clock-in is at or after 10:00 AM, use normal 9-hour logic
        // If break not taken yet → no break deduction
        if (!hasTakenPaidBreak) {
            const baseLogout = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES);
            // Add unpaid break extension
            if (totalUnpaidBreakMinutes > 0) {
                return addMinutes(baseLogout, totalUnpaidBreakMinutes).toISOString();
            }
            return baseLogout.toISOString();
        }
        
        // Break taken → adjust logout based on actual total paid break minutes taken
        const savedBreak = EXPECTED_BREAK_MINUTES - totalPaidBreakMinutes; // positive = saved, negative = extra
        
        const baseLogout = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES - savedBreak);
        // Add unpaid break extension
        if (totalUnpaidBreakMinutes > 0) {
            return addMinutes(baseLogout, totalUnpaidBreakMinutes).toISOString();
        }
        return baseLogout.toISOString();
    }

    // GENERAL RULE for all other shifts
    // For Fixed shifts
    if (userShift.shiftType === 'Fixed' && userShift.startTime && userShift.endTime) {
        const shiftStartTime = getShiftDateTimeIST(clockInTime, userShift.startTime);
        const shiftEndTime = getShiftDateTimeIST(clockInTime, userShift.endTime);
        if (shiftEndTime < shiftStartTime) {
            shiftEndTime.setDate(shiftEndTime.getDate() + 1);
        }
        
        // Before break: requiredLogout = clockIn + 9 hours
        // After break: requiredLogout = clockIn + 9 hours - (expectedBreak - actualBreak)
        // Note: Lateness is already accounted for by calculating from actual clock-in time,
        // so we don't add a lateness penalty. Employee works the standard 9 hours from when they clock in.
        let baseLogoutTime;
        
        if (!hasTakenPaidBreak) {
            // No paid break taken yet
            baseLogoutTime = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES);
        } else {
            // Paid break taken → adjust logout based on actual total paid break minutes taken
            const savedBreak = EXPECTED_BREAK_MINUTES - totalPaidBreakMinutes;
            baseLogoutTime = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES - savedBreak);
        }
        
        // Add unpaid break extension
        if (totalUnpaidBreakMinutes > 0) {
            baseLogoutTime = addMinutes(baseLogoutTime, totalUnpaidBreakMinutes);
        }
        
        return baseLogoutTime.toISOString();
    } 
    // For Flexible shifts, use 9-hour logic with break adjustment
    else if (userShift.shiftType === 'Flexible' && userShift.durationHours) {
        // If break not taken yet → no break deduction
        if (!hasTakenPaidBreak) {
            const baseLogout = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES);
            // Add unpaid break extension
            if (totalUnpaidBreakMinutes > 0) {
                return addMinutes(baseLogout, totalUnpaidBreakMinutes).toISOString();
            }
            return baseLogout.toISOString();
        }
        
        // Break taken → adjust logout based on actual total paid break minutes taken
        const savedBreak = EXPECTED_BREAK_MINUTES - totalPaidBreakMinutes; // positive = saved, negative = extra
        
        const baseLogout = addMinutes(clockInTime, SHIFT_TOTAL_MINUTES - savedBreak);
        // Add unpaid break extension
        if (totalUnpaidBreakMinutes > 0) {
            return addMinutes(baseLogout, totalUnpaidBreakMinutes).toISOString();
        }
        return baseLogout.toISOString();
    }

    return null;
};

const getUserDailyStatus = async (userId, targetDate, options = {}) => {
    const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
    const response = buildBaseResponse(resolvedOptions);

    const user = await User.findById(userId).populate('shiftGroup').lean();
    if (!user) {
        return response;
    }

    response.shift = user.shiftGroup || null;

    const attendanceLog = await AttendanceLog.findOne({ user: userId, attendanceDate: targetDate }).lean();
    if (!attendanceLog) {
        return response;
    }

    response.attendanceLog = mapAttendanceLog(attendanceLog);

    let sessions = [];
    if (resolvedOptions.includeSessions) {
        sessions = await AttendanceSession.find({ attendanceLog: attendanceLog._id }).sort({ startTime: 1 }).lean();
        response.sessions = sessions;
    }

    let breaks = [];
    if (resolvedOptions.includeBreaks) {
        breaks = await BreakLog.find({ attendanceLog: attendanceLog._id }).sort({ startTime: 1 }).lean();
        response.breaks = breaks;
        const activeBreakDoc = breaks.find(b => !b.endTime);
        response.activeBreak = mapActiveBreak(activeBreakDoc);
    }

    let autoBreakDoc = null;
    if (resolvedOptions.includeAutoBreak) {
        autoBreakDoc = await BreakLog.findOne({
            userId,
            endTime: null,
            isAutoBreak: true,
        }).sort({ startTime: 1 }).lean();
        response.autoBreak = mapAutoBreak(autoBreakDoc);
    }

    if (resolvedOptions.includeRequests) {
        response.pendingExtraBreakRequest = await ExtraBreakRequest.findOne({
            user: userId,
            attendanceDate: targetDate,
            status: 'Pending',
        }).lean();
        response.approvedExtraBreak = await ExtraBreakRequest.findOne({
            user: userId,
            attendanceDate: targetDate,
            status: 'Approved',
            isUsed: false,
        }).lean();
    }

    const hasActiveSession = sessions.some(s => !s.endTime);
    const hasManualSessions = sessions.length > 0;
    const autoBreakActive = !!response.autoBreak;
    const hasAnyActiveBreak = !!response.activeBreak || autoBreakActive;

    if (hasAnyActiveBreak) {
        response.status = autoBreakActive ? 'On Auto-Break' : 'On Break';
    } else if (hasActiveSession) {
        response.status = 'Clocked In';
    } else if (hasManualSessions) {
        response.status = 'Clocked Out';
    } else {
        response.status = 'Not Clocked In';
    }

    // Pass activeBreak to the calculation function
    response.calculatedLogoutTime = computeCalculatedLogoutTime(sessions, breaks, response.attendanceLog, response.shift, response.activeBreak);

    return response;
};

module.exports = {
    getUserDailyStatus,
};

