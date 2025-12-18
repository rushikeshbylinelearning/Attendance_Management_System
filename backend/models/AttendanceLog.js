// backend/models/AttendanceLog.js
const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attendanceDate: { type: String, required: true }, // YYYY-MM-DD
  clockInTime: { type: Date, required: true },
  clockOutTime: { type: Date },
  shiftDurationMinutes: { type: Number, required: true },
  penaltyMinutes: { type: Number, default: 0 },
  paidBreakMinutesTaken: { type: Number, default: 0 },
  // --- ADDED THIS FIELD to track unpaid breaks ---
  unpaidBreakMinutesTaken: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  // --- ANALYTICS FIELDS ---
  isLate: { type: Boolean, default: false },
  isHalfDay: { type: Boolean, default: false },
  lateMinutes: { type: Number, default: 0 },
  lateCount: { type: Number, default: 0 }, // Weekly late count
  attendanceStatus: { 
    type: String, 
    enum: ['On-time', 'Late', 'Half-day', 'Absent'], 
    default: 'On-time' 
  },
  totalWorkingHours: { type: Number, default: 0 }, // in hours
  adminOverride: { 
    type: String, 
    enum: ['None', 'Override Half Day', 'Override Late'], 
    default: 'None' 
  },
  overrideReason: { type: String, default: '' },
  // Track if late notification email has been sent
  lateNotificationSent: { type: Boolean, default: false }
}, { timestamps: true });

// Ensure a user can only have one log per day
attendanceLogSchema.index({ user: 1, attendanceDate: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);