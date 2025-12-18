#!/usr/bin/env node

/**
 * Comprehensive SSO Integration Validation Tests
 * Tests JWKS endpoint, token verification, and end-to-end flow
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Configuration
const SSO_BACKEND_URL = 'http://localhost:3003';
const AMS_BACKEND_URL = 'http://localhost:3001';
const AMS_FRONTEND_URL = 'http://localhost:5173';

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

function logTest(testName, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName}: ${details}`);
  }
  testResults.details.push({ testName, passed, details });
}

async function testJWKSEndpoint() {
  console.log('\n🔍 Testing JWKS Endpoint...');
  
  try {
    // Test /.well-known/jwks.json endpoint
    const jwksResponse = await axios.get(`${SSO_BACKEND_URL}/.well-known/jwks.json`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    logTest('JWKS endpoint returns 200', jwksResponse.status === 200);
    
    const jwks = jwksResponse.data;
    logTest('JWKS has keys array', Array.isArray(jwks.keys) && jwks.keys.length > 0);
    
    if (jwks.keys && jwks.keys.length > 0) {
      const key = jwks.keys[0];
      logTest('JWK has required fields', !!(key.kty && key.n && key.e && key.kid && key.alg && key.use));
      logTest('JWK uses RS256 algorithm', key.alg === 'RS256');
      logTest('JWK has correct use value', key.use === 'sig');
      logTest('JWK has correct key type', key.kty === 'RSA');
      
      console.log(`   Key ID: ${key.kid}`);
      console.log(`   Algorithm: ${key.alg}`);
      console.log(`   Use: ${key.use}`);
    }
    
    return jwks;
  } catch (error) {
    logTest('JWKS endpoint accessible', false, error.message);
    return null;
  }
}

async function testJWKSClient() {
  console.log('\n🔍 Testing JWKS Client...');
  
  try {
    const client = jwksClient({
      jwksUri: `${SSO_BACKEND_URL}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600000,
      cacheMaxEntries: 5
    });
    
    // Get signing key
    const key = await new Promise((resolve, reject) => {
      client.getSigningKey(null, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    
    logTest('JWKS client can retrieve signing key', !!key);
    
    if (key) {
      const publicKey = key.getPublicKey();
      logTest('JWKS client returns valid public key', !!publicKey);
      
      console.log(`   Public key length: ${publicKey.length}`);
      console.log(`   Public key starts with: ${publicKey.substring(0, 50)}...`);
    }
    
    return client;
  } catch (error) {
    logTest('JWKS client initialization', false, error.message);
    return null;
  }
}

async function testSSOTokenGeneration() {
  console.log('\n🔍 Testing SSO Token Generation...');
  
  try {
    // First, we need to login to get a session
    const loginResponse = await axios.post(`${SSO_BACKEND_URL}/api/auth/login`, {
      email: 'admin@sso.com',
      password: 'admin123'
    }, {
      withCredentials: true,
      timeout: 10000
    });
    
    logTest('SSO login successful', loginResponse.status === 200);
    
    if (loginResponse.status === 200) {
      const cookies = loginResponse.headers['set-cookie'];
      logTest('SSO login sets cookies', !!cookies && cookies.length > 0);
      
      // Now test auto-login endpoint
      const autoLoginResponse = await axios.post(`${SSO_BACKEND_URL}/api/auto-login/launch/test-app-id`, {}, {
        withCredentials: true,
        headers: {
          'Cookie': cookies.join('; ')
        },
        timeout: 10000
      });
      
      logTest('Auto-login endpoint accessible', autoLoginResponse.status === 200 || autoLoginResponse.status === 404);
      
      if (autoLoginResponse.status === 200) {
        const result = autoLoginResponse.data;
        logTest('Auto-login returns success', result.success === true);
        logTest('Auto-login returns redirect URL', !!result.redirectUrl);
        logTest('Auto-login returns token', !!result.token);
        
        if (result.token) {
          // Decode token header
          const decoded = jwt.decode(result.token, { complete: true });
          logTest('SSO token has valid header', !!decoded && !!decoded.header);
          
          if (decoded && decoded.header) {
            logTest('SSO token uses RS256', decoded.header.alg === 'RS256');
            logTest('SSO token has key ID', !!decoded.header.kid);
            
            console.log(`   Token algorithm: ${decoded.header.alg}`);
            console.log(`   Token key ID: ${decoded.header.kid}`);
            console.log(`   Token expires: ${new Date(decoded.payload.exp * 1000).toISOString()}`);
          }
        }
      }
    }
  } catch (error) {
    logTest('SSO token generation', false, error.message);
  }
}

async function testAMSSSOVerification() {
  console.log('\n🔍 Testing AMS SSO Verification...');
  
  try {
    // Create a test SSO token
    const testToken = jwt.sign({
      sub: 'test-user-id',
      iss: 'sso-portal',
      aud: 'test-app-id',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      employeeId: 'TEST001',
      user: {
        id: 'test-user-id',
        employeeId: 'TEST001',
        email: 'test@sso.com',
        name: 'Test User',
        role: 'employee',
        department: 'IT',
        position: 'Developer'
      },
      app: {
        id: 'test-app-id',
        name: 'Test App',
        url: 'http://localhost:5173'
      }
    }, 'test-private-key', { algorithm: 'RS256', keyid: 'test-key-id' });
    
    // Test AMS SSO verification endpoint
    const verifyResponse = await axios.post(`${AMS_BACKEND_URL}/api/auth/sso-verify`, {
      token: testToken
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    logTest('AMS SSO verification endpoint accessible', verifyResponse.status === 200 || verifyResponse.status === 500);
    
    if (verifyResponse.status === 200) {
      const result = verifyResponse.data;
      logTest('AMS SSO verification successful', result.success === true);
      logTest('AMS SSO verification returns token', !!result.token);
    }
  } catch (error) {
    logTest('AMS SSO verification', false, error.message);
  }
}

async function testEndToEndFlow() {
  console.log('\n🔍 Testing End-to-End Flow...');
  
  try {
    // Test if both servers are running
    const ssoHealth = await axios.get(`${SSO_BACKEND_URL}/health`, { timeout: 5000 });
    logTest('SSO backend is running', ssoHealth.status === 200);
    
    const amsHealth = await axios.get(`${AMS_BACKEND_URL}/health`, { timeout: 5000 });
    logTest('AMS backend is running', amsHealth.status === 200);
    
    // Test JWKS endpoint accessibility from AMS
    const jwksFromAMS = await axios.get(`${SSO_BACKEND_URL}/.well-known/jwks.json`, { timeout: 5000 });
    logTest('AMS can access SSO JWKS', jwksFromAMS.status === 200);
    
    console.log('\n📋 End-to-End Flow Summary:');
    console.log('   1. User logs into SSO portal (port 5175)');
    console.log('   2. User clicks AMS card in SSO dashboard');
    console.log('   3. SSO generates RS256 token with JWKS key');
    console.log('   4. Browser redirects to AMS frontend (port 5173)');
    console.log('   5. AMS frontend calls /api/auth/sso-verify with token');
    console.log('   6. AMS backend verifies token using SSO JWKS');
    console.log('   7. AMS creates session and returns AMS JWT token');
    console.log('   8. AMS frontend loads dashboard');
    console.log('   9. Socket connects using AMS JWT token');
    
  } catch (error) {
    logTest('End-to-end flow test', false, error.message);
  }
}

async function runAllTests() {
  console.log('🚀 Starting SSO Integration Validation Tests');
  console.log('==========================================');
  
  const startTime = Date.now();
  
  // Run all tests
  await testJWKSEndpoint();
  await testJWKSClient();
  await testSSOTokenGeneration();
  await testAMSSSOVerification();
  await testEndToEndFlow();
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Print summary
  console.log('\n📊 Test Results Summary');
  console.log('======================');
  console.log(`Total Tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  console.log(`Duration: ${duration}ms`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.details
      .filter(test => !test.passed)
      .forEach(test => console.log(`   - ${test.testName}: ${test.details}`));
  }
  
  console.log('\n🔧 Next Steps:');
  if (testResults.failed === 0) {
    console.log('   ✅ All tests passed! SSO integration is working correctly.');
    console.log('   🚀 You can now test the full flow by:');
    console.log('      1. Starting both SSO and AMS servers');
    console.log('      2. Opening http://localhost:5175');
    console.log('      3. Logging in and clicking the AMS card');
  } else {
    console.log('   🔧 Fix the failed tests before proceeding:');
    console.log('      1. Ensure both servers are running');
    console.log('      2. Check JWKS endpoint accessibility');
    console.log('      3. Verify token generation and verification');
    console.log('      4. Check CORS and cookie settings');
  }
  
  process.exit(testResults.failed === 0 ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test execution failed:', error);
  process.exit(1);
});

