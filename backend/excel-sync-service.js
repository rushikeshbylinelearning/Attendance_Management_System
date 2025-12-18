// backend/excel-sync-service.js
require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const connectDB = require('./db');

// --- Models ---
const ExcelLog = require('./models/ExcelLog');
const User = require('./models/User');

// --- CONFIGURATION ---
const BATCH_SIZE = 500; // Process 500 logs at a time to prevent memory issues
const CRON_SCHEDULE = '*/1 * * * *'; // Run every 2 minutes. Adjust as needed.
// const EXCEL_FILE_PATH = path.join('\\\\', 'shared', 'logs', 'SystemLogs.xlsx'); // UNC path for shared network drive
// const LOCK_FILE_PATH = path.join('\\\\', 'shared', 'logs', 'SystemLogs.xlsx.lock');
const EXCEL_FILE_PATH = path.join("SystemLogs.xlsx");

// Define sheets and their headers
const SHEET_CONFIG = {
    'Login Logs': {
        headers: ['Timestamp', 'Employee Name', 'Employee Code', 'Action', 'IP Address', 'User Agent'],
        type: ['LOGIN_SUCCESS', 'LOGIN_FAIL']
    },
    'Attendance': {
        headers: ['Timestamp', 'Employee Name', 'Employee Code', 'Action', 'Clock In Time', 'Clock Out Time'],
        type: ['CLOCK_IN', 'CLOCK_OUT']
    },
    'Breaks': {
        headers: ['Timestamp', 'Employee Name', 'Employee Code', 'Action', 'Break Type', 'Start Time', 'End Time', 'Duration (Mins)'],
        type: ['BREAK_START', 'BREAK_END']
    },
    'Leaves': {
        headers: ['Timestamp', 'Employee Name', 'Employee Code', 'Action', 'Request Type', 'Status'],
        type: ['LEAVE_REQUEST_SUBMITTED', 'LEAVE_REQUEST_APPROVED', 'LEAVE_REQUEST_REJECTED']
    },
};

/**
 * Ensures the Excel workbook and its sheets exist with the correct headers.
 * @param {string} filePath - Path to the Excel file.
 * @returns {ExcelJS.Workbook} - The loaded or newly created workbook instance.
 */
const initializeWorkbook = async (filePath) => {
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(filePath)) {
        await workbook.xlsx.readFile(filePath);
    } else {
        console.log(`Excel file not found at ${filePath}. Creating a new one.`);
        for (const sheetName in SHEET_CONFIG) {
            const sheet = workbook.addWorksheet(sheetName);
            sheet.columns = SHEET_CONFIG[sheetName].headers.map(header => ({ header, key: header.toLowerCase().replace(/ /g, '_'), width: 25 }));
        }
        await workbook.xlsx.writeFile(filePath);
    }
    return workbook;
};


/**
 * The core function that syncs logs from MongoDB to the shared Excel file.
 */
const syncLogsToExcel = async () => {
    console.log(`[${new Date().toISOString()}] Starting Excel sync job...`);

    // 1. Check for lock file to prevent concurrent runs
    if (fs.existsSync(LOCK_FILE_PATH)) {
        console.log('Sync job is already running. Skipping this cycle.');
        return;
    }

    try {
        // 2. Create lock file
        fs.writeFileSync(LOCK_FILE_PATH, 'locked');

        // 3. Fetch a batch of unsynced logs
        const logsToSync = await ExcelLog.find({ synced: false })
            .populate('user', 'fullName employeeCode')
            .sort({ createdAt: 1 })
            .limit(BATCH_SIZE)
            .lean();

        if (logsToSync.length === 0) {
            console.log('No new logs to sync.');
            return; // Exit early if no work to do
        }

        console.log(`Found ${logsToSync.length} logs to sync.`);

        // 4. Initialize or load the Excel workbook
        const workbook = await initializeWorkbook(EXCEL_FILE_PATH);

        // 5. Group logs by their target sheet
        const groupedLogs = {};
        for (const sheetName in SHEET_CONFIG) {
            groupedLogs[sheetName] = [];
        }

        logsToSync.forEach(log => {
            for (const sheetName in SHEET_CONFIG) {
                if (SHEET_CONFIG[sheetName].type.includes(log.logType)) {
                    groupedLogs[sheetName].push(log);
                    break;
                }
            }
        });

        // 6. Append rows to the appropriate sheets
        for (const sheetName in groupedLogs) {
            const logsForSheet = groupedLogs[sheetName];
            if (logsForSheet.length > 0) {
                const worksheet = workbook.getWorksheet(sheetName);
                if (!worksheet) {
                     console.error(`Sheet "${sheetName}" not found in workbook. Skipping.`);
                     continue;
                }
                const rowsToAdd = logsForSheet.map(log => {
                    // Format data based on log type to match headers
                    const base = [log.createdAt, log.user?.fullName || 'N/A', log.user?.employeeCode || 'N/A', log.logType];
                    switch (log.logType) {
                        case 'LOGIN_SUCCESS':
                        case 'LOGIN_FAIL':
                            return [...base, log.logData?.ipAddress || '', log.logData?.userAgent || ''];
                        case 'CLOCK_IN':
                            return [...base, log.logData?.clockInTime || '', ''];
                        case 'CLOCK_OUT':
                             return [...base, '', log.logData?.clockOutTime || ''];
                        case 'BREAK_START':
                            return [...base, log.logData?.breakType || '', log.logData?.startTime || '', '', ''];
                        case 'BREAK_END':
                            return [...base, log.logData?.breakType || '', '', log.logData?.endTime || '', log.logData?.durationMinutes || ''];
                        case 'LEAVE_REQUEST_SUBMITTED':
                        case 'LEAVE_REQUEST_APPROVED':
                        case 'LEAVE_REQUEST_REJECTED':
                             return [...base, log.logData?.requestType || '', log.logData?.status || ''];
                        default:
                            return base;
                    }
                });
                worksheet.addRows(rowsToAdd);
            }
        }
        
        // 7. Save the workbook
        await workbook.xlsx.writeFile(EXCEL_FILE_PATH);
        console.log('Successfully wrote logs to Excel.');

        // 8. Mark the processed logs as 'synced' in MongoDB
        const syncedIds = logsToSync.map(log => log._id);
        await ExcelLog.updateMany(
            { _id: { $in: syncedIds } },
            { $set: { synced: true } }
        );
        console.log(`Marked ${syncedIds.length} logs as synced in the database.`);

    } catch (error) {
        console.error('An error occurred during the Excel sync job:', error);
    } finally {
        // 9. IMPORTANT: Always remove the lock file, even if an error occurred
        if (fs.existsSync(LOCK_FILE_PATH)) {
            fs.unlinkSync(LOCK_FILE_PATH);
        }
        console.log(`[${new Date().toISOString()}] Excel sync job finished.`);
    }
};

// --- Service Runner ---
const run = async () => {
    await connectDB();
    console.log('Excel Sync Service is running...');
    console.log(`Scheduled to run every 2 minutes. Waiting for the next cycle...`);

    // Schedule the job
    cron.schedule(CRON_SCHEDULE, syncLogsToExcel, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Set to your server's timezone
    });

    // Optional: Run once on startup
    // syncLogsToExcel();
};

run();