const express = require('express');
const router = express.Router();
const Shift = require('../models/Shift');

// GET /api/admin/shifts - Get all shifts with pagination
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const shifts = await Shift.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const totalCount = await Shift.countDocuments();

        res.json({
            shifts,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit)
        });
    } catch (error) {
        console.error('Error fetching shifts:', error);
        res.status(500).json({ error: 'Failed to fetch shifts' });
    }
});

// GET /api/admin/shifts/:id - Get a specific shift
router.get('/:id', async (req, res) => {
    try {
        const shift = await Shift.findById(req.params.id);
        if (!shift) {
            return res.status(404).json({ error: 'Shift not found' });
        }
        res.json(shift);
    } catch (error) {
        console.error('Error fetching shift:', error);
        res.status(500).json({ error: 'Failed to fetch shift' });
    }
});

// POST /api/admin/shifts - Create a new shift
router.post('/', async (req, res) => {
    try {
        const { shiftName, shiftType, startTime, endTime, durationHours, paidBreakMinutes } = req.body;

        // Validation
        if (!shiftName || !shiftType) {
            return res.status(400).json({ error: 'Shift name and type are required' });
        }

        if (shiftType === 'Fixed' && (!startTime || !endTime)) {
            return res.status(400).json({ error: 'Start time and end time are required for fixed shifts' });
        }

        // Check if shift name already exists
        const existingShift = await Shift.findOne({ shiftName });
        if (existingShift) {
            return res.status(400).json({ error: 'Shift name already exists' });
        }

        const shift = new Shift({
            shiftName,
            shiftType,
            startTime: shiftType === 'Fixed' ? startTime : null,
            endTime: shiftType === 'Fixed' ? endTime : null,
            durationHours: shiftType === 'Fixed' ? durationHours : null,
            paidBreakMinutes: paidBreakMinutes || 60
        });

        const savedShift = await shift.save();
        res.status(201).json(savedShift);
    } catch (error) {
        console.error('Error creating shift:', error);
        res.status(500).json({ error: 'Failed to create shift' });
    }
});

// PUT /api/admin/shifts/:id - Update a shift
router.put('/:id', async (req, res) => {
    try {
        const { shiftName, shiftType, startTime, endTime, durationHours, paidBreakMinutes } = req.body;

        // Validation
        if (!shiftName || !shiftType) {
            return res.status(400).json({ error: 'Shift name and type are required' });
        }

        if (shiftType === 'Fixed' && (!startTime || !endTime)) {
            return res.status(400).json({ error: 'Start time and end time are required for fixed shifts' });
        }

        // Check if shift name already exists (excluding current shift)
        const existingShift = await Shift.findOne({ 
            shiftName, 
            _id: { $ne: req.params.id } 
        });
        if (existingShift) {
            return res.status(400).json({ error: 'Shift name already exists' });
        }

        const updateData = {
            shiftName,
            shiftType,
            startTime: shiftType === 'Fixed' ? startTime : null,
            endTime: shiftType === 'Fixed' ? endTime : null,
            durationHours: shiftType === 'Fixed' ? durationHours : null,
            paidBreakMinutes: paidBreakMinutes || 60
        };

        const updatedShift = await Shift.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedShift) {
            return res.status(404).json({ error: 'Shift not found' });
        }

        res.json(updatedShift);
    } catch (error) {
        console.error('Error updating shift:', error);
        res.status(500).json({ error: 'Failed to update shift' });
    }
});

// DELETE /api/admin/shifts/:id - Delete a shift
router.delete('/:id', async (req, res) => {
    try {
        const shift = await Shift.findByIdAndDelete(req.params.id);
        if (!shift) {
            return res.status(404).json({ error: 'Shift not found' });
        }
        res.json({ message: 'Shift deleted successfully' });
    } catch (error) {
        console.error('Error deleting shift:', error);
        res.status(500).json({ error: 'Failed to delete shift' });
    }
});

module.exports = router;