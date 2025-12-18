// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'HR', 'Employee', 'Intern'], default: 'Employee' },
  authMethod: { type: String, enum: ['local', 'SSO'], default: 'local' },
  domain: { type: String },
  designation: { type: String },
  department: { type: String },
  joiningDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  accountLocked: { type: Boolean, default: false },
  lockedReason: { type: String },
  lockedAt: { type: Date },
  unlockedAt: { type: Date },
  unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  shiftGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  profileImageUrl: { type: String, default: '' }, 
  alternateSaturdayPolicy: {
    type: String,
    enum: ['Week 1 & 3 Off', 'Week 2 & 4 Off', 'All Saturdays Working', 'All Saturdays Off'],
    default: 'All Saturdays Working'
  },
  employmentStatus: {
    type: String,
    enum: ['Intern', 'Probation', 'Permanent'],
    default: 'Probation'
  },
  // --- PROBATION TRACKING FIELDS ---
  employeeType: { 
    type: String, 
    enum: ['Intern', 'On-Role'], 
    default: 'On-Role' 
  },
  probationStatus: { 
    type: String, 
    enum: ['None', 'On Probation', 'Permanent'], 
    default: 'None' 
  },
  probationStartDate: { type: Date, default: null },
  probationEndDate: { type: Date, default: null },
  probationDurationMonths: { type: Number, default: null },
  conversionDate: { type: Date, default: null }, // Date when intern was converted to on-role
  // Leave balances for permanent employees: 6 sick, 6 casual, 10 planned (paid)
  // Note: These defaults apply to new users. For permanent employees, balances should be:
  // - sick: 6 days
  // - casual: 6 days  
  // - paid: 10 days (for planned leaves)
  leaveBalances: {
    sick: { type: Number, default: 6 },
    casual: { type: Number, default: 6 },
    paid: { type: Number, default: 10 }
  },
  leaveEntitlements: {
    sick: { type: Number, default: 6 },
    casual: { type: Number, default: 6 },
    paid: { type: Number, default: 10 }
  },
  internshipDurationMonths: { 
    type: Number, 
    default: null 
  },
  workingDays: {
    type: [String],
    enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  },
  // --- FEATURE PERMISSIONS ---
  featurePermissions: {
    // Core feature toggles
    leaves: { type: Boolean, default: true },
    breaks: { type: Boolean, default: true },
    extraFeatures: { type: Boolean, default: false },
    
    // Break management - Time-based restrictions
    maxBreaks: { type: Number, default: 999, min: 0 }, // Effectively unlimited
    breakAfterHours: { type: Number, default: 0, min: 0 }, // Can take break immediately
    
    // Break time windows - New time-based restrictions
    breakWindows: [{
      type: { 
        type: String, 
        enum: ['Paid', 'Unpaid', 'Extra'], // <-- MODIFIED ENUM
        required: true 
      },
      name: { type: String, required: true }, // Display name like "Lunch Break", "Tea Break"
      startTime: { type: String, required: true }, // Format: "HH:MM" (24-hour)
      endTime: { type: String, required: true }, // Format: "HH:MM" (24-hour)
      isActive: { type: Boolean, default: true }
    }],
    
    // UI controls
    canCheckIn: { type: Boolean, default: true },
    canCheckOut: { type: Boolean, default: true },
    canTakeBreak: { type: Boolean, default: true },
    
    // Analytics access control
    canViewAnalytics: { type: Boolean, default: false },
    
    // Privilege levels: 'restricted', 'normal', 'advanced'
    privilegeLevel: { 
      type: String, 
      enum: ['restricted', 'normal', 'advanced'], 
      default: 'normal' 
    },
    
    // Additional restrictions for restricted users
    restrictedFeatures: {
      type: {
        canViewReports: { type: Boolean, default: false },
        canViewOtherLogs: { type: Boolean, default: false },
        canEditProfile: { type: Boolean, default: true },
        canRequestExtraBreak: { type: Boolean, default: true }
      },
      default: {}
    },
    
    // Advanced features for advanced users
    advancedFeatures: {
      type: {
        canBulkActions: { type: Boolean, default: false },
        canExportData: { type: Boolean, default: false }
      },
      default: {}
    },

    // Auto-break on inactivity settings
    autoBreakOnInactivity: { type: Boolean, default: false },
    inactivityThresholdMinutes: { type: Number, default: 5, min: 1, max: 60 }
  }
}, { timestamps: true });


module.exports = mongoose.model('User', userSchema);