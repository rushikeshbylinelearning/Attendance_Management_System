// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// --- Middleware ---
const authenticateToken = require('../middleware/authenticateToken');

// --- Models ---
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceSession = require('../models/AttendanceSession');
const LeaveRequest = require('../models/LeaveRequest');
const ExtraBreakRequest = require('../models/ExtraBreakRequest');
const BreakLog = require('../models/BreakLog');
const Holiday = require('../models/Holiday');
const Setting = require('../models/Setting');
const NewNotificationService = require('../services/NewNotificationService');
const { getUserDailyStatus } = require('../services/dailyStatusService');

// Middleware to check for Admin/HR role
const isAdminOrHr = (req, res, next) => {
    if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin or HR role.' });
    }
    next();
};

// --- LEAVE MANAGEMENT ROUTES ---

// GET /api/admin/leaves/all
router.get('/leaves/all', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const totalCount = await LeaveRequest.countDocuments({});
        const allRequests = await LeaveRequest.find({})
            .populate('employee', 'fullName employeeCode')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
            
        res.json({
            requests: allRequests,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit)
        });
    } catch (error) {
        console.error('Error fetching all leave requests:', error);
        res.status(500).json({ error: 'Failed to fetch requests.' });
    }
});

// POST /api/admin/leaves
router.post('/leaves', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const newRequest = new LeaveRequest(req.body);
        await newRequest.save();
        res.status(201).json({ message: 'Leave request created successfully.', request: newRequest });
    } catch (error) {
        console.error('Error creating leave request by admin:', error);
        res.status(500).json({ error: 'Failed to create leave request.' });
    }
});

// PUT /leaves/:id
router.put('/leaves/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const updatedRequest = await LeaveRequest.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedRequest) {
            return res.status(404).json({ error: 'Request not found.' });
        }
        res.json({ message: 'Request updated successfully.', request: updatedRequest });
    } catch (error) {
        console.error('Error updating leave request by admin:', error);
        res.status(500).json({ error: 'Failed to update request.' });
    }
});

// DELETE /leaves/:id
router.delete('/leaves/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const deletedRequest = await LeaveRequest.findByIdAndDelete(req.params.id);
        if (!deletedRequest) {
            return res.status(404).json({ error: 'Request not found.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting leave request by admin:', error);
        res.status(500).json({ error: 'Failed to delete request.' });
    }
});

// GET /leaves/pending
router.get('/leaves/pending', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const pendingRequests = await LeaveRequest.find({ status: 'Pending' })
            .populate('employee', 'fullName employeeCode')
            .sort({ createdAt: 1 });
        res.json(pendingRequests);
    } catch (error) {
        console.error('Error fetching pending leave requests:', error);
        res.status(500).json({ error: 'Failed to fetch pending requests.' });
    }
});

// GET /leaves/employee/:id - Get leave requests for specific employee
router.get('/leaves/employee/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { id } = req.params;
        const { year } = req.query;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid employee ID.' });
        }

        // Build query
        const query = { employee: id };
        
        // Add year filter if provided
        if (year) {
            const startDate = new Date(year, 0, 1); // January 1st
            const endDate = new Date(year, 11, 31); // December 31st
            query.createdAt = { $gte: startDate, $lte: endDate };
        }

        const leaveRequests = await LeaveRequest.find(query)
            .populate('employee', 'fullName employeeCode')
            .sort({ createdAt: -1 });

        res.json(leaveRequests);
    } catch (error) {
        console.error('Error fetching employee leave requests:', error);
        res.status(500).json({ error: 'Failed to fetch employee leave requests.' });
    }
});

// PATCH /leaves/:id/status
router.patch('/leaves/:id/status', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    const { status: newStatus, rejectionNotes } = req.body;

    if (!['Approved', 'Rejected'].includes(newStatus)) {
        return res.status(400).json({ error: 'Invalid status provided.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const request = await LeaveRequest.findById(id).session(session);
        if (!request) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'Request not found.' });
        }

        const oldStatus = request.status;
        const employee = await User.findById(request.employee).session(session);
        if (!employee) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        const leaveDuration = request.leaveDates.length * (request.leaveType === 'Full Day' ? 1 : 0.5);

        if (newStatus !== oldStatus) {
            // Correctly handle different leave types based on company policy
            // Planned -> paid, Casual -> casual, Sick -> sick
            let leaveField;
            switch(request.requestType) {
                case 'Sick':
                    leaveField = 'sick';
                    break;
                case 'Planned':
                    leaveField = 'paid'; // Planned leaves use paid leave balance
                    break;
                case 'Casual':
                    leaveField = 'casual'; // Casual leaves use casual leave balance
                    break;
                case 'Unpaid':
                case 'Compensatory':
                case 'Backdated Leave':
                    // These don't affect leave balances
                    leaveField = null;
                    break;
                default:
                    leaveField = null;
            }

            if (leaveField) {
                // Ensure balance doesn't go negative (admin can override, but we track it)
                if (newStatus === 'Approved' && oldStatus !== 'Approved') {
                    employee.leaveBalances[leaveField] = Math.max(0, employee.leaveBalances[leaveField] - leaveDuration);
                } else if (newStatus !== 'Approved' && oldStatus === 'Approved') {
                    // Revert the deduction if an approved leave is later rejected/cancelled
                    employee.leaveBalances[leaveField] += leaveDuration;
                }
            }
        }

        request.status = newStatus;
        request.approvedBy = req.user.userId;
        request.approvedAt = new Date();
        
        if (newStatus === 'Rejected' && rejectionNotes) {
            request.rejectionNotes = rejectionNotes;
        } else if (newStatus === 'Approved') {
            request.rejectionNotes = undefined;
        }
        
        await employee.save({ session });
        await request.save({ session });

        await session.commitTransaction();
        
        NewNotificationService.notifyLeaveResponse(request.employee, employee.fullName, newStatus, request.requestType, request.rejectionNotes)
            .catch(err => console.error('Error sending leave response notification:', err));
        
        res.json({ message: `Request has been ${newStatus.toLowerCase()}.`, request });
    } catch (error) {
        await session.abortTransaction();
        console.error(`Error updating request status for ID ${id}:`, error);
        res.status(500).json({ error: 'Failed to update request status.' });
    } finally {
        session.endSession();
    }
});

