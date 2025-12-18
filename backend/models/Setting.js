// backend/models/Setting.js

const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
    // A unique key to identify the setting, e.g., 'hrNotificationEmails'
    key: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    // A flexible value field. For our use case, it will be an array of strings.
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('Setting', SettingSchema);