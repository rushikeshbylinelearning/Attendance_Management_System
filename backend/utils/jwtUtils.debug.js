#!/usr/bin/env node

/**
 * JWT Utils Debug Helper
 * Tests end-to-end JWT signing and verification with RS256
 * 
 * Usage: node utils/jwtUtils.debug.js
 */

const jwtUtils = require('./jwtUtils');
const fs = require('fs');
const path = require('path');

async function testJWTEndToEnd() {
  console.log('🔍 JWT Utils Debug Test');
  console.log('========================');
  console.log('');

  try {
    // 1. Check key files exist
    console.log('📁 Step 1: Checking key files...');
    const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem';
    const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem';
    
    const resolvedPrivate = path.resolve(__dirname, '..', privateKeyPath);
    const resolvedPublic = path.resolve(__dirname, '..', publicKeyPath);
    
    if (!fs.existsSync(resolvedPrivate)) {
      console.error('❌ Private key file not found:', resolvedPrivate);
      console.error('   Run: node generate-rsa-keys.js');
      process.exit(1);
    }
    
    if (!fs.existsSync(resolvedPublic)) {
      console.error('❌ Public key file not found:', resolvedPublic);
      console.error('   Run: node generate-rsa-keys.js');
      process.exit(1);
    }
    
    console.log('✅ Private key file found:', resolvedPrivate);
    console.log('✅ Public key file found:', resolvedPublic);
    console.log('');

    // 2. Load and check key lengths
    console.log('🔑 Step 2: Loading keys...');
    const privateKey = fs.readFileSync(resolvedPrivate, 'utf8');
    const publicKey = fs.readFileSync(resolvedPublic, 'utf8');
    
    console.log(`✅ Private key loaded: ${privateKey.length} chars`);
    console.log(`✅ Public key loaded: ${publicKey.length} chars`);
    
    if (privateKey.length < 100) {
      console.error('❌ Private key seems too short or invalid');
      process.exit(1);
    }
    
    if (publicKey.length < 100) {
      console.error('❌ Public key seems too short or invalid');
      process.exit(1);
    }
    
    console.log('');

    // 3. Test signing
    console.log('✍️  Step 3: Testing token signing...');
    const testPayload = {
      test: 'ok',
      userId: 'test-user-123',
      email: 'test@example.com',
      role: 'Employee',
      authMethod: 'test',
      iat: Math.floor(Date.now() / 1000)
    };
    
    console.log('Test payload:', testPayload);
    
    let token;
    try {
      token = jwtUtils.sign(testPayload, { expiresIn: '1h' });
      console.log('✅ Token signed successfully');
      console.log('Token preview:', token.substring(0, 50) + '...');
      console.log('');
    } catch (signError) {
      console.error('❌ Token signing failed:', signError.message);
      console.error(signError.stack);
      process.exit(1);
    }

    // 4. Test verification
    console.log('🔍 Step 4: Testing token verification...');
    try {
      const decoded = jwtUtils.verify(token);
      console.log('✅ Token verified successfully');
      console.log('Decoded payload:', decoded);
      console.log('');
      
      // Verify payload matches
      if (decoded.test !== 'ok') {
        console.error('❌ Payload mismatch: test field');
        process.exit(1);
      }
      
      if (decoded.userId !== 'test-user-123') {
        console.error('❌ Payload mismatch: userId field');
        process.exit(1);
      }
      
      console.log('✅ Payload matches original');
      console.log('');
    } catch (verifyError) {
      console.error('❌ Token verification failed:', verifyError.message);
      console.error(verifyError.stack);
      process.exit(1);
    }

    // 5. Test key ID
    console.log('🆔 Step 5: Checking key ID...');
    const keyId = process.env.JWT_KEY_ID || 'ams-key';
    console.log(`Key ID (kid): ${keyId}`);
    
    const jwt = require('jsonwebtoken');
    const decodedHeader = jwt.decode(token, { complete: true });
    
    if (decodedHeader && decodedHeader.header) {
      console.log('Token header:', {
        alg: decodedHeader.header.alg,
        kid: decodedHeader.header.kid,
        typ: decodedHeader.header.typ
      });
      
      if (decodedHeader.header.alg !== 'RS256') {
        console.error(`❌ Invalid algorithm: ${decodedHeader.header.alg}. Expected RS256.`);
        process.exit(1);
      }
      
      if (decodedHeader.header.kid !== keyId) {
        console.warn(`⚠️  Key ID mismatch: token has '${decodedHeader.header.kid}', expected '${keyId}'`);
      } else {
        console.log('✅ Key ID matches');
      }
    }
    console.log('');

    // 6. Test expiration
    console.log('⏰ Step 6: Testing token expiration...');
    const expiration = decodedHeader.payload.exp;
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiration - now;
    
    console.log(`Token expires in: ${Math.floor(timeUntilExpiry / 60)} minutes`);
    if (timeUntilExpiry < 0) {
      console.error('❌ Token is already expired');
      process.exit(1);
    }
    console.log('✅ Token expiration check passed');
    console.log('');

    // Summary
    console.log('========================');
    console.log('✅ All tests passed!');
    console.log('========================');
    console.log('');
    console.log('Key Information:');
    console.log(`  Private key: ${privateKey.length} chars`);
    console.log(`  Public key: ${publicKey.length} chars`);
    console.log(`  Key ID: ${keyId}`);
    console.log(`  Algorithm: RS256`);
    console.log('');
    console.log('✅ JWT signing and verification is working correctly.');
    console.log('✅ Keys are valid and can be used in production.');

  } catch (error) {
    console.error('');
    console.error('❌ Debug test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testJWTEndToEnd().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testJWTEndToEnd };


























