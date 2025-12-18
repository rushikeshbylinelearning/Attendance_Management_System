// backend/models/BreakLog.js
const mongoose = require('mongoose');

const breakLogSchema = new mongoose.Schema({
  attendanceLog: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceLog' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['Paid', 'Unpaid', 'Extra', 'Auto-Unpaid-Break'], required: true },
  breakType: { type: String, enum: ['Paid', 'Unpaid', 'Extra'], required: true }, // Keep for backward compatibility
  startTime: { type: Date, required: true },
  endTime: { type: Date }, // null if active
  durationMinutes: { type: Number, default: 0 },
  reason: { type: String },
  isAutoBreak: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('BreakLog', breakLogSchema);