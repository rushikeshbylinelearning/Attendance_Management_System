// backend/models/Shift.js
const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  shiftName: { type: String, required: true },
  shiftType: { type: String, enum: ['Fixed', 'Flexible'], required: true },
  startTime: { type: String }, // "HH:mm"
  endTime: { type: String },   // "HH:mm"
  durationHours: { type: Number, required: true },
  paidBreakMinutes: { type: Number, default: 60 },
}, { timestamps: true });

shiftSchema.pre('save', function(next) {
  // --- THE FIX IS HERE ---
  // This logic is now more robust. It checks if relevant fields were changed.
  if (this.isModified('shiftType') || this.isModified('startTime') || this.isModified('endTime')) {
    if (this.shiftType === 'Fixed' && this.startTime && this.endTime) {
      try {
        const [startH, startM] = this.startTime.split(':').map(Number);
        const [endH, endM] = this.endTime.split(':').map(Number);

        const startDate = new Date(0, 0, 0, startH, startM, 0);
        const endDate = new Date(0, 0, 0, endH, endM, 0);

        let diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
        if (diffHours < 0) {
          diffHours += 24; // Handle overnight shifts
        }
        
        this.durationHours = diffHours;
      } catch (e) {
        console.error("Could not parse time for duration calculation", e);
        // Decide on fallback behavior, maybe set duration to 0 or based on type
        this.durationHours = 0;
      }
    } else if (this.shiftType === 'Flexible') {
        // For flexible shifts, ensure start and end times are cleared as they are not applicable.
        this.startTime = null;
        this.endTime = null;
    }
  }
  next();
});

module.exports = mongoose.model('Shift', shiftSchema);