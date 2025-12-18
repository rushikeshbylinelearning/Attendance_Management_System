// backend/utils/excelLogger.js
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Define the path for the Excel file inside a 'reports' directory for better organization.
const reportsDir = path.join(__dirname, '..', 'reports');
const filePath = path.join(reportsDir, 'Attendance Logs - All Employees.xlsx');

// --- In-memory queue and lock to handle concurrent requests safely ---
let taskQueue = [];
let isWriting = false;

// --- Helper function to format duration from minutes to HH:MM ---
function formatDuration(minutes) {
    if (isNaN(minutes) || minutes < 0) {
        return '00:00';
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    const paddedHours = String(hours).padStart(2, '0');
    const paddedMins = String(mins).padStart(2, '0');
    return `${paddedHours}:${paddedMins}`;
}

/**
 * The main function to process a single log entry from the queue.
 * @param {object} logData - The data to be logged.
 */
async function writeLog(logData) {
    console.log(`[ExcelLogger] Writing log for ${logData.employeeId} on ${logData.date}`);
    const workbook = new ExcelJS.Workbook();

    try {
        // Ensure the reports directory exists
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        
        // If the file exists, read it. Otherwise, a new workbook is already created.
        if (fs.existsSync(filePath)) {
            await workbook.xlsx.readFile(filePath);
        }

        const sheetName = `${logData.employeeCode} - ${logData.name}`;
        let worksheet = workbook.getWorksheet(sheetName);

        // If the worksheet for the employee doesn't exist, create it with headers.
        if (!worksheet) {
            worksheet = workbook.addWorksheet(sheetName);
            worksheet.columns = [
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Employee ID', key: 'employeeCode', width: 15 },
                { header: 'Name', key: 'name', width: 25 },
                { header: 'Clock In', key: 'checkIn', width: 20 },
                { header: 'Clock Out', key: 'checkOut', width: 20 },
                { header: 'Work Duration (HH:MM)', key: 'duration', width: 25 },
                { header: 'Status', key: 'status', width: 15 },
            ];
            // Make header bold
            worksheet.getRow(1).font = { bold: true };
        }

        // --- Find and update or add new row ---
        let existingRow = null;
        worksheet.eachRow((row, rowNumber) => {
            if (row.getCell('date').value === logData.date && rowNumber > 1) {
                existingRow = row;
            }
        });
        
        const rowData = {
            date: logData.date,
            employeeCode: logData.employeeCode,
            name: logData.name,
            checkIn: logData.checkIn ? new Date(logData.checkIn).toLocaleTimeString('en-US') : '',
            checkOut: logData.checkOut ? new Date(logData.checkOut).toLocaleTimeString('en-US') : '',
            duration: formatDuration(logData.durationMinutes),
            status: logData.status,
        };

        if (existingRow) {
            // Update the existing row for the day
            existingRow.values = rowData;
        } else {
            // Add a new row
            worksheet.addRow(rowData);
        }

        // Write the updated workbook back to the file
        await workbook.xlsx.writeFile(filePath);
        console.log(`[ExcelLogger] Successfully updated Excel for ${logData.employeeId}`);

    } catch (error) {
        // Log errors but don't crash the server
        console.error('[ExcelLogger] Error writing to Excel file:', error);
    }
}

/**
 * Processes the queue of logging tasks one by one.
 */
async function processQueue() {
    if (isWriting || taskQueue.length === 0) {
        return; // Either busy or nothing to do
    }
    isWriting = true;
    
    // Dequeue the next task
    const logTask = taskQueue.shift();

    // Add the requested 1-2 second delay to minimize file lock conflicts
    await new Promise(resolve => setTimeout(resolve, 1500));

    await writeLog(logTask);

    isWriting = false;

    // If there are more items, process the next one
    processQueue();
}

/**
 * Public function to add a log task to the queue.
 * This is the function that will be called from the routes.
 * @param {object} logData - The data object to be logged.
 */
function logToExcel(logData) {
    taskQueue.push(logData);
    processQueue(); // Trigger the queue processor
}

module.exports = { logToExcel };