// backend/routes/officeLocations.js
const express = require('express');
const OfficeLocation = require('../models/OfficeLocation');
const authenticateToken = require('../middleware/authenticateToken');
const { geofencingMiddleware } = require('../middleware/geofencingMiddleware');
const mongoose = require('mongoose');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get all office locations (Admin/HR only)
router.get('/', async (req, res) => {
    try {
        // Only Admin and HR can view office locations
        if (req.user.role !== 'Admin' && req.user.role !== 'HR') {
            return res.status(403).json({ error: 'Access denied. Admin/HR privileges required.' });
        }

        const locations = await OfficeLocation.find({ isActive: true }).sort({ createdAt: -1 });
        res.json(locations);
    } catch (error) {
        console.error('Error fetching office locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific office location (Admin/HR only)
router.get('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid office location ID format.' });
        }

        // Only Admin and HR can view office locations
        if (req.user.role !== 'Admin' && req.user.role !== 'HR') {
            return res.status(403).json({ error: 'Access denied. Admin/HR privileges required.' });
        }

        const location = await OfficeLocation.findById(req.params.id);
        if (!location) {
            return res.status(404).json({ error: 'Office location not found' });
        }
        res.json(location);
    } catch (error) {
        console.error('Error fetching office location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new office location (Admin only)
router.post('/', async (req, res) => {
    try {
        // Only Admin can create office locations
        if (req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        const { name, address, latitude, longitude, radius, description } = req.body;

        // Validate required fields
        if (!name || !address || !latitude || !longitude) {
            return res.status(400).json({ 
                error: 'Name, address, latitude, and longitude are required' 
            });
        }

        // Validate coordinates
        if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ 
                error: 'Invalid coordinates' 
            });
        }

        const location = new OfficeLocation({
            name,
            address,
            latitude,
            longitude,
            radius: radius || 100,
            description
        });

        await location.save();
        res.status(201).json(location);
    } catch (error) {
        console.error('Error creating office location:', error);
        // --- START OF FIX (Consistency with PUT route) ---
        if (error.code === 11000) {
            return res.status(400).json({ error: 'An office location with this name already exists.' });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ error: messages[0] });
        }
        // --- END OF FIX ---
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update office location (Admin only)
router.put('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid office location ID format.' });
        }

        // Only Admin can update office locations
        if (req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        const { name, address, latitude, longitude, radius, description, isActive } = req.body;

        // Validate coordinates if provided
        if (latitude !== undefined && longitude !== undefined) {
            if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
                latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
                return res.status(400).json({ 
                    error: 'Invalid coordinates' 
                });
            }
        }

        const location = await OfficeLocation.findByIdAndUpdate(
            req.params.id,
            { name, address, latitude, longitude, radius, description, isActive },
            { new: true, runValidators: true }
        );

        if (!location) {
            return res.status(404).json({ error: 'Office location not found' });
        }

        res.json(location);
    } catch (error) {
        // --- START OF FIX (Added Duplicate Key Error Handling) ---
        // Handle specific Mongoose errors to provide better feedback
        if (error.code === 11000) {
            return res.status(400).json({ error: 'An office location with this name already exists.' });
        }
        if (error.name === 'ValidationError') {
            // Extracts the first validation error message
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ error: messages[0] });
        }
        console.error('Error updating office location:', error);
        res.status(500).json({ error: 'Internal server error' });
        // --- END OF FIX ---
    }
});

// Delete office location (Admin only)
router.delete('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid office location ID format.' });
        }

        // Only Admin can delete office locations
        if (req.user.role !== 'Admin') {
            return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
        }

        const location = await OfficeLocation.findByIdAndDelete(req.params.id);
        if (!location) {
            return res.status(404).json({ error: 'Office location not found' });
        }

        res.json({ message: 'Office location deleted successfully' });
    } catch (error) {
        console.error('Error deleting office location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check current location against geofence (for testing)
router.post('/check-location', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ 
                error: 'Latitude and longitude are required' 
            });
        }

        const { checkGeofence } = require('../services/geofencingService');
        const result = await checkGeofence(latitude, longitude, req.user.role);

        res.json(result);
    } catch (error) {
        console.error('Error checking location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;