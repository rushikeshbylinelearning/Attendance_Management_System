// backend/scripts/test-auth-flows.js
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ssoService = require('../services/ssoService');

// Test configuration
const TEST_USER = {
    email: 'test@example.com',
    fullName: 'Test User',
    employeeCode: 'TEST001',
    role: 'Employee',
    passwordHash: '$2b$10$test.hash.for.testing.purposes.only',
    joiningDate: new Date(),
    isActive: true
};

async function setupTestUser() {
    console.log('🔧 Setting up test user...');
    
    // Clean up any existing test user
    await User.deleteOne({ email: TEST_USER.email });
    
    // Create test user
    const user = new User(TEST_USER);
    await user.save();
    
    console.log('✅ Test user created:', user.email);
    return user;
}

async function testLocalAuth() {
    console.log('\n🧪 Testing Local Authentication...');
    
    try {
        // Test user lookup (simulating login process)
        const user = await User.findOne({
            email: TEST_USER.email,
            isActive: true
        }).populate('shiftGroup');
        
        if (!user) {
            throw new Error('Test user not found');
        }
        
        // Test JWT token creation
        const payload = { 
            userId: user._id, 
            email: user.email, 
            role: user.role,
            authMethod: 'local'
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', { expiresIn: '9h' });
        
        // Test JWT token verification
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        
        console.log('✅ Local auth test passed');
        console.log(`   User: ${decoded.email}`);
        console.log(`   Role: ${decoded.role}`);
        console.log(`   Auth Method: ${decoded.authMethod}`);
        
        return { user, token, decoded };
        
    } catch (error) {
        console.error('❌ Local auth test failed:', error.message);
        throw error;
    }
}

async function testSSOAuth() {
    console.log('\n🧪 Testing SSO Authentication...');
    
    try {
        // Create a mock SSO token (for testing purposes only)
        const mockSSOUser = {
            id: 'sso-user-123',
            email: 'sso-test@example.com',
            name: 'SSO Test User',
            role: 'admin',
            department: 'IT',
            designation: 'Software Engineer',
            employeeCode: 'SSO001'
        };
        
        // Test role mapping
        const mappedRole = ssoService.mapSSORoleToAMS(mockSSOUser.role);
        console.log(`   Role mapping: ${mockSSOUser.role} → ${mappedRole}`);
        
        // Test user creation (if auto-provisioning is enabled)
        if (process.env.SSO_AUTO_PROVISION === 'true') {
            console.log('   Testing auto-provisioning...');
            
            // Clean up any existing SSO test user
            await User.deleteOne({ email: mockSSOUser.email });
            
            // Test user creation
            const ssoUser = await ssoService.findOrCreateUser(mockSSOUser);
            console.log('✅ SSO user created/found:', ssoUser.email);
            
            // Test AMS token creation
            const amsToken = ssoService.createAMSToken(ssoUser);
            const decoded = jwt.verify(amsToken, process.env.JWT_SECRET || 'test-secret');
            
            console.log('✅ SSO auth test passed');
            console.log(`   User: ${decoded.email}`);
            console.log(`   Role: ${decoded.role}`);
            console.log(`   Auth Method: ${decoded.authMethod}`);
            
            return { user: ssoUser, token: amsToken, decoded };
        } else {
            console.log('⚠️  SSO auto-provisioning disabled, skipping user creation test');
            return null;
        }
        
    } catch (error) {
        console.error('❌ SSO auth test failed:', error.message);
        throw error;
    }
}

async function testAuthMethodFlag() {
    console.log('\n🧪 Testing Auth Method Flag...');
    
    try {
        // Test local user
        const localUser = await User.findOne({ email: TEST_USER.email });
        if (localUser) {
            console.log(`   Local user auth method: ${localUser.authMethod || 'local'}`);
        }
        
        // Test SSO user (if exists)
        const ssoUser = await User.findOne({ email: 'sso-test@example.com' });
        if (ssoUser) {
            console.log(`   SSO user auth method: ${ssoUser.authMethod || 'local'}`);
        }
        
        console.log('✅ Auth method flag test completed');
        
    } catch (error) {
        console.error('❌ Auth method flag test failed:', error.message);
        throw error;
    }
}

async function cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    
    try {
        await User.deleteOne({ email: TEST_USER.email });
        await User.deleteOne({ email: 'sso-test@example.com' });
        console.log('✅ Test data cleaned up');
    } catch (error) {
        console.error('⚠️  Cleanup failed:', error.message);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Authentication Flow Tests...\n');
    
    try {
        // Connect to database
        if (!mongoose.connection.readyState) {
            await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance-system');
            console.log('✅ Connected to database');
        }
        
        // Setup
        await setupTestUser();
        
        // Run tests
        await testLocalAuth();
        await testSSOAuth();
        await testAuthMethodFlag();
        
        console.log('\n🎉 All authentication flow tests passed!');
        
    } catch (error) {
        console.error('\n❌ Test suite failed:', error.message);
        process.exit(1);
    } finally {
        await cleanup();
        await mongoose.disconnect();
        console.log('✅ Database disconnected');
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    require('dotenv').config();
    runAllTests().then(() => {
        console.log('\n✅ Test suite completed successfully');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests, testLocalAuth, testSSOAuth, testAuthMethodFlag };

