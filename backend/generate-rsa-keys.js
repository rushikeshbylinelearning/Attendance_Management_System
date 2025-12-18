#!/usr/bin/env node

/**
 * Generate RSA Key Pair for JWT Signing
 * This script generates RSA private and public keys for RS256 JWT signing
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('🔑 Generating RSA Key Pair for JWT Signing...\n');

// Create keys directory if it doesn't exist
const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
  console.log('✅ Created keys directory');
}

try {
  // Generate RSA key pair
  console.log('🔄 Generating RSA 2048-bit key pair...');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Write private key
  const privateKeyPath = path.join(keysDir, 'private.pem');
  fs.writeFileSync(privateKeyPath, privateKey);
  console.log('✅ Private key saved to:', privateKeyPath);

  // Write public key
  const publicKeyPath = path.join(keysDir, 'public.pem');
  fs.writeFileSync(publicKeyPath, publicKey);
  console.log('✅ Public key saved to:', publicKeyPath);

  // Display key information
  console.log('\n📊 Key Information:');
  console.log('   Algorithm: RSA');
  console.log('   Key Size: 2048 bits');
  console.log('   Format: PEM');
  console.log('   Private Key Type: PKCS#8');
  console.log('   Public Key Type: SPKI');

  // Test key pair
  console.log('\n🧪 Testing Key Pair...');
  const testPayload = { test: 'data', timestamp: Date.now() };
  const testData = Buffer.from(JSON.stringify(testPayload));
  
  // Sign with private key
  const signature = crypto.sign('sha256', testData, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  });

  // Verify with public key
  const isValid = crypto.verify('sha256', testData, publicKey, signature);
  
  if (isValid) {
    console.log('✅ Key pair test successful - signature verification passed');
  } else {
    console.log('❌ Key pair test failed - signature verification failed');
    process.exit(1);
  }

  console.log('\n🎯 Next Steps:');
  console.log('1. Update .env file with key paths:');
  console.log('   JWT_PRIVATE_KEY_PATH=./keys/private.pem');
  console.log('   JWT_PUBLIC_KEY_PATH=./keys/public.pem');
  console.log('   JWT_ALGORITHM=RS256');
  console.log('2. Update JWT signing/verification code to use RS256');
  console.log('3. Remove all HS256 references');

  console.log('\n✨ RSA key generation completed successfully!');

} catch (error) {
  console.error('❌ Error generating RSA keys:', error.message);
  process.exit(1);
}
