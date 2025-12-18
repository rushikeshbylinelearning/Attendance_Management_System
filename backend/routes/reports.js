// backend/routes/reports.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authenticateToken = require('../middleware/authenticateToken');
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const Shift = require('../models/Shift');

const isAdminOrHr = (req, res, next) => {
    if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin or HR role.' });
    }
    next();
};

// Helper function to generate all days in date range
function getAllDaysInRange(startDate, endDate) {
    const days = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);
    
    while (current <= end) {
        days.push(new Date(current));
        current.setDate(current.getDate() + 1);
    }
    return days;
}

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Helper function to check if date is weekend
function isWeekend(date) {
    const day = new Date(date).getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

// @route   POST /api/admin/reports/attendance
// @desc    Generate an attendance and break report
// @access  Private (Admin/HR)
router.post('/attendance', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { startDate, endDate, employeeIds } = req.body;
    if (!startDate || !endDate || !employeeIds || employeeIds.length === 0) {
        return res.status(400).json({ error: 'Start date, end date, and at least one employee are required.' });
    }

    try {
        const rangeStart = new Date(startDate);
        const rangeEnd = new Date(endDate);
        if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
            return res.status(400).json({ error: 'Invalid date range provided.' });
        }

        const objectIdArray = employeeIds.map(id => new mongoose.Types.ObjectId(id));

        const employees = await User.find(
            { _id: { $in: objectIdArray }, isActive: true },
            { fullName: 1, employeeCode: 1, shiftGroup: 1 }
        ).lean();

        if (!employees || employees.length === 0) {
            return res.status(404).json({ error: 'No active employees found for the provided IDs.' });
        }

        const activeEmployeeIds = employees.map(emp => emp._id);

        // Get attendance logs
        const startDateStr = formatDate(rangeStart);
        const endDateStr = formatDate(rangeEnd);

        const attendanceData = await AttendanceLog.aggregate([
            { $match: { user: { $in: activeEmployeeIds }, attendanceDate: { $gte: startDateStr, $lte: endDateStr } } },
            { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'employee' } },
            { $unwind: '$employee' },
            { $lookup: { from: 'shifts', localField: 'employee.shiftGroup', foreignField: '_id', as: 'shift' } },
            { $unwind: { path: '$shift', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'attendancesessions', localField: '_id', foreignField: 'attendanceLog', as: 'sessions' } },
            { $lookup: { from: 'breaklogs', localField: '_id', foreignField: 'attendanceLog', as: 'breaks' } },
            {
                $addFields: {
                    firstClockIn: { $min: '$sessions.startTime' },
                    lastClockOut: { $max: '$sessions.endTime' },
                }
            },
            {
                $addFields: {
                    totalWorkMinutes: {
                        $cond: {
                            if: { $and: ['$firstClockIn', '$lastClockOut'] },
                            then: {
                                $subtract: [
                                    { $divide: [{ $subtract: ['$lastClockOut', '$firstClockIn'] }, 60000] },
                                    { $add: [
                                        { $ifNull: ['$paidBreakMinutesTaken', 0] },
                                        { $ifNull: ['$unpaidBreakMinutesTaken', 0] },
                                        { $ifNull: ['$penaltyMinutes', 0] }
                                    ]}
                                ]
                            },
                            else: 0
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    employeeId: '$employee._id',
                    employeeName: '$employee.fullName',
                    employeeCode: '$employee.employeeCode',
                    date: '$attendanceDate',
                    clockIn: '$firstClockIn',
                    clockOut: '$lastClockOut',
                    paidBreakMinutes: { $ifNull: ['$paidBreakMinutesTaken', 0] },
                    unpaidBreakMinutes: { $ifNull: ['$unpaidBreakMinutesTaken', 0] },
                    extraUnpaidBreakMinutes: {
                        $sum: {
                            $map: {
                                input: { $filter: { input: '$breaks', as: 'b', cond: { $eq: ['$$b.breakType', 'Extra'] } } },
                                as: 'eb',
                                in: '$$eb.durationMinutes'
                            }
                        }
                    },
                    totalBreakMinutes: {
                        $add: [
                            { $ifNull: ['$paidBreakMinutesTaken', 0] },
                            { $ifNull: ['$unpaidBreakMinutesTaken', 0] }
                        ]
                    },
                    totalWorkMinutes: 1,
                    status: { $ifNull: ['$status', 'Present'] },
                    penaltyMinutes: { $ifNull: ['$penaltyMinutes', 0] },
                    shiftName: { $ifNull: ['$shift.shiftName', 'N/A'] }
                }
            },
            { $sort: { date: 1, employeeName: 1 } }
        ]);

        const shiftIds = [...new Set(
            employees
                .filter(emp => emp.shiftGroup)
                .map(emp => emp.shiftGroup.toString())
        )];

        const shifts = shiftIds.length > 0
            ? await Shift.find({ _id: { $in: shiftIds } }, { shiftName: 1 }).lean()
            : [];

        const shiftMap = new Map(shifts.map(shift => [shift._id.toString(), shift.shiftName || 'N/A']));

        // Get all holidays in date range
        const holidays = await Holiday.find({
            date: { $gte: rangeStart, $lte: rangeEnd }
        }).lean();
        const holidayDates = new Set(holidays.map(h => formatDate(h.date)));

        // Get approved leave requests for selected employees
        const leaveRequests = await LeaveRequest.find({
            employee: { $in: activeEmployeeIds },
            status: 'Approved',
            leaveDates: {
                $elemMatch: {
                    $gte: rangeStart,
                    $lte: rangeEnd
                }
            }
        }, { employee: 1, leaveDates: 1, requestType: 1, leaveType: 1 }).lean();

        const leaveDatesMap = new Map(); // key -> Set of dates for leave
        leaveRequests.forEach(leave => {
            const employeeId = leave.employee.toString();
            leave.leaveDates.forEach(leaveDate => {
                const leaveDateObj = new Date(leaveDate);
                if (leaveDateObj >= rangeStart && leaveDateObj <= rangeEnd) {
                    const dateStr = formatDate(leaveDateObj);
                    const key = `${employeeId}-${dateStr}`;
                    if (!leaveDatesMap.has(key)) {
                        leaveDatesMap.set(key, {
                            requestType: leave.requestType,
                            leaveType: leave.leaveType
                        });
                    }
                }
            });
        });

        const attendanceMap = new Map();
        attendanceData.forEach(log => {
            const employeeId = log.employeeId.toString();
            const dateStr = formatDate(log.date);
            const key = `${employeeId}-${dateStr}`;
            attendanceMap.set(key, {
                ...log,
                employeeId,
                date: dateStr
            });
        });

        const allDays = getAllDaysInRange(rangeStart, rangeEnd);
        const completeReport = [];

        employees.forEach(employee => {
            const employeeId = employee._id.toString();
            const defaultShiftName = employee.shiftGroup
                ? (shiftMap.get(employee.shiftGroup.toString()) || 'N/A')
                : 'N/A';

            allDays.forEach(day => {
                const dateStr = formatDate(day);
                const key = `${employeeId}-${dateStr}`;
                const existingLog = attendanceMap.get(key);

                if (existingLog) {
                    if (!existingLog.shiftName || existingLog.shiftName === 'N/A') {
                        existingLog.shiftName = defaultShiftName;
                    }
                    completeReport.push(existingLog);
                } else {
                    let status = 'Absent';

                    if (holidayDates.has(dateStr)) {
                        status = 'Holiday';
                    } else if (isWeekend(day)) {
                        status = 'Weekend';
                    } else if (leaveDatesMap.has(key)) {
                        status = 'On Leave';
                    }

                    completeReport.push({
                        employeeId,
                        employeeName: employee.fullName,
                        employeeCode: employee.employeeCode,
                        date: dateStr,
                        clockIn: null,
                        clockOut: null,
                        paidBreakMinutes: 0,
                        unpaidBreakMinutes: 0,
                        extraUnpaidBreakMinutes: 0,
                        totalBreakMinutes: 0,
                        totalWorkMinutes: 0,
                        status,
                        penaltyMinutes: 0,
                        shiftName: defaultShiftName
                    });
                }
            });
        });

        completeReport.sort((a, b) => {
            const dateDiff = new Date(a.date) - new Date(b.date);
            if (dateDiff !== 0) return dateDiff;
            return a.employeeName.localeCompare(b.employeeName);
        });

        res.json(completeReport);
    } catch (error) {
        console.error('Error generating attendance report:', error);
        res.status(500).json({ error: 'Server error while generating report.' });
    }
});

