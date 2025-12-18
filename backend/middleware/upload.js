// backend/middleware/upload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Define the destination directory (absolute path under backend/uploads/avatars)
const uploadDir = path.join(__dirname, '../uploads/avatars');

// Ensure the directory exists
fs.mkdirSync(uploadDir, { recursive: true });

// Set up storage engine using multer.diskStorage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Ensure directory exists
        try {
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            console.error('Error creating upload directory:', error);
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        try {
            // Check if req.user exists (should be set by authenticateToken middleware)
            if (!req.user || !req.user.userId) {
                return cb(new Error('User authentication required. Please ensure authenticateToken middleware runs before upload.'));
            }
            // Create a unique filename: user-ID-timestamp.extension
            const uniqueSuffix = req.user.userId + '-' + Date.now();
            cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
        } catch (error) {
            console.error('Error generating filename:', error);
            cb(error);
        }
    }
});

// Check File Type to allow only images
function checkFileType(file, cb) {
    try {
        // Allowed extensions
        const filetypes = /jpeg|jpg|png|gif|webp/;
        // Check extension
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        // Check mime type
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Error: Images Only! Allowed types: jpeg, jpg, png, gif, webp'));
        }
    } catch (error) {
        console.error('Error checking file type:', error);
        cb(error);
    }
}

// Initialize upload variable with configuration
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
    fileFilter: (req, file, cb) => {
        checkFileType(file, cb);
    }
});

module.exports = upload;