// backend/db.js
const mongoose = require('mongoose');
require('dotenv').config();

let isConnected = false;

const connectDB = async () => {
  // If already connected, return existing connection
  if (isConnected && mongoose.connection.readyState === 1) {
    console.log('[MongoDB] Already connected (readyState: 1)');
    return mongoose.connection;
  }

  try {
    // Read MongoDB URI from environment
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/attendance-system';
    console.log('🔗 Attempting to connect to MongoDB:', mongoUri);
    
    // Modern Mongoose connection options (no deprecated options)
    const options = {
      serverSelectionTimeoutMS: 20000, // Keep trying to send operations for 20 seconds
      connectTimeoutMS: 20000, // Connection timeout
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      maxPoolSize: 10, // Maintain up to 10 socket connections
    };
    
    await mongoose.connect(mongoUri, options);
    
    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      if (mongoose.connection.readyState === 1) {
        console.log('✅ MongoDB connected (readyState: 1)');
        resolve();
      } else {
        mongoose.connection.once('connected', () => {
          console.log('✅ MongoDB connected');
          resolve();
        });
        mongoose.connection.once('error', reject);
        // Timeout after 25 seconds
        setTimeout(() => reject(new Error('MongoDB connection timeout')), 25000);
      }
    });
    
    isConnected = true;
    console.log('📊 Database:', mongoose.connection.name);
    console.log('✅ MongoDB connected successfully');
    
    // Set up reconnection logic for disconnections
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected. Retrying in 5s...');
      isConnected = false;
      setTimeout(() => {
        connectDB().catch(err => {
          console.error('❌ MongoDB reconnection failed:', err.message);
        });
      }, 5000);
    });
    
    // Handle connection errors
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err.message);
      isConnected = false;
    });
    
    return mongoose.connection;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    isConnected = false;
    throw err; // Re-throw to allow caller to handle
  }
};

module.exports = connectDB;