// backend/services/excelService.js

const exceljs = require('exceljs');
const path = require('path');
const fs = require('fs/promises');

// Define the path for the Excel file and the headers
const excelFilePath = path.join(__dirname, '..', 'exports', 'Attendance.xlsx');
const headers = [
    { header: 'Employee ID', key: 'employeeId', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Check-In Time', key: 'checkInTime', width: 20 },
    { header: 'Check-Out Time', key: 'checkOutTime', width: 20 },
    { header: 'Break-In Time', key: 'breakInTime', width: 20 },
    { header: 'Break-Out Time', key: 'breakOutTime', width: 20 },
];

/**
 * Appends a new attendance record to the Attendance.xlsx file.
 * Creates the file and directory if they don't exist.
 * @param {object} attendanceData - The data for the new row.
 * @returns {Promise<void>}
 */
const appendToAttendanceExcel = async (attendanceData) => {
    try {
        // Ensure the 'exports' directory exists
        const dir = path.dirname(excelFilePath);
        await fs.mkdir(dir, { recursive: true });

        const workbook = new exceljs.Workbook();
        let worksheet;

        try {
            // Try to read the existing workbook
            await workbook.xlsx.readFile(excelFilePath);
            worksheet = workbook.getWorksheet('Attendance');
            if (!worksheet) {
                // This case handles a corrupted file that exists but has no sheet
                throw new Error('Worksheet not found, recreating.');
            }
        } catch (error) {
            // If file doesn't exist or is corrupt, create a new one
            console.log('Excel file not found or is invalid. Creating a new one.');
            worksheet = workbook.addWorksheet('Attendance');
            worksheet.columns = headers;
            // Make the header row bold
            worksheet.getRow(1).font = { bold: true };
        }
        
        // Format dates for better readability in Excel
        const rowData = {
            ...attendanceData,
            checkInTime: attendanceData.checkInTime ? new Date(attendanceData.checkInTime).toLocaleString() : '',
            checkOutTime: attendanceData.checkOutTime ? new Date(attendanceData.checkOutTime).toLocaleString() : '',
            breakInTime: attendanceData.breakInTime ? new Date(attendanceData.breakInTime).toLocaleString() : '',
            breakOutTime: attendanceData.breakOutTime ? new Date(attendanceData.breakOutTime).toLocaleString() : '',
        };

        // Add the new row
        worksheet.addRow(rowData);

        // Write the updated workbook back to the file
        await workbook.xlsx.writeFile(excelFilePath);
        console.log(`Successfully appended attendance log to ${excelFilePath}`);

    } catch (error) {
        console.error('Error writing to Excel file:', error);
        // We log the error but don't re-throw it, so the main API flow is not interrupted.
    }
};

module.exports = {
    appendToAttendanceExcel,
};