// @route   POST /api/admin/reports/leaves (Unchanged)
router.post('/leaves', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { startDate, endDate, employeeIds, status } = req.body;
    if (!startDate || !endDate || !employeeIds || employeeIds.length === 0) {
        return res.status(400).json({ error: 'Start date, end date, and at least one employee are required.' });
    }
    try {
        const objectIdArray = employeeIds.map(id => new mongoose.Types.ObjectId(id));
        const matchQuery = {
            employee: { $in: objectIdArray },
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        };
        if (status && status !== 'All') {
            matchQuery.status = status;
        }
        const leaveData = await LeaveRequest.find(matchQuery)
            .populate('employee', 'fullName employeeCode')
            .sort({ createdAt: -1 })
            .lean();
        res.json(leaveData);
    } catch (error) {
        console.error('Error generating leave report:', error);
        res.status(500).json({ error: 'Server error while generating report.' });
    }
});

// @route   POST /api/admin/reports/notes
// @desc    Generate an attendance notes report
// @access  Private (Admin/HR)
router.post('/notes', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { startDate, endDate, employeeIds } = req.body;
    if (!startDate || !endDate || !employeeIds || employeeIds.length === 0) {
        return res.status(400).json({ error: 'Start date, end date, and at least one employee are required.' });
    }

    try {
        const objectIdArray = employeeIds.map(id => new mongoose.Types.ObjectId(id));

        const notesData = await AttendanceLog.aggregate([
            { 
                $match: { 
                    user: { $in: objectIdArray }, 
                    attendanceDate: { $gte: startDate, $lte: endDate },
                    notes: { $exists: true, $ne: '', $ne: null } // Only get logs with notes
                } 
            },
            { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'employee' } },
            { $unwind: '$employee' },
            { $lookup: { from: 'shifts', localField: 'employee.shiftGroup', foreignField: '_id', as: 'shift' } },
            { $unwind: { path: '$shift', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    employeeId: '$employee._id',
                    employeeName: '$employee.fullName',
                    employeeCode: '$employee.employeeCode',
                    date: '$attendanceDate',
                    status: { $ifNull: ['$status', 'Present'] },
                    shiftName: { $ifNull: ['$shift.shiftName', 'N/A'] },
                    notes: '$notes',
                    clockInTime: '$clockInTime',
                    clockOutTime: '$clockOutTime',
                    createdAt: '$createdAt',
                    updatedAt: '$updatedAt'
                }
            },
            { $sort: { date: -1, employeeName: 1 } }
        ]);
        
        res.json(notesData);
    } catch (error) {
        console.error('Error generating notes report:', error);
        res.status(500).json({ error: 'Server error while generating notes report.' });
    }
});

module.exports = router;