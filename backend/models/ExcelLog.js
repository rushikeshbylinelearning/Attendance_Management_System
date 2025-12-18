// backend/models/ExcelLog.js
const mongoose = require('mongoose');

const excelLogSchema = new mongoose.Schema({
    // Reference to the user who performed the action
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Type of action, used to route the log to the correct Excel sheet
    logType: {
        type: String,
        required: true,
        enum: [
            'LOGIN_SUCCESS', 'LOGIN_FAIL',
            'CLOCK_IN', 'CLOCK_OUT',
            'BREAK_START', 'BREAK_END',
            'AUTO_BREAK_START', 'AUTO_BREAK_END',
            'LEAVE_REQUEST_SUBMITTED', 'LEAVE_REQUEST_APPROVED', 'LEAVE_REQUEST_REJECTED',
            'MARK_HALF_DAY', 'UNMARK_HALF_DAY'
            // Add more types as needed
        ],
        index: true
    },

    // Flexible field to store action-specific data
    logData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

    // Flag to track if this log has been written to the Excel file
    synced: {
        type: Boolean,
        default: false,
        required: true,
        index: true // IMPORTANT for fast querying of unsynced logs
    }
}, { timestamps: true }); // `createdAt` will serve as the timestamp for the log

module.exports = mongoose.model('ExcelLog', excelLogSchema);