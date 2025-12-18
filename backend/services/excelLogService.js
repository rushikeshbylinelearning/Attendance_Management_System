// backend/services/excelLogService.js
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { getIO } = require('../socket');

// Models
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceSession = require('../models/AttendanceSession');
const BreakLog = require('../models/BreakLog');

const publicDir = path.join(__dirname, '..', 'public');
const excelFilePath = path.join(publicDir, 'attendance.xls');

// Ensure public directory exists
fs.mkdirSync(publicDir, { recursive: true });

const HEADERS = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Employee Code', key: 'employeeCode', width: 20 },
    { header: 'Employee Name', key: 'employeeName', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Clock In', key: 'clockIn', width: 15 },
    { header: 'Clock Out', key: 'clockOut', width: 15 },
    { header: 'Work Duration', key: 'workDuration', width: 18 },
    { header: 'Break Duration', key: 'breakDuration', width: 18 },
    { header: 'Notes', key: 'notes', width: 40 }
];

const formatDuration = (minutes) => {
    if (isNaN(minutes) || minutes <= 0) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
};

const formatTime = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};


async function getOrCreateWorkbook() {
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(excelFilePath)) {
        await workbook.xlsx.readFile(excelFilePath);
    }
    return workbook;
}

async function updateExcelForRow(userId, dateString) {
    try {
        const user = await User.findById(userId).lean();
        if (!user) {
            console.error(`Excel update failed: User with ID ${userId} not found.`);
            return;
        }

        const log = await AttendanceLog.findOne({ user: userId, attendanceDate: dateString }).lean();
        
        let rowData = {
            date: dateString,
            employeeCode: user.employeeCode,
            employeeName: user.fullName,
            status: 'Absent',
            clockIn: 'N/A',
            clockOut: 'N/A',
            workDuration: '0h 0m',
            breakDuration: '0h 0m',
            notes: '',
        };

        if (log) {
            const sessions = await AttendanceSession.find({ attendanceLog: log._id }).lean();
            const breaks = await BreakLog.find({ attendanceLog: log._id }).lean();

            const firstClockIn = sessions.length > 0 ? sessions[0].startTime : null;
            const lastClockOut = log.clockOutTime; // Use the main log clockOutTime

            const totalBreakMinutes = breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
            
            let totalWorkMinutes = 0;
            if (sessions.length > 0 && lastClockOut) {
                const grossDurationMs = new Date(lastClockOut) - new Date(firstClockIn);
                totalWorkMinutes = Math.max(0, (grossDurationMs / 60000) - totalBreakMinutes);
            }

            rowData = {
                ...rowData,
                status: log.clockOutTime ? 'Present' : 'Clocked In',
                clockIn: formatTime(firstClockIn),
                clockOut: formatTime(lastClockOut),
                workDuration: formatDuration(totalWorkMinutes),
                breakDuration: formatDuration(totalBreakMinutes),
                notes: log.notes || '',
            };
        }
        
        await updateLogEntry(rowData);

    } catch (error) {
        console.error(`Error updating Excel row for user ${userId} on ${dateString}:`, error);
    }
}


async function updateLogEntry(logData) {
    const workbook = await getOrCreateWorkbook();
    const date = new Date(logData.date);
    const sheetName = date.toLocaleString('default', { month: 'long' }) + '-' + date.getFullYear();

    let worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
        worksheet = workbook.addWorksheet(sheetName);
        worksheet.columns = HEADERS;
    }

    let rowIndex = -1;
    worksheet.eachRow((row, rowNumber) => {
        if (row.getCell('date').value === logData.date && row.getCell('employeeCode').value === logData.employeeCode) {
            rowIndex = rowNumber;
        }
    });
    
    if (rowIndex > -1) {
        const row = worksheet.getRow(rowIndex);
        row.values = logData;
        row.commit();
    } else {
        worksheet.addRow(logData);
    }

    await workbook.xlsx.writeFile(excelFilePath);
    console.log(`✅ Excel log updated for ${logData.employeeName} on ${logData.date}`);
    
    // Notify clients via WebSocket
    getIO().emit('logUpdated', { sheetName });
}

async function getSheetNames() {
    const workbook = await getOrCreateWorkbook();
    return workbook.worksheets.map(ws => ws.name);
}

async function getSheetData(sheetName) {
    const workbook = await getOrCreateWorkbook();
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) return [];

    const data = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber > 1) { // Skip header row
            const rowData = {};
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const header = HEADERS[colNumber - 1].key;
                rowData[header] = cell.value;
            });
            data.push(rowData);
        }
    });
    return data;
}

module.exports = {
    updateExcelForRow,
    getSheetNames,
    getSheetData
};