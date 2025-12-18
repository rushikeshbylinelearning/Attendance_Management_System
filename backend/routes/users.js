// backend/routes/users.js

const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Adjust path as needed
const authenticateToken = require('../middleware/authenticateToken'); // Your primary authentication middleware
const upload = require('../middleware/upload'); // Our new upload middleware

// @route   POST /api/users/upload-avatar
// @desc    Upload or update a profile picture for the logged-in user
// @access  Private
router.post(
    '/upload-avatar',
    authenticateToken, // 1. Authenticate user to get user details on `req.user`
    upload.single('profileImage'), // 2. Process a single file upload with the field name 'profileImage'
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'File not provided or invalid file type. Please upload an image.' });
            }

            const user = await User.findById(req.user.userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found.' });
            }

            // --- THIS LOGIC IS NOW CORRECT AND ROBUST ---
            // It will prioritize the .env variable. If that's not set, it will now correctly
            // use `https` from `req.protocol` because we enabled 'trust proxy' in server.js.
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
            if (error.message && error.message.includes('Images Only')) {
                return res.status(400).json({ error: 'Invalid file type. Only jpeg, jpg, png, or gif are allowed.' });
            }
            res.status(500).json({ error: 'Server error while uploading image.' });
        }
    }
);

module.exports = router;