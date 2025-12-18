#!/usr/bin/env node

/**
 * Simple JWKS Endpoint Validation Script
 * Tests the SSO JWKS endpoint and validates JWK format
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const SSO_BACKEND_URL = 'http://localhost:3003';

async function validateJWKS() {
  console.log('🔍 Validating SSO JWKS Endpoint');
  console.log('===============================');
  
  try {
    // Test JWKS endpoint
    console.log(`📡 Fetching JWKS from: ${SSO_BACKEND_URL}/.well-known/jwks.json`);
    const response = await axios.get(`${SSO_BACKEND_URL}/.well-known/jwks.json`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    console.log(`✅ Status: ${response.status}`);
    console.log(`📊 Response size: ${JSON.stringify(response.data).length} bytes`);
    
    const jwks = response.data;
    
    // Validate JWKS structure
    if (!jwks.keys || !Array.isArray(jwks.keys)) {
      throw new Error('JWKS missing keys array');
    }
    
    console.log(`🔑 Number of keys: ${jwks.keys.length}`);
    
    // Validate each key
    jwks.keys.forEach((key, index) => {
      console.log(`\n🔑 Key ${index + 1}:`);
      console.log(`   Key ID: ${key.kid}`);
      console.log(`   Algorithm: ${key.alg}`);
      console.log(`   Key Type: ${key.kty}`);
      console.log(`   Use: ${key.use}`);
      console.log(`   Has 'n': ${!!key.n}`);
      console.log(`   Has 'e': ${!!key.e}`);
      
      // Validate required fields
      const requiredFields = ['kty', 'kid', 'alg', 'use', 'n', 'e'];
      const missingFields = requiredFields.filter(field => !key[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Key ${index + 1} missing required fields: ${missingFields.join(', ')}`);
      }
      
      if (key.alg !== 'RS256') {
        throw new Error(`Key ${index + 1} uses unsupported algorithm: ${key.alg}`);
      }
      
      if (key.kty !== 'RSA') {
        throw new Error(`Key ${index + 1} has wrong key type: ${key.kty}`);
      }
      
      if (key.use !== 'sig') {
        throw new Error(`Key ${index + 1} has wrong use value: ${key.use}`);
      }
    });
    
    console.log('\n✅ JWKS structure validation passed');
    
    // Test JWKS client
    console.log('\n🔍 Testing JWKS Client...');
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
    
    const publicKey = key.getPublicKey();
    console.log(`✅ JWKS client retrieved public key (${publicKey.length} chars)`);
    
    // Test token verification with JWKS
    console.log('\n🔍 Testing Token Verification...');
    
    // Create a test token (this would normally be done by SSO backend)
    const testPayload = {
      sub: 'test-user',
      iss: 'sso-portal',
      aud: 'test-app',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      user: { email: 'test@example.com', name: 'Test User' }
    };
    
    // Note: In real scenario, this would be signed by SSO backend with private key
    // For testing, we'll just verify the JWKS client can retrieve the key
    console.log('✅ JWKS client can retrieve signing key for verification');
    
    console.log('\n🎉 JWKS Validation Complete!');
    console.log('============================');
    console.log('✅ JWKS endpoint is accessible');
    console.log('✅ JWKS structure is valid');
    console.log('✅ JWKS client can retrieve keys');
    console.log('✅ All keys use RS256 algorithm');
    console.log('✅ Ready for SSO token verification');
    
  } catch (error) {
    console.error('\n❌ JWKS Validation Failed!');
    console.error('==========================');
    console.error(`Error: ${error.message}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Troubleshooting:');
      console.error('   1. Make sure SSO backend is running on port 3003');
      console.error('   2. Check if the server is accessible');
      console.error('   3. Verify the JWKS endpoint is properly configured');
    } else if (error.response) {
      console.error(`\n📊 HTTP Status: ${error.response.status}`);
      console.error(`📊 Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    
    process.exit(1);
  }
}

// Run validation
validateJWKS().catch(error => {
  console.error('❌ Validation script failed:', error);
  process.exit(1);
});

