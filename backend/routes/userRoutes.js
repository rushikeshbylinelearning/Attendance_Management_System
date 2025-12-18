// backend/routes/users.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const User = require('../models/User'); // Adjust path as needed
const authenticateToken = require('../middleware/authenticateToken'); // Your primary authentication middleware
const upload = require('../middleware/upload'); // Our new upload middleware

// @route   GET /api/users/profile
// @desc    Get the current user's profile
// @access  Private
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId)
            .populate('shiftGroup', 'shiftName startTime endTime durationHours paidBreakMinutes')
            .populate('reportingPerson', 'fullName email department')
            .lean();

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Return user profile data
        res.json({
            _id: user._id,
            fullName: user.fullName,
            employeeCode: user.employeeCode,
            email: user.email,
            role: user.role,
            designation: user.designation,
            department: user.department,
            joiningDate: user.joiningDate,
            profileImageUrl: user.profileImageUrl,
            personalDetails: user.personalDetails || {},
            identityDetails: user.identityDetails || {},
            reportingPerson: user.reportingPerson || {},
            shiftGroup: user.shiftGroup
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile.' });
    }
});

// @route   PUT /api/user/update-profile
// @desc    Update the current user's profile
// @access  Private
router.put('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { personalDetails, identityDetails } = req.body;
        const user = await User.findById(req.user.userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Update personal details
        if (personalDetails) {
            user.personalDetails = {
                ...user.personalDetails,
                ...personalDetails
            };
        }

        // Update identity details
        if (identityDetails) {
            user.identityDetails = {
                ...user.identityDetails,
                ...identityDetails
            };
        }

        await user.save();

        // Return updated user
        const updatedUser = await User.findById(req.user.userId)
            .populate('shiftGroup', 'shiftName startTime endTime durationHours paidBreakMinutes')
            .populate('reportingPerson', 'fullName email department')
            .lean();

        res.json({
            message: 'Profile updated successfully.',
            user: {
                _id: updatedUser._id,
                fullName: updatedUser.fullName,
                employeeCode: updatedUser.employeeCode,
                email: updatedUser.email,
                role: updatedUser.role,
                designation: updatedUser.designation,
                department: updatedUser.department,
                joiningDate: updatedUser.joiningDate,
                profileImageUrl: updatedUser.profileImageUrl,
                personalDetails: updatedUser.personalDetails || {},
                identityDetails: updatedUser.identityDetails || {},
                reportingPerson: updatedUser.reportingPerson || {},
                shiftGroup: updatedUser.shiftGroup
            }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile.' });
    }
});

// @route   POST /api/users/upload-avatar
// @desc    Upload or update a profile picture for the logged-in user
// @access  Private
router.post(
    '/upload-avatar',
    authenticateToken, // 1. Authenticate user to get user details on `req.user`
    (req, res, next) => {
        // Multer error handler middleware
        upload.single('profileImage')(req, res, (err) => {
            if (err) {
                console.error('Multer upload error:', err);
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({ 
                            error: 'File size exceeds the limit. Maximum allowed size is 5MB. Please choose a smaller image file.',
                            code: 'FILE_SIZE_EXCEEDED',
                            maxSize: '5MB'
                        });
                    }
                    return res.status(400).json({ error: `Upload error: ${err.message}` });
                }
                if (err.message && err.message.includes('Images Only')) {
                    return res.status(400).json({ error: 'Invalid file type. Only jpeg, jpg, png, gif, or webp are allowed.' });
                }
                if (err.message && err.message.includes('User authentication required')) {
                    return res.status(401).json({ error: 'Authentication required. Please log in again.' });
                }
                return res.status(500).json({ error: 'File upload failed.', details: process.env.NODE_ENV === 'development' ? err.message : undefined });
            }
            next();
        });
    },
    async (req, res) => {
        try {
            // Check if user is authenticated
            if (!req.user || !req.user.userId) {
                return res.status(401).json({ error: 'Authentication required.' });
            }

            // Check for multer errors
            if (req.fileValidationError) {
                return res.status(400).json({ error: req.fileValidationError });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'File not provided or invalid file type. Please upload an image.' });
            }

            const user = await User.findById(req.user.userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found.' });
            }

            // --- THE FIX IS HERE ---
            // Use an environment variable for the public URL in production.
            // Fallback to the request's host for local development.
            const baseUrl = process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
            const imageUrl = `${baseUrl}/avatars/${req.file.filename}`;

            // Update the user's document with the new, correct image URL
            user.profileImageUrl = imageUrl;
            await user.save();

            res.json({
                message: 'Profile image uploaded successfully.',
                imageUrl: user.profileImageUrl
            });

        } catch (error) {
            console.error('Avatar Upload Error:', error);
            console.error('Error stack:', error.stack);
            
            // Handle specific error types
            if (error.message && error.message.includes('Images Only')) {
                return res.status(400).json({ error: 'Invalid file type. Only jpeg, jpg, png, gif, or webp are allowed.' });
            }
            
            if (error.message && error.message.includes('User authentication required')) {
                return res.status(401).json({ error: 'Authentication required. Please log in again.' });
            }

            // Generic error response
            res.status(500).json({ 
                error: 'Server error while uploading image.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;