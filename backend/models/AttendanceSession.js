// backend/models/AttendanceSession.js
const mongoose = require('mongoose');

const attendanceSessionSchema = new mongoose.Schema({
  attendanceLog: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceLog', required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date }, // null if session is still active
}, { timestamps: true });

module.exports = mongoose.model('AttendanceSession', attendanceSessionSchema);