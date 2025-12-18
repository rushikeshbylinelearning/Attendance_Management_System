// backend/models/ExtraBreakRequest.js
const mongoose = require('mongoose');

const extraBreakRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attendanceLog: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceLog', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  isUsed: { type: Boolean, default: false }, // <-- ADDED THIS LINE
}, { timestamps: true });

module.exports = mongoose.model('ExtraBreakRequest', extraBreakRequestSchema);