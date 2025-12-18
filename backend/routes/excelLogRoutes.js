// backend/routes/excelLogRoutes.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const { getSheetNames, getSheetData } = require('../services/excelLogService');

const isAdminOrHr = (req, res, next) => {
    if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin or HR role.' });
    }
    next();
};

// @route   GET /api/admin/reports/excel-log/sheets
// @desc    Get all sheet names from the attendance log Excel file
// @access  Private (Admin/HR)
router.get('/excel-log/sheets', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const sheetNames = await getSheetNames();
        res.json(sheetNames);
    } catch (error) {
        console.error('Error fetching Excel sheet names:', error);
        res.status(500).json({ error: 'Failed to retrieve sheet names.' });
    }
});

// @route   GET /api/admin/reports/excel-log/sheet-data
// @desc    Get all data from a specific sheet
// @access  Private (Admin/HR)
router.get('/excel-log/sheet-data', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { sheetName } = req.query;
    if (!sheetName) {
        return res.status(400).json({ error: 'sheetName query parameter is required.' });
    }
    try {
        const data = await getSheetData(sheetName);
        res.json(data);
    } catch (error) {
        console.error(`Error fetching data for sheet ${sheetName}:`, error);
        res.status(500).json({ error: 'Failed to retrieve sheet data.' });
    }
});

module.exports = router;