// @route   POST /api/admin/leaves/allocate
// @desc    Allocate leave balances to an employee for a year
// @access  Private (Admin/HR)
router.post('/leaves/allocate', [authenticateToken, isAdminOrHr], async (req, res) => {
    const {
        employeeId,
        year,
        sickLeaveEntitlement,
        casualLeaveEntitlement,
        paidLeaveEntitlement,
    } = req.body;

    if (!employeeId) {
        return res.status(400).json({ error: 'Employee ID is required.' });
    }

    try {
        const user = await User.findById(employeeId);
        if (!user) {
            return res.status(404).json({ error: 'Employee not found.' });
        }

        // --- START OF FIX: Set balances and entitlements separately and correctly ---
        const sick = sickLeaveEntitlement || 0;
        const casual = casualLeaveEntitlement || 0;
        const paid = paidLeaveEntitlement || 0;

        // Entitlements represent the total for the year
        user.leaveEntitlements = {
            sick: sick,
            casual: casual,
            paid: paid,
        };

        // Balances represent the currently available leaves
        user.leaveBalances = {
            sick: sick,
            casual: casual,
            paid: paid,
        };
        // --- END OF FIX ---

        await user.save();

        res.status(200).json({ 
            message: 'Leave balances and entitlements allocated successfully.', 
            user: { 
                _id: user._id, 
                fullName: user.fullName,
                leaveBalances: user.leaveBalances,
                leaveEntitlements: user.leaveEntitlements,
            } 
        });
    } catch (error) {
        console.error('Error allocating leaves:', error);
        res.status(500).json({ error: 'Failed to allocate leaves.' });
    }
});


// --- EXTRA BREAK & HOLIDAY ROUTES ---

router.patch('/breaks/extra/:requestId/status', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { requestId } = req.params;
    const { status } = req.body;
    const adminUserId = req.user.userId;

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status provided.' });
    }
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
        return res.status(400).json({ error: 'Invalid request ID.' });
    }

    try {
        const request = await ExtraBreakRequest.findById(requestId);
        if (!request) return res.status(404).json({ error: 'Extra break request not found.' });
        if (request.status !== 'Pending') return res.status(400).json({ error: 'This request has already been actioned.' });

        request.status = status;
        request.reviewedBy = adminUserId;
        request.reviewedAt = new Date();
        await request.save();

        // Invalidate dashboard cache to update recent activity
        const cacheService = require('../services/cacheService');
        const today = new Date().toISOString().slice(0, 10);
        cacheService.invalidateDashboard(today);

        const user = await User.findById(request.user);
        if (user) {
            const message = status === 'Approved'
                ? 'Your request for an extra break has been approved. You can now start it from the break menu.'
                : `Your request for an extra break for reason "${request.reason}" has been rejected.`;

            const actionData = status === 'Approved' ? {
                actionType: 'start_break',
                requiresAction: true,
                actionParams: { breakType: 'extra', reason: request.reason }
            } : {
                actionType: 'none',
                requiresAction: false
            };

            NewNotificationService.createAndEmitNotification({
                message: message,
                type: status === 'Approved' ? 'extra_break_approval' : 'extra_break_rejection',
                userId: request.user,
                userName: user.fullName,
                recipientType: 'user',
                category: 'break',
                priority: 'high',
                actionData,
                navigationData: { page: 'attendance' }
            }).catch(err => console.error('Error sending extra break response notification:', err));
        }
        
        res.json({ message: `Break request has been ${status.toLowerCase()}.` });

    } catch (error) {
        console.error('Error actioning extra break request:', error);
        res.status(500).json({ error: 'Failed to update request.' });
    }
});

router.get('/holidays', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const holidays = await Holiday.find().sort({ date: 1 });
        res.json(holidays);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch holidays.' });
    }
});
router.post('/holidays', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { name, date } = req.body;
    if (!name || !date) {
        return res.status(400).json({ error: 'Holiday name and date are required.' });
    }
    try {
        const newHoliday = new Holiday({ name, date });
        await newHoliday.save();
        res.status(201).json(newHoliday);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'A holiday on this date already exists.' });
        }
        res.status(500).json({ error: 'Failed to add holiday.' });
    }
});
router.delete('/holidays/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndDelete(req.params.id);
        if (!holiday) {
            return res.status(404).json({ error: 'Holiday not found.' });
        }
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete holiday.' });
    }
});

