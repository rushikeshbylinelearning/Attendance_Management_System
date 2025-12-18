// backend/routes/settingsRoutes.js

const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
// You should protect these routes with admin-level authentication in a real app
// const authMiddleware = require('../middleware/auth');
// const adminMiddleware = require('../middleware/admin');

const HR_EMAIL_KEY = 'hrNotificationEmails';
const HIRING_EMAIL_KEY = 'hiringNotificationEmails';

// GET /api/admin/settings/hr-emails - Get the list of HR emails
router.get('/hr-emails', async (req, res) => {
    try {
        const setting = await Setting.findOne({ key: HR_EMAIL_KEY });
        res.json(setting ? setting.value : []); // Return emails array or empty array if not found
    } catch (error) {
        res.status(500).json({ error: 'Server error fetching email settings.' });
    }
});

// POST /api/admin/settings/hr-emails - Add a new email to the list
router.post('/hr-emails', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const updatedSetting = await Setting.findOneAndUpdate(
            { key: HR_EMAIL_KEY },
            // $addToSet adds the email only if it's not already in the array
            { $addToSet: { value: email } },
            // { upsert: true } creates the document if it doesn't exist
            // { new: true } returns the updated document
            { upsert: true, new: true }
        );
        res.json(updatedSetting.value);
    } catch (error) {
        res.status(500).json({ error: 'Server error adding email.' });
    }
});

// DELETE /api/admin/settings/hr-emails - Remove an email from the list
router.delete('/hr-emails', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const updatedSetting = await Setting.findOneAndUpdate(
            { key: HR_EMAIL_KEY },
            // $pull removes the specified email from the array
            { $pull: { value: email } },
            { new: true }
        );
        res.json(updatedSetting ? updatedSetting.value : []);
    } catch (error) {
        res.status(500).json({ error: 'Server error deleting email.' });
    }
});

// GET /api/admin/settings/hiring-emails - Get the list of hiring emails
router.get('/hiring-emails', async (req, res) => {
    try {
        const setting = await Setting.findOne({ key: HIRING_EMAIL_KEY });
        res.json(setting ? setting.value : []); // Return emails array or empty array if not found
    } catch (error) {
        res.status(500).json({ error: 'Server error fetching hiring email settings.' });
    }
});

// POST /api/admin/settings/hiring-emails - Add a new email to the hiring list
router.post('/hiring-emails', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const updatedSetting = await Setting.findOneAndUpdate(
            { key: HIRING_EMAIL_KEY },
            // $addToSet adds the email only if it's not already in the array
            { $addToSet: { value: email } },
            // { upsert: true } creates the document if it doesn't exist
            // { new: true } returns the updated document
            { upsert: true, new: true }
        );
        res.json(updatedSetting.value);
    } catch (error) {
        res.status(500).json({ error: 'Server error adding hiring email.' });
    }
});

// DELETE /api/admin/settings/hiring-emails - Remove an email from the hiring list
router.delete('/hiring-emails', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const updatedSetting = await Setting.findOneAndUpdate(
            { key: HIRING_EMAIL_KEY },
            // $pull removes the specified email from the array
            { $pull: { value: email } },
            { new: true }
        );
        res.json(updatedSetting ? updatedSetting.value : []);
    } catch (error) {
        res.status(500).json({ error: 'Server error deleting hiring email.' });
    }
});

module.exports = router;