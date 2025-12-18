// backend/models/OfficeLocation.js
const mongoose = require('mongoose');

const officeLocationSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 100
    },
    address: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 200
    },
    latitude: { 
        type: Number, 
        required: true,
        min: -90,
        max: 90
    },
    longitude: { 
        type: Number, 
        required: true,
        min: -180,
        max: 180
    },
    radius: { 
        type: Number, 
        required: true, 
        default: 100, // radius in meters
        min: 10,
        // --- START OF FIX ---
        max: 100000 // Increased maximum value to 100,000
        // --- END OF FIX ---
    },
    isActive: { 
        type: Boolean, 
        default: true 
    },
    description: { 
        type: String,
        trim: true,
        maxlength: 500
    }
}, { 
    timestamps: true 
});

// Index for geospatial queries
officeLocationSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('OfficeLocation', officeLocationSchema);