// --- ATTENDANCE MANAGEMENT ROUTES ---

// PATCH /api/admin/attendance/toggle-status
// Toggle attendance status (late/half-day) for an employee on a specific date
router.patch('/attendance/toggle-status', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { employeeId, attendanceDate, statusType, newStatus } = req.body;
        
        console.log('Toggle attendance status request:', { employeeId, attendanceDate, statusType, newStatus });
        
        // Validate required fields
        if (!employeeId || !attendanceDate || !statusType || !newStatus) {
            return res.status(400).json({ error: 'Employee ID, attendance date, status type, and new status are required.' });
        }
        
        // Validate status type
        if (!['late', 'halfday'].includes(statusType)) {
            return res.status(400).json({ error: 'Status type must be either "late" or "halfday".' });
        }
        
        // Validate new status
        if (!['On-time', 'Late', 'Half-day'].includes(newStatus)) {
            return res.status(400).json({ error: 'New status must be "On-time", "Late", or "Half-day".' });
        }
        
        // Validate date format (YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        }
        
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(employeeId)) {
            return res.status(400).json({ error: 'Invalid employee ID format.' });
        }
        
        // Check if employee exists
        const employee = await User.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Find or create attendance log for the date
        let attendanceLog = await AttendanceLog.findOne({
            user: employeeId,
            attendanceDate: attendanceDate
        });
        
        if (!attendanceLog) {
            // If no attendance log exists, create one
            const defaultClockInTime = new Date(`${attendanceDate}T09:00:00`);
            attendanceLog = new AttendanceLog({
                user: employeeId,
                attendanceDate: attendanceDate,
                clockInTime: defaultClockInTime,
                shiftDurationMinutes: 480, // Default 8 hours
                penaltyMinutes: 0,
                paidBreakMinutesTaken: 0,
                unpaidBreakMinutesTaken: 0,
                isLate: newStatus === 'Late',
                isHalfDay: newStatus === 'Half-day',
                lateMinutes: newStatus === 'Late' ? 15 : (newStatus === 'Half-day' ? 60 : 0), // Default late minutes
                lateCount: 0,
                attendanceStatus: newStatus
            });
            await attendanceLog.save();
        } else {
            // Update existing attendance log based on new status
            attendanceLog.attendanceStatus = newStatus;
            
            if (statusType === 'late') {
                // Toggle late status
                attendanceLog.isLate = newStatus === 'Late';
                attendanceLog.isHalfDay = false; // Remove half-day if marking as late
                attendanceLog.lateMinutes = newStatus === 'Late' ? Math.max(attendanceLog.lateMinutes || 0, 15) : 0;
            } else if (statusType === 'halfday') {
                // Toggle half-day status
                attendanceLog.isHalfDay = newStatus === 'Half-day';
                attendanceLog.isLate = false; // Remove late if marking as half-day
                attendanceLog.lateMinutes = newStatus === 'Half-day' ? Math.max(attendanceLog.lateMinutes || 0, 60) : 0;
            }
            
            await attendanceLog.save();
        }
        
        // Log the admin action
        try {
            const auditLogger = require('../services/auditLogger');
            await auditLogger.logAction({
                userId: req.user.userId,
                action: 'toggle_attendance_status',
                details: {
                    targetEmployeeId: employeeId,
                    targetEmployeeName: employee.fullName,
                    attendanceDate: attendanceDate,
                    statusType: statusType,
                    newStatus: newStatus,
                    previousStatus: attendanceLog.attendanceStatus
                },
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });
        } catch (auditError) {
            console.error('Failed to log audit action:', auditError);
            // Don't fail the request if audit logging fails
        }

        // Emit Socket.IO event to notify all clients about the attendance log update
        try {
            const { getIO } = require('../socketManager');
            const io = getIO();
            if (io) {
                // Emit to all connected clients
                io.emit('attendance_log_updated', {
                    logId: attendanceLog._id,
                    userId: attendanceLog.user,
                    attendanceDate: attendanceLog.attendanceDate,
                    attendanceStatus: attendanceLog.attendanceStatus,
                    isHalfDay: attendanceLog.isHalfDay,
                    isLate: attendanceLog.isLate,
                    lateMinutes: attendanceLog.lateMinutes,
                    clockInTime: attendanceLog.clockInTime,
                    clockOutTime: attendanceLog.clockOutTime,
                    updatedBy: req.user.userId,
                    timestamp: new Date().toISOString(),
                    message: `Attendance status updated to "${newStatus}" for ${employee.fullName} on ${attendanceDate}`
                });
                console.log(`📡 Emitted attendance_log_updated event for log ${attendanceLog._id}`);
            }
        } catch (socketError) {
            console.error('Failed to emit Socket.IO event:', socketError);
            // Don't fail the main request if Socket.IO fails
        }
        
        res.json({
            message: `Attendance status updated to "${newStatus}" successfully.`,
            attendanceLog: {
                id: attendanceLog._id,
                attendanceDate: attendanceLog.attendanceDate,
                isLate: attendanceLog.isLate,
                isHalfDay: attendanceLog.isHalfDay,
                attendanceStatus: attendanceLog.attendanceStatus,
                lateMinutes: attendanceLog.lateMinutes,
                employeeName: employee.fullName
            }
        });
        
    } catch (error) {
        console.error('Error toggling attendance status:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({ 
            error: 'Failed to toggle attendance status.',
            details: error.message
        });
    }
});

