#!/usr/bin/env node

/**
 * Fix .env file with RS256 configuration
 * This script properly adds the required RSA key paths to your .env file
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Fixing .env file with RS256 configuration...\n');

const envPath = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found!');
  process.exit(1);
}

try {
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  // Check if RSA key paths are already configured
  if (envContent.includes('JWT_PRIVATE_KEY_PATH') && envContent.includes('JWT_PUBLIC_KEY_PATH')) {
    console.log('✅ RSA key paths already configured in .env file');
  } else {
    console.log('📝 Adding RSA key configuration to .env file...');
    
    // Add RSA key configuration at the beginning after comments
    const rsaConfig = `
# JWT Configuration - RS256 with RSA Key Pairs
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
JWT_ALGORITHM=RS256

`;
    
    // Add after the first comment block
    if (envContent.includes('# --- MAIL SERVICE CONFIGURATION')) {
      envContent = envContent.replace(
        /(# --- MAIL SERVICE CONFIGURATION)/,
        `${rsaConfig}$1`
      );
    } else {
      envContent = rsaConfig + envContent;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Added RSA key configuration to .env file');
  }
  
  // Verify the configuration
  console.log('\n🔍 Verifying configuration...');
  
  // Reload the file to check
  const updatedContent = fs.readFileSync(envPath, 'utf8');
  
  const privateKeyPath = updatedContent.match(/JWT_PRIVATE_KEY_PATH=(.+)/)?.[1];
  const publicKeyPath = updatedContent.match(/JWT_PUBLIC_KEY_PATH=(.+)/)?.[1];
  const algorithm = updatedContent.match(/JWT_ALGORITHM=(.+)/)?.[1];
  
  console.log(`   JWT_PRIVATE_KEY_PATH: ${privateKeyPath || 'NOT FOUND'}`);
  console.log(`   JWT_PUBLIC_KEY_PATH: ${publicKeyPath || 'NOT FOUND'}`);
  console.log(`   JWT_ALGORITHM: ${algorithm || 'NOT FOUND'}`);
  
  // Check if key files exist
  const privateExists = fs.existsSync(path.resolve(__dirname, './keys/private.pem'));
  const publicExists = fs.existsSync(path.resolve(__dirname, './keys/public.pem'));
  
  console.log(`   Private Key File: ${privateExists ? '✅' : '❌'}`);
  console.log(`   Public Key File: ${publicExists ? '✅' : '❌'}`);
  
  if (privateKeyPath && publicKeyPath && algorithm && privateExists && publicExists) {
    console.log('\n🎉 Configuration complete!');
    console.log('📋 Next steps:');
    console.log('1. Restart your backend server');
    console.log('2. Test the SSO login flow');
    console.log('3. Verify that JWT tokens are using RS256');
  } else {
    console.log('\n❌ Configuration incomplete!');
    console.log('   Please check the .env file manually');
  }
  
} catch (error) {
  console.error('❌ Error updating .env file:', error.message);
  process.exit(1);
}
