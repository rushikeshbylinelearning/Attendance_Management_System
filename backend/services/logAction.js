// backend/services/logAction.js
const ExcelLog = require('../models/ExcelLog');

/**
 * Inserts a log entry into the excel_logs collection for background processing.
 * This function is designed to be "fire-and-forget" from the API route's perspective.
 * It handles its own errors to prevent crashing the main request flow.
 *
 * @param {string} userId - The mongoose.Types.ObjectId of the user.
 * @param {string} logType - The type of log (e.g., 'LOGIN_SUCCESS', 'CLOCK_IN'). Must match the enum in ExcelLog model.
 * @param {object} logData - An object containing any extra information relevant to the log.
 */
const logAction = async (userId, logType, logData = {}) => {
    try {
        if (!userId || !logType) {
            console.error('logAction Error: userId and logType are required.');
            return;
        }

        await ExcelLog.create({
            user: userId,
            logType,
            logData,
            synced: false
        });

    } catch (error) {
        // Log the error but do not throw it, to avoid impacting the user-facing request.
        console.error(`Failed to create Excel log entry for type "${logType}"`, error);
    }
};

module.exports = { logAction };