// GET /api/admin/attendance/employee/:employeeId
// Get attendance data for a specific employee for attendance resolution
router.get('/attendance/employee/:employeeId', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;
        
        if (!employeeId) {
            return res.status(400).json({ error: 'Employee ID is required.' });
        }
        
        // Check if employee exists
        const employee = await User.findById(employeeId).select('fullName employeeCode');
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        
        // Build query
        const query = { user: employeeId };
        
        console.log('Querying attendance logs for employee:', employeeId);
        
        if (startDate && endDate) {
            query.attendanceDate = {
                $gte: startDate,
                $lte: endDate
            };
            console.log('Date range filter applied:', { startDate, endDate });
        }
        
        console.log('Final query:', query);
        
        // Get attendance logs with recent dates first
        const attendanceLogs = await AttendanceLog.find(query)
            .select('attendanceDate clockInTime clockOutTime isLate isHalfDay attendanceStatus lateMinutes')
            .sort({ attendanceDate: -1 })
            .limit(50) // Limit to recent 50 records for performance
            .lean();
            
        console.log(`Found ${attendanceLogs.length} attendance logs for employee ${employeeId}`);
        
        // Get grace period setting for correct status calculation
        let GRACE_PERIOD_MINUTES = 30;
        try {
            const graceSetting = await Setting.findOne({ key: 'lateGraceMinutes' });
            if (graceSetting && !isNaN(Number(graceSetting.value))) {
                GRACE_PERIOD_MINUTES = Number(graceSetting.value);
            }
        } catch (err) {
            console.error('Failed to fetch late grace setting, using default 30 minutes', err);
        }
        
        console.log(`Using grace period: ${GRACE_PERIOD_MINUTES} minutes`);
        
        // Calculate correct status for each log based on grace period
        const logsWithCalculatedStatus = attendanceLogs.map(log => {
            const lateMinutes = log.lateMinutes || 0;
            let calculatedStatus = 'On-time';
            let calculatedIsLate = false;
            let calculatedIsHalfDay = false;
            
            // Check if there's a manual override (stored status differs from calculated)
            const hasManualOverride = log.attendanceStatus && 
                (log.attendanceStatus === 'Late' || 
                 (log.attendanceStatus === 'Half-day' && lateMinutes <= GRACE_PERIOD_MINUTES) ||
                 (log.attendanceStatus === 'On-time' && lateMinutes > GRACE_PERIOD_MINUTES));
            
            if (hasManualOverride) {
                // Use the manually set status
                calculatedStatus = log.attendanceStatus;
                calculatedIsLate = log.attendanceStatus === 'Late';
                calculatedIsHalfDay = log.attendanceStatus === 'Half-day';
            } else {
                // Apply grace period logic
                if (lateMinutes <= GRACE_PERIOD_MINUTES) {
                    // Within grace period = On-time
                    calculatedStatus = 'On-time';
                    calculatedIsLate = false;
                    calculatedIsHalfDay = false;
                } else if (lateMinutes > GRACE_PERIOD_MINUTES) {
                    // Beyond grace period = Half-day
                    calculatedStatus = 'Half-day';
                    calculatedIsHalfDay = true;
                    calculatedIsLate = false;
                }
            }
            
            return {
                ...log,
                // Override with calculated values
                calculatedStatus,
                calculatedIsLate,
                calculatedIsHalfDay,
                gracePeriodMinutes: GRACE_PERIOD_MINUTES,
                hasManualOverride
            };
        });
        
        if (attendanceLogs.length > 0) {
            console.log('Sample attendance log with calculated status:', logsWithCalculatedStatus[0]);
        }
        
        res.json({
            employee: employee,
            attendanceLogs: logsWithCalculatedStatus,
            gracePeriodMinutes: GRACE_PERIOD_MINUTES
        });
        
    } catch (error) {
        console.error('Error fetching employee attendance:', error);
        res.status(500).json({ error: 'Failed to fetch employee attendance data.' });
    }
});


// --- DASHBOARD & LOGS ROUTES ---

