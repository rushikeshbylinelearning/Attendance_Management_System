// backend/middleware/uploadMedicalCertificate.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Define the destination directory for medical certificates
const uploadDir = path.join(__dirname, '../uploads/medical-certificates');

// Ensure the directory exists
fs.mkdirSync(uploadDir, { recursive: true });

// Set up storage engine using multer.diskStorage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Create a unique filename: user-ID-timestamp.extension
        const uniqueSuffix = req.user.userId + '-' + Date.now();
        cb(null, 'medical-cert-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Check File Type to allow PDFs and images
function checkFileType(file, cb) {
    // Allowed extensions
    const filetypes = /jpeg|jpg|png|gif|pdf/;
    // Check extension
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    // Check mime type
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Error: Only PDF and image files are allowed!'));
    }
}

// Initialize upload variable with configuration
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
    fileFilter: (req, file, cb) => {
        checkFileType(file, cb);
    }
});

module.exports = upload;


