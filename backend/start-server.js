// backend/start-server.js
// Simple script to start the server with required environment variables

// Set environment variables
process.env.JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';
process.env.MONGODB_URI = 'mongodb://localhost:27017/attendance-system';
process.env.PORT = '5000';
process.env.NODE_ENV = 'development';
process.env.FRONTEND_URL = 'http://localhost:5173';

console.log('🚀 Starting server with environment variables...');
console.log('📊 MongoDB URI:', process.env.MONGODB_URI);
console.log('🔑 JWT Secret:', process.env.JWT_SECRET ? 'Set' : 'Not set');
console.log('🌐 Port:', process.env.PORT);

// Start the server
require('./server.js');