router.get('/dashboard-summary', [authenticateToken, isAdminOrHr], async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    
    try {
        const cacheService = require('../services/cacheService');
        const cachedSummary = cacheService.getDashboardSummary(today);
        
        if (cachedSummary) {
            return res.json(cachedSummary);
        }

        const totalEmployeesPromise = User.countDocuments({ isActive: true }).lean();
        const todayLogsPromise = AttendanceLog.find({ attendanceDate: today })
            .select('isLate isHalfDay clockInTime attendanceDate')
            .lean();
        
        const whosInListPromise = AttendanceSession.aggregate([
            { $match: { endTime: null } },
            { $lookup: { 
                from: 'attendancelogs', 
                localField: 'attendanceLog', 
                foreignField: '_id', 
                as: 'attendanceLogInfo',
                pipeline: [
                    { $match: { attendanceDate: today } },
                    { $project: { user: 1, attendanceDate: 1 } }
                ]
            }},
            { $unwind: '$attendanceLogInfo' },
            { $sort: { startTime: 1 } },
            { $group: { 
                _id: '$attendanceLogInfo.user', 
                startTime: { $first: '$startTime' } 
            }},
            { $lookup: { 
                from: 'users', 
                localField: '_id', 
                foreignField: '_id', 
                as: 'user',
                pipeline: [
                    { $project: { fullName: 1, designation: 1, profileImageUrl: 1 } }
                ]
            }},
            { $unwind: '$user' },
            { $project: { 
                _id: '$user._id', 
                fullName: '$user.fullName', 
                designation: '$user.designation', 
                startTime: '$startTime', 
                profileImageUrl: '$user.profileImageUrl' 
            }},
            { $sort: { startTime: 1 } }
        ]);

        const recentNotesPromise = AttendanceLog.find({ 
            attendanceDate: today, 
            notes: { $ne: null, $ne: '' } 
        })
        .populate('user', 'fullName employeeCode')
        .select('notes updatedAt user')
        .sort({ updatedAt: -1 })
        .limit(5)
        .lean();

        const pendingBreaksPromise = ExtraBreakRequest.find({
             status: 'Pending' 
        })
        .populate('user', 'fullName employeeCode')
        .select('reason createdAt user')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

        const backdatedLeavesPromise = LeaveRequest.find({
            isBackdated: true,
            status: 'Pending'
        })
        .populate('employee', 'fullName employeeCode')
        .select('reason createdAt employee')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

        const [totalEmployees, todayLogs, whosInListRaw, recentNotes, pendingBreaks, backdatedLeaves] = await Promise.all([
            totalEmployeesPromise, 
            todayLogsPromise, 
            whosInListPromise,
            recentNotesPromise,
            pendingBreaksPromise,
            backdatedLeavesPromise
        ]);

        // Enrich whosInList with calculated logout time and active break information
        const whosInList = await Promise.all(whosInListRaw.map(async (employee) => {
            try {
                const dailyStatus = await getUserDailyStatus(employee._id, today, {
                    includeRequests: false,
                    includeAutoBreak: false
                });

                return {
                    ...employee,
                    calculatedLogoutTime: dailyStatus.calculatedLogoutTime,
                    activeBreak: dailyStatus.activeBreak
                };
            } catch (error) {
                console.error(`Error enriching employee ${employee._id}:`, error);
                return {
                    ...employee,
                    calculatedLogoutTime: null,
                    activeBreak: null
                };
            }
        }));

        // Calculate status counts using correct grace period logic
        let presentCount = 0;
        let lateCount = 0;
        
        // Get grace period setting
        let GRACE_PERIOD_MINUTES = 30;
        try {
            const graceSetting = await Setting.findOne({ key: 'lateGraceMinutes' });
            if (graceSetting && !isNaN(Number(graceSetting.value))) {
                GRACE_PERIOD_MINUTES = Number(graceSetting.value);
            }
        } catch (err) {
            console.error('Failed to fetch late grace setting for dashboard, using default 30 minutes', err);
        }
        
        todayLogs.forEach(log => {
            if (log.clockInTime) {
                // Recalculate using correct grace period logic
                const lateMinutes = log.lateMinutes || 0;
                
                // If within grace period, count as present (on-time)
                if (lateMinutes <= GRACE_PERIOD_MINUTES) {
                    presentCount++;
                } else {
                    // Only count as late if beyond grace period (should be half-day, but for dashboard purposes)
                    lateCount++;
                }
            }
        });
        
        // If no attendance logs found, try to count from active attendance sessions
        if (todayLogs.length === 0) {
            const activeSessionsCount = await AttendanceSession.countDocuments({
                endTime: null,
                attendanceLog: {
                    $in: await AttendanceLog.find({ attendanceDate: today }).select('_id').lean()
                }
            });
            presentCount = activeSessionsCount;
        }
        
        // Also check for any employees who have clocked in today (regardless of status)
        if (presentCount === 0 && lateCount === 0) {
            const allClockedInCount = await AttendanceLog.countDocuments({
                attendanceDate: today,
                clockInTime: { $exists: true, $ne: null }
            });
            presentCount = allClockedInCount;
        }
        
        // Calculate on-leave count from approved leave requests
        const todayDate = new Date(today);
        const startOfDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
        const endOfDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + 1);
        
        const onLeaveCount = await LeaveRequest.countDocuments({
            status: 'Approved',
            leaveDates: {
                $elemMatch: {
                    $gte: startOfDay,
                    $lt: endOfDay
                }
            }
        });
        
        const statusCounts = {
            'Present': presentCount,
            'Late': lateCount,
            'On Leave': onLeaveCount
        };

        const mappedNotes = recentNotes.map(n => ({
            _id: n._id, type: 'Note', user: n.user, content: n.notes, timestamp: n.updatedAt
        }));
        const mappedBreakRequests = pendingBreaks.map(b => ({
            _id: b._id, type: 'ExtraBreakRequest', user: b.user, content: b.reason, timestamp: b.createdAt
        }));
        const mappedLeaveRequests = backdatedLeaves.map(l => ({
            _id: l._id, type: 'BackdatedLeaveRequest', user: l.employee, content: l.reason, timestamp: l.createdAt
        }));

        const recentActivity = [...mappedNotes, ...mappedBreakRequests, ...mappedLeaveRequests]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const summary = {
            totalEmployees,
            presentCount: statusCounts['Present'],
            lateCount: statusCounts['Late'],
            onLeaveCount: statusCounts['On Leave'],
            whosInList: whosInList || [],
            recentActivity: recentActivity || []
        };

        cacheService.setDashboardSummary(today, summary);
        
        res.json(summary);
    } catch (error) {
        console.error("Error fetching dashboard summary:", error);
        res.status(500).json({ error: "Internal server error." });
    }
});

