// backend/services/excelLogger.js
const Excel = require('exceljs');
const path = require('path');
const fs = require('fs');
const auditLogger = require('./auditLogger');

// --- THE FIX IS HERE ---
// This path now correctly points to the 'reports' folder INSIDE the 'public' folder.
const REPORTS_DIR = path.join(__dirname, '..', 'public', 'reports');
const FILE_NAME = 'Attendance Logs - Default All Employees.xlsx';
const FILE_PATH = path.join(REPORTS_DIR, FILE_NAME);

class ExcelLogger {
    constructor() {
        this.queue = [];
        this.isWriting = false;
        this.initializeFile().catch(err => console.error("Initial Excel file check failed:", err));
    }

    async initializeFile() {
        try {
            // This will now create D:\attendance-system\backend\public\reports if it doesn't exist.
            if (!fs.existsSync(REPORTS_DIR)) {
                fs.mkdirSync(REPORTS_DIR, { recursive: true });
                await auditLogger.log(`Created public reports directory at: ${REPORTS_DIR}`);
            }

            if (!fs.existsSync(FILE_PATH)) {
                const workbook = new Excel.Workbook();
                await workbook.xlsx.writeFile(FILE_PATH);
                await auditLogger.log(`Excel file created at: ${FILE_PATH}`);
            }
        } catch (error) {
            console.error('Failed to initialize Excel file:', error);
            await auditLogger.log(`ERROR: Failed to initialize Excel file. ${error.message}`);
        }
    }
    
    // ... THE REST OF THE FILE REMAINS UNCHANGED ...
    logAttendance(data) {
        this.queue.push(data);
        this.processQueue();
    }

    async processQueue() {
        if (this.isWriting || this.queue.length === 0) {
            return;
        }
        this.isWriting = true;
        const data = this.queue.shift();

        try {
            await this._writeToExcel(data);
        } catch (error) {
            console.error(`Error writing to Excel for ${data.user.fullName}:`, error);
            await auditLogger.log(`ERROR processing queue for ${data.user.fullName}: ${error.message}`);
        } finally {
            this.isWriting = false;
            if (this.queue.length > 0) {
                this.processQueue();
            }
        }
    }

    async _writeToExcel(data) {
        const workbook = new Excel.Workbook();
        try {
            await workbook.xlsx.readFile(FILE_PATH);
        } catch (readError) {
            await auditLogger.log(`WARN: Could not read Excel file, it might be locked or missing. Attempting to re-initialize. Error: ${readError.message}`);
            await this.initializeFile();
            await workbook.xlsx.readFile(FILE_PATH);
        }
        
        const { user, attendanceDate, clockInTime, clockOutTime, shiftDurationMinutes } = data;
        
        const monthlySheetName = new Date(attendanceDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const userSheetName = `${user.employeeCode} - ${user.fullName}`.substring(0, 31);

        const monthlySheet = this.getOrCreateSheet(workbook, monthlySheetName);
        const userSheet = this.getOrCreateSheet(workbook, userSheetName);

        let status = 'Present';
        let durationStr = 'N/A';
        if (clockInTime && clockOutTime) {
            const durationMillis = new Date(clockOutTime) - new Date(clockInTime);
            const durationMinutes = Math.round(durationMillis / (1000 * 60));
            const hours = Math.floor(durationMinutes / 60);
            const mins = durationMinutes % 60;
            durationStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            
            if (durationMinutes >= 300 && durationMinutes < shiftDurationMinutes) {
                status = 'Half Day';
            }
        }
        
        const rowData = {
            date: attendanceDate,
            employeeCode: user.employeeCode,
            employeeName: user.fullName,
            status: status,
            clockIn: clockInTime ? new Date(clockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', hour12: false }) : 'N/A',
            clockOut: clockOutTime ? new Date(clockOutTime).toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', hour12: false }) : 'N/A',
            duration: durationStr
        };

        this.updateSheet(monthlySheet, rowData);
        this.updateSheet(userSheet, rowData);
        
        await workbook.xlsx.writeFile(FILE_PATH);
        await auditLogger.log(`Successfully logged attendance for ${user.fullName} on ${attendanceDate}. Status: ${status}`);
    }

    getOrCreateSheet(workbook, sheetName) {
        let sheet = workbook.getWorksheet(sheetName);
        if (!sheet) {
            sheet = workbook.addWorksheet(sheetName);
            this.setHeaders(sheet);
        }
        return sheet;
    }

    setHeaders(sheet) {
        sheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Employee Code', key: 'employeeCode', width: 20 },
            { header: 'Employee Name', key: 'employeeName', width: 30 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Clock In', key: 'clockIn', width: 15 },
            { header: 'Clock Out', key: 'clockOut', width: 15 },
            { header: 'Duration (HH:mm)', key: 'duration', width: 20 }
        ];
        sheet.getRow(1).font = { bold: true };
    }

    updateSheet(sheet, rowData) {
        let existingRowNumber = -1;
        for (let i = sheet.rowCount; i > 1; i--) {
            const row = sheet.getRow(i);
            if (row.getCell('date').value?.toString() === rowData.date && row.getCell('employeeCode').value?.toString() === rowData.employeeCode) {
                existingRowNumber = i;
                break;
            }
        }

        if (existingRowNumber > -1) {
            const row = sheet.getRow(existingRowNumber);
            row.values = { ...row.values, ...rowData };
            row.commit();
        } else {
            sheet.addRow(rowData);
        }
    }
}

module.exports = new ExcelLogger();