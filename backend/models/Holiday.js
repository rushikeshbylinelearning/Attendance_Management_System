// backend/models/Holiday.js
const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    date: {
        type: Date,
        required: true,
        unique: true, // Prevent duplicate holidays on the same date
    },
}, { timestamps: true });

module.exports = mongoose.model('Holiday', holidaySchema);