// New endpoint to get detailed employee lists for dashboard cards
router.get('/dashboard-employees/:type', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { type } = req.params;
    const today = new Date().toISOString().slice(0, 10);
    
    try {
        let employees = [];
        
        switch (type) {
            case 'present':
                // Find employees who are present (clocked in and not late)
                const presentLogs = await AttendanceLog.find({ 
                    attendanceDate: today,
                    clockInTime: { $exists: true, $ne: null },
                    $or: [
                        { isLate: { $ne: true } },
                        { isLate: { $exists: false } }
                    ],
                    $and: [
                        { isHalfDay: { $ne: true } },
                        { isHalfDay: { $exists: false } }
                    ]
                }).populate('user', 'fullName employeeCode designation department profileImageUrl').lean();
                
                // If no present logs found, try to find employees with active attendance sessions
                if (presentLogs.length === 0) {
                    const AttendanceSession = require('../models/AttendanceSession');
                    
                    const activeSessions = await AttendanceSession.aggregate([
                        { $match: { endTime: null } },
                        { $lookup: { 
                            from: 'attendancelogs', 
                            localField: 'attendanceLog', 
                            foreignField: '_id', 
                            as: 'attendanceLogInfo',
                            pipeline: [
                                { $match: { attendanceDate: today } },
                                { $project: { user: 1, attendanceDate: 1 } }
                            ]
                        }},
                        { $unwind: '$attendanceLogInfo' },
                        { $lookup: { 
                            from: 'users', 
                            localField: 'attendanceLogInfo.user', 
                            foreignField: '_id', 
                            as: 'user',
                            pipeline: [
                                { $project: { fullName: 1, employeeCode: 1, designation: 1, department: 1, profileImageUrl: 1 } }
                            ]
                        }},
                        { $unwind: '$user' },
                        { $project: { 
                            _id: '$user._id', 
                            fullName: '$user.fullName', 
                            employeeCode: '$user.employeeCode',
                            designation: '$user.designation',
                            department: '$user.department',
                            profileImageUrl: '$user.profileImageUrl',
                            clockInTime: '$startTime',
                            status: 'Present'
                        }}
                    ]);
                    
                    
                    employees = activeSessions;
                } else {
                
                    employees = presentLogs.map(log => ({
                        _id: log.user._id,
                        fullName: log.user.fullName,
                        employeeCode: log.user.employeeCode,
                        designation: log.user.designation,
                        department: log.user.department,
                        profileImageUrl: log.user.profileImageUrl,
                        clockInTime: log.clockInTime,
                        status: 'Present',
                        notes: log.notes
                    }));
                }
                break;
                
            case 'late':
                // Find employees who are late
                const lateLogs = await AttendanceLog.find({ 
                    attendanceDate: today,
                    clockInTime: { $exists: true, $ne: null },
                    isLate: true
                }).populate('user', 'fullName employeeCode designation department profileImageUrl').lean();
                
                
                employees = lateLogs.map(log => ({
                    _id: log.user._id,
                    fullName: log.user.fullName,
                    employeeCode: log.user.employeeCode,
                    designation: log.user.designation,
                    department: log.user.department,
                    profileImageUrl: log.user.profileImageUrl,
                    clockInTime: log.clockInTime,
                    status: 'Late',
                    notes: log.notes
                }));
                break;
                
            case 'on-leave':
                // Find employees who are on approved leave for today
                const todayDate = new Date(today);
                const startOfDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
                const endOfDay = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + 1);
                
                const approvedLeaves = await LeaveRequest.find({
                    status: 'Approved',
                    leaveDates: {
                        $elemMatch: {
                            $gte: startOfDay,
                            $lt: endOfDay
                        }
                    }
                }).populate('employee', 'fullName employeeCode designation department profileImageUrl').lean();
                
                
                employees = approvedLeaves.map(leave => ({
                    _id: leave.employee._id,
                    fullName: leave.employee.fullName,
                    employeeCode: leave.employee.employeeCode,
                    designation: leave.employee.designation,
                    department: leave.employee.department,
                    profileImageUrl: leave.employee.profileImageUrl,
                    status: 'On Leave',
                    leaveType: leave.requestType,
                    leaveReason: leave.reason
                }));
                break;
                
            case 'total':
                const allEmployees = await User.find({ isActive: true })
                    .select('fullName employeeCode designation department profileImageUrl role employmentStatus joiningDate')
                    .sort({ fullName: 1 })
                    .lean();
                
                
                employees = allEmployees.map(emp => ({
                    _id: emp._id,
                    fullName: emp.fullName,
                    employeeCode: emp.employeeCode,
                    designation: emp.designation,
                    department: emp.department,
                    profileImageUrl: emp.profileImageUrl,
                    role: emp.role,
                    employmentStatus: emp.employmentStatus,
                    joiningDate: emp.joiningDate
                }));
                break;
                
            default:
                return res.status(400).json({ error: 'Invalid employee type' });
        }
        
        res.json(employees);
    } catch (error) {
        console.error(`Error fetching ${type} employees:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/attendance/user/:userId', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid employee ID format.' });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date query parameters are required.' });
        }

        const logs = await AttendanceLog.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(userId), attendanceDate: { $gte: startDate, $lte: endDate } } },
            { $lookup: { from: 'attendancesessions', localField: '_id', foreignField: 'attendanceLog', as: 'sessions' } },
            { $lookup: { from: 'breaklogs', localField: '_id', foreignField: 'attendanceLog', as: 'breaks' } },
            { $project: { _id: 1, attendanceDate: 1, status: 1, clockInTime: 1, clockOutTime: 1, notes: 1, sessions: { $map: { input: "$sessions", as: "s", in: { startTime: "$$s.startTime", endTime: "$$s.endTime" } } }, breaks: { $map: { input: "$breaks", as: "b", in: { startTime: "$$b.startTime", endTime: "$$b.endTime", durationMinutes: "$$b.durationMinutes", breakType: "$$b.breakType" } } } } },
            { $sort: { attendanceDate: 1 } }
        ]);

        res.json(logs);

    } catch (error) {
        console.error('Error fetching user attendance summary:', error);
        res.status(500).json({ error: 'Server error while fetching attendance summary.' });
    }
});

router.put('/attendance/log/:logId', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { logId } = req.params;
    const { sessions, breaks, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(logId)) {
        return res.status(400).json({ error: 'Invalid log ID.' });
    }

    const dbSession = await mongoose.startSession();
    dbSession.startTransaction();

    try {
        const log = await AttendanceLog.findById(logId).session(dbSession);
        if (!log) {
            await dbSession.abortTransaction();
            return res.status(404).json({ error: 'Attendance log not found.' });
        }
        
        await AttendanceSession.deleteMany({ attendanceLog: log._id }).session(dbSession);
        await BreakLog.deleteMany({ attendanceLog: log._id }).session(dbSession);

        const newSessions = sessions.map(s => ({
            startTime: new Date(s.startTime),
            endTime: s.endTime ? new Date(s.endTime) : null,
            attendanceLog: log._id,
        }));
        if (newSessions.length > 0) {
            await AttendanceSession.insertMany(newSessions, { session: dbSession });
        }

        let totalPaidBreak = 0;
        let totalUnpaidBreak = 0;
        
        const newBreaks = breaks.map(b => {
            const startTime = new Date(b.startTime);
            const endTime = new Date(b.endTime);
            const durationMinutes = (endTime - startTime) / 60000;
            
            if (b.breakType === 'Paid') {
                totalPaidBreak += durationMinutes;
            } else {
                totalUnpaidBreak += durationMinutes;
            }
            
            return {
                type: b.breakType,
                breakType: b.breakType,
                startTime,
                endTime,
                durationMinutes,
                attendanceLog: log._id,
                userId: log.user
            };
        });
        
        if (newBreaks.length > 0) {
            await BreakLog.insertMany(newBreaks, { session: dbSession });
        }

        const sortedSessions = [...newSessions].sort((a, b) => a.startTime - b.startTime);
        log.clockInTime = sortedSessions.length > 0 ? sortedSessions[0].startTime : null;
        const lastSession = sortedSessions[sortedSessions.length - 1];
        log.clockOutTime = lastSession?.endTime ? lastSession.endTime : null;

        log.paidBreakMinutesTaken = totalPaidBreak;
        log.unpaidBreakMinutesTaken = totalUnpaidBreak;
        log.notes = notes;
        log.penaltyMinutes = 0; 

        // Recalculate total working hours based on updated sessions and breaks
        if (log.clockInTime && log.clockOutTime) {
            const workingMinutes = (new Date(log.clockOutTime) - new Date(log.clockInTime)) / (1000 * 60);
            const totalBreakMinutes = totalPaidBreak + totalUnpaidBreak;
            const netWorkingMinutes = Math.max(0, workingMinutes - totalBreakMinutes);
            log.totalWorkingHours = netWorkingMinutes / 60;
        } else {
            log.totalWorkingHours = 0;
        }

        await log.save({ session: dbSession });

        await dbSession.commitTransaction();

        // Emit Socket.IO event to notify all clients about the attendance log update
        try {
            const { getIO } = require('../socketManager');
            const io = getIO();
            if (io) {
                // Emit to all connected clients
                io.emit('attendance_log_updated', {
                    logId: log._id,
                    userId: log.user,
                    attendanceDate: log.attendanceDate,
                    attendanceStatus: log.attendanceStatus,
                    isHalfDay: log.isHalfDay,
                    isLate: log.isLate,
                    totalWorkingHours: log.totalWorkingHours,
                    clockInTime: log.clockInTime,
                    clockOutTime: log.clockOutTime,
                    updatedBy: req.user.userId,
                    timestamp: new Date().toISOString(),
                    message: `Attendance log updated by admin - Working hours: ${log.totalWorkingHours.toFixed(2)}h`
                });
                console.log(`📡 Emitted attendance_log_updated event for log ${log._id}`);
            }
        } catch (socketError) {
            console.error('Failed to emit Socket.IO event:', socketError);
            // Don't fail the main request if Socket.IO fails
        }

        res.json({ message: 'Log updated successfully.' });

    } catch (error) {
        await dbSession.abortTransaction();
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ error: `Validation failed: ${messages.join(', ')}` });
        }
        if (error.name === 'CastError') {
            return res.status(400).json({ error: `Invalid data format for field: ${error.path}. Please check your inputs.` });
        }
        console.error('Error updating attendance log:', error);
        res.status(500).json({ error: 'Server error while updating log.' });
    } finally {
        dbSession.endSession();
    }
});

// PUT /api/admin/attendance/half-day/:logId - Toggle half-day status for an attendance log
router.put('/attendance/half-day/:logId', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const { logId } = req.params;
        const { isHalfDay } = req.body;

        if (!mongoose.Types.ObjectId.isValid(logId)) {
            return res.status(400).json({ error: 'Invalid log ID.' });
        }

        if (typeof isHalfDay !== 'boolean') {
            return res.status(400).json({ error: 'isHalfDay must be a boolean value.' });
        }

        const log = await AttendanceLog.findById(logId);
        if (!log) {
            return res.status(404).json({ error: 'Attendance log not found.' });
        }

        // Store the original status for logging
        const originalStatus = log.attendanceStatus;
        const wasHalfDay = log.isHalfDay;
        
        // Update the half-day status
        log.isHalfDay = isHalfDay;
        
        // Enhanced status transition logic
        if (isHalfDay && !wasHalfDay) {
            // Marking as half-day - set status to Half-day regardless of current status
            log.attendanceStatus = 'Half-day';
        } else if (!isHalfDay && wasHalfDay) {
            // Unmarking half-day - recalculate status based on existing data
            if (!log.clockInTime) {
                // No clock-in time = Absent
                log.attendanceStatus = 'Absent';
            } else if (log.isLate) {
                // Has clock-in but was late = Late
                log.attendanceStatus = 'Late';
            } else {
                // Has clock-in and wasn't late = On-time
                log.attendanceStatus = 'On-time';
            }
        } else if (isHalfDay && wasHalfDay && log.attendanceStatus !== 'Half-day') {
            // Already marked as half-day but status got changed elsewhere - restore to Half-day
            log.attendanceStatus = 'Half-day';
        }

        await log.save();

        // Emit Socket.IO event to notify all clients about the attendance log update
        try {
            const { getIO } = require('../socketManager');
            const io = getIO();
            if (io) {
                // Emit to all connected clients
                io.emit('attendance_log_updated', {
                    logId: log._id,
                    userId: log.user,
                    attendanceDate: log.attendanceDate,
                    attendanceStatus: log.attendanceStatus,
                    isHalfDay: log.isHalfDay,
                    isLate: log.isLate,
                    totalWorkingHours: log.totalWorkingHours,
                    clockInTime: log.clockInTime,
                    clockOutTime: log.clockOutTime,
                    previousStatus: originalStatus,
                    updatedBy: req.user.userId,
                    timestamp: new Date().toISOString(),
                    message: `Attendance log updated: ${originalStatus} → ${log.attendanceStatus} - Working hours: ${log.totalWorkingHours.toFixed(2)}h`
                });
                console.log(`📡 Emitted attendance_log_updated event for log ${log._id}`);
            }
        } catch (socketError) {
            console.error('Failed to emit Socket.IO event:', socketError);
            // Don't fail the main request if Socket.IO fails
        }

        // Log the action with status transition details (with error handling)
        try {
            const logAction = require('../services/logAction');
            await logAction(
                req.user.userId,
                isHalfDay ? 'MARK_HALF_DAY' : 'UNMARK_HALF_DAY',
                {
                    attendanceLogId: log._id,
                    attendanceDate: log.attendanceDate,
                    previousStatus: originalStatus,
                    newStatus: log.attendanceStatus,
                    isHalfDay: log.isHalfDay,
                    details: `${isHalfDay ? 'Marked' : 'Unmarked'} half-day for attendance log on ${log.attendanceDate}. Status changed from "${originalStatus}" to "${log.attendanceStatus}"`
                }
            );
        } catch (logError) {
            console.error('Failed to log half-day action:', logError);
            // Don't fail the main request if logging fails
        }

        res.json({ 
            message: `Half-day status ${isHalfDay ? 'enabled' : 'disabled'} successfully. Status changed from "${originalStatus}" to "${log.attendanceStatus}".`,
            log: {
                _id: log._id,
                attendanceDate: log.attendanceDate,
                isHalfDay: log.isHalfDay,
                attendanceStatus: log.attendanceStatus,
                previousStatus: originalStatus
            }
        });

    } catch (error) {
        console.error('Error updating half-day status:', error);
        console.error('Error stack:', error.stack);
        console.error('Request details:', {
            logId: req.params.logId,
            isHalfDay: req.body.isHalfDay,
            userId: req.user?.userId
        });
        res.status(500).json({ 
            error: 'Server error while updating half-day status.',
            details: error.message 
        });
    }
});


module.exports = router;