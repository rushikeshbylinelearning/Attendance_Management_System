// backend/watcher.js
require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const msal = require('@azure/msal-node');

// --- Pre-load Mongoose models ---
// This ensures they are available for the aggregation pipeline.
const AttendanceLog = require('./models/AttendanceLog');
const User = require('./models/User');

// --- Configuration from .env file ---
const MONGODB_URI = process.env.MONGODB_URI;
const LOCAL_EXCEL_PATH = process.env.LOCAL_EXCEL_PATH || './exports/Attendance.xlsx';
const SHARED_EXCEL_PATH = process.env.SHARED_EXCEL_PATH; // e.g., '\\\\shared-server\\reports\\Attendance.xlsx'
const ENABLE_ONEDRIVE_UPLOAD = process.env.ENABLE_ONEDRIVE_UPLOAD === 'true';

// OneDrive Configuration
const oneDriveConfig = {
    clientId: process.env.ONEDRIVE_CLIENT_ID,
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
    tenantId: process.env.ONEDRIVE_TENANT_ID,
    siteId: process.env.ONEDRIVE_SITE_ID, // ID of the SharePoint site
    driveId: process.env.ONEDRIVE_DRIVE_ID, // ID of the Document Library (Drive)
    folderPath: process.env.ONEDRIVE_FOLDER_PATH || 'Shared Documents', // e.g., 'Shared Documents/Attendance'
    fileName: process.env.ONEDRIVE_FILENAME || 'Attendance.xlsx'
};

const msalConfig = {
    auth: {
        clientId: oneDriveConfig.clientId,
        authority: `https://login.microsoftonline.com/${oneDriveConfig.tenantId}`,
        clientSecret: oneDriveConfig.clientSecret,
    }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Acquires an access token from Azure AD for Microsoft Graph API.
 * @returns {Promise<string>} The access token.
 */
async function getGraphAccessToken() {
    const tokenRequest = {
        scopes: ['https://graph.microsoft.com/.default'],
    };
    try {
        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        return response.accessToken;
    } catch (error) {
        console.error("❌ Failed to acquire Graph API token:", error.message);
        throw error;
    }
}

/**
 * Uploads a file to a specific SharePoint/OneDrive location.
 * @param {string} filePath - The local path of the file to upload.
 */
async function uploadToOneDrive(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ OneDrive Upload: File not found at ${filePath}`);
        return;
    }

    try {
        console.log("... Acquiring access token for OneDrive upload.");
        const accessToken = await getGraphAccessToken();
        const fileContent = fs.readFileSync(filePath);

        // Construct the Graph API URL for uploading to a specific folder in a SharePoint site's drive
        const url = `https://graph.microsoft.com/v1.0/sites/${oneDriveConfig.siteId}/drives/${oneDriveConfig.driveId}/root:/${oneDriveConfig.folderPath}/${oneDriveConfig.fileName}:/content`;
        
        console.log(`... Uploading to OneDrive URL: ${url}`);

        await axios.put(url, fileContent, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        });
        console.log("✅ Successfully uploaded to OneDrive.");
    } catch (error) {
        console.error("❌ OneDrive upload failed:", error.response ? error.response.data : error.message);
    }
}

/**
 * Fetches all attendance data and exports it to an Excel file.
 * Overwrites the file if it exists.
 */
async function exportToExcel() {
    console.log("... Change detected. Starting Excel export process.");
    try {
        console.log("... Fetching latest attendance data from MongoDB.");
        // Use an aggregation pipeline to join user data and format fields
        const attendanceData = await AttendanceLog.aggregate([
            { $sort: { attendanceDate: -1, clockInTime: -1 } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'employeeInfo'
                }
            },
            { $unwind: '$employeeInfo' },
            {
                $lookup: {
                    from: 'breaklogs',
                    localField: '_id',
                    foreignField: 'attendanceLog',
                    as: 'breaks'
                }
            },
            {
                $project: {
                    _id: 0, // Exclude the default _id
                    employeeId: '$employeeInfo.employeeCode',
                    name: '$employeeInfo.fullName',
                    date: '$attendanceDate',
                    checkInTime: { $ifNull: [ { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: "$clockInTime", timezone: "UTC" } }, 'N/A' ] },
                    checkOutTime: { $ifNull: [ { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: "$clockOutTime", timezone: "UTC" } }, 'N/A' ] },
                    status: { $ifNull: [ '$status', 'Present' ] }, // Add a default status if needed
                    breakInTime: { $ifNull: [ { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: { $first: '$breaks.startTime' }, timezone: "UTC" } }, 'N/A' ] },
                    breakOutTime: { $ifNull: [ { $dateToString: { format: "%Y-%m-%d %H:%M:%S", date: { $first: '$breaks.endTime' }, timezone: "UTC" } }, 'N/A' ] }
                }
            }
        ]);

        if (attendanceData.length === 0) {
            console.log("... No attendance data found. Skipping Excel export.");
            return;
        }

        console.log(`... Found ${attendanceData.length} records to export.`);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Attendance');

        worksheet.columns = [
            { header: 'Employee ID', key: 'employeeId', width: 15 },
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Check-In Time', key: 'checkInTime', width: 25 },
            { header: 'Check-Out Time', key: 'checkOutTime', width: 25 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Break-In Time', key: 'breakInTime', width: 25 },
            { header: 'Break-Out Time', key: 'breakOutTime', width: 25 }
        ];

        // Style the header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        worksheet.addRows(attendanceData);

        // --- Save to Local Path ---
        const localDir = path.dirname(LOCAL_EXCEL_PATH);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        await workbook.xlsx.writeFile(LOCAL_EXCEL_PATH);
        console.log(`✅ Excel file saved locally to: ${LOCAL_EXCEL_PATH}`);

        // --- Save to Shared Drive Path ---
        if (SHARED_EXCEL_PATH) {
            try {
                const sharedDir = path.dirname(SHARED_EXCEL_PATH);
                if (!fs.existsSync(sharedDir)) {
                    console.warn(`... Shared directory ${sharedDir} does not exist. Trying to create it.`);
                    // NOTE: This might fail due to permissions on a network drive.
                    fs.mkdirSync(sharedDir, { recursive: true });
                }
                await workbook.xlsx.writeFile(SHARED_EXCEL_PATH);
                console.log(`✅ Excel file saved to shared drive: ${SHARED_EXCEL_PATH}`);
            } catch (err) {
                console.error(`❌ Failed to write to shared path ${SHARED_EXCEL_PATH}. Check permissions.`, err.message);
            }
        }
        
        // --- Upload to OneDrive ---
        if (ENABLE_ONEDRIVE_UPLOAD) {
            await uploadToOneDrive(LOCAL_EXCEL_PATH);
        }

    } catch (error) {
        console.error("❌ An error occurred during the export process:", error);
    }
}

/**
 * Main function to connect to MongoDB and start the watcher.
 */
async function startWatcher() {
    console.log("🚀 Starting Attendance Watcher Service...");

    if (!MONGODB_URI) {
        console.error("❌ MONGODB_URI is not defined in the .env file. Exiting.");
        process.exit(1);
    }
    
    // Initial export on startup
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB connected for initial export.');
        await exportToExcel();
        await mongoose.disconnect();
        console.log('... MongoDB disconnected after initial export.');
    } catch (error) {
        console.error("❌ Could not perform initial export:", error.message);
    }


    // Reconnect and start watching for changes
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB connected for change stream watching.');
        
        const changeStream = AttendanceLog.watch();
        
        changeStream.on('change', async (change) => {
            console.log("\n--- Change Detected ---");
            console.log(`Operation Type: ${change.operationType}`);
            // We regenerate the full report on any relevant change.
            if (['insert', 'update', 'replace', 'delete'].includes(change.operationType)) {
                await exportToExcel();
            }
            console.log("-----------------------\n");
        });

        changeStream.on('error', (error) => {
            console.error("❌ Change stream error:", error);
            // Optional: Implement a restart mechanism here
            console.log("... Attempting to restart watcher in 10 seconds.");
            setTimeout(startWatcher, 10000);
        });

        console.log("... Watcher is now listening for changes in the 'attendancelogs' collection.");

    } catch (error) {
        console.error("❌ Failed to connect to MongoDB for watching:", error.message);
        console.log("... Retrying connection in 10 seconds.");
        setTimeout(startWatcher, 10000); // Retry connection after 10 seconds
    }
}

startWatcher();