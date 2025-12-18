// backend/models/LeaveRequest.js
const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestType: {
        type: String,
        // --- START OF FIX: Added 'Casual' to the enum ---
        enum: ['Planned', 'Sick', 'Unpaid', 'Compensatory', 'Backdated Leave', 'Casual'],
        // --- END OF FIX ---
        required: true,
    },
    leaveType: {
        type: String,
        enum: ['Full Day', 'Half Day - First Half', 'Half Day - Second Half'],
        default: 'Full Day',
    },
    leaveDates: [{ type: Date, required: true }],
    alternateDate: { type: Date }, // Specifically for 'Compensatory' type
    reason: { type: String, required: true },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending',
    },
    isBackdated: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectionNotes: { type: String }, // Notes provided when rejecting a leave request
    medicalCertificate: { type: String }, // URL/path to medical certificate file (required for Sick leave)
    appliedAfterReturn: { type: Boolean, default: false }, // For sick leave tracking
    halfYearPeriod: { 
        type: String, 
        enum: ['First Half', 'Second Half'], 
        // Tracks which half of the year for Planned leaves (Jan-Jun or Jul-Dec)
    },
}, { timestamps: true });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);