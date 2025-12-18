// backend/models/WeeklyLateTracking.js
const mongoose = require('mongoose');

const weeklyLateTrackingSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true 
  },
  weekStartDate: { 
    type: String, 
    required: true, 
    index: true 
  }, // YYYY-MM-DD format
  weekEndDate: { 
    type: String, 
    required: true 
  }, // YYYY-MM-DD format
  lateCount: { 
    type: Number, 
    default: 0 
  },
  lateDates: [{ 
    type: String 
  }], // Array of dates when user was late
  isAccountLocked: { 
    type: Boolean, 
    default: false 
  },
  lockedAt: { 
    type: Date 
  },
  unlockedAt: { 
    type: Date 
  },
  unlockedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  unlockReason: { 
    type: String 
  }
}, { 
  timestamps: true 
});

// Compound index for efficient queries
weeklyLateTrackingSchema.index({ user: 1, weekStartDate: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyLateTracking', weeklyLateTrackingSchema);

