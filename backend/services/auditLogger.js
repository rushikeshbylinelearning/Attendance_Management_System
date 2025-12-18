// backend/services/auditLogger.js
const fs = require('fs').promises;
const path = require('path');

// log.txt will be created in the backend root directory
const logFilePath = path.join(__dirname, '..', '..', 'log.txt');

const log = async (message) => {
    const timestamp = new Date().toISOString();
    try {
        await fs.appendFile(logFilePath, `${timestamp} - ${message}\n`);
    } catch (error) {
        // Fallback to console if file logging fails
        console.error('Failed to write to audit log file:', error);
        console.log(`AUDIT LOG: ${timestamp} - ${message}`);
    }
};

const logAction = async (actionData) => {
    const timestamp = new Date().toISOString();
    const message = `ACTION: ${actionData.action} - User: ${actionData.userId} - Details: ${JSON.stringify(actionData.details)}`;
    
    try {
        await fs.appendFile(logFilePath, `${timestamp} - ${message}\n`);
    } catch (error) {
        // Fallback to console if file logging fails
        console.error('Failed to write to audit log file:', error);
        console.log(`AUDIT LOG: ${timestamp} - ${message}`);
    }
};

module.exports = { log, logAction };