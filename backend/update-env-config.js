#!/usr/bin/env node

/**
 * Update .env file with RS256 configuration
 * This script adds the required RSA key paths to your .env file
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Updating .env file with RS256 configuration...\n');

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
    
    // Check if they're pointing to the correct files
    const privateKeyPath = envContent.match(/JWT_PRIVATE_KEY_PATH=(.+)/)?.[1];
    const publicKeyPath = envContent.match(/JWT_PUBLIC_KEY_PATH=(.+)/)?.[1];
    
    if (privateKeyPath && publicKeyPath) {
      console.log(`   Private Key Path: ${privateKeyPath}`);
      console.log(`   Public Key Path: ${publicKeyPath}`);
      
      // Check if files exist
      const privateExists = fs.existsSync(path.resolve(__dirname, privateKeyPath));
      const publicExists = fs.existsSync(path.resolve(__dirname, publicKeyPath));
      
      if (privateExists && publicExists) {
        console.log('✅ RSA key files exist and are accessible');
        console.log('\n🎯 Your .env file is properly configured!');
        console.log('   You can now restart your server.');
      } else {
        console.log('❌ RSA key files not found at specified paths');
        console.log('   Please check the file paths in your .env file');
      }
    }
  } else {
    console.log('📝 Adding RSA key configuration to .env file...');
    
    // Add RSA key configuration
    const rsaConfig = `
# JWT Configuration - RS256 with RSA Key Pairs
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
JWT_ALGORITHM=RS256
`;
    
    // Add the configuration after the database section
    if (envContent.includes('MONGODB_URI=')) {
      envContent = envContent.replace(
        /(MONGODB_URI=.*\n)/,
        `$1${rsaConfig}`
      );
    } else {
      envContent = rsaConfig + envContent;
    }
    
    // Remove any existing JWT_SECRET (deprecated)
    envContent = envContent.replace(/^JWT_SECRET=.*$/gm, '# JWT_SECRET=deprecated-use-RSA-keys-instead');
    
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Added RSA key configuration to .env file');
    console.log('✅ Deprecated JWT_SECRET (commented out)');
  }
  
  // Verify the configuration
  console.log('\n🔍 Verifying configuration...');
  
  // Check if key files exist
  const privateKeyPath = './keys/private.pem';
  const publicKeyPath = './keys/public.pem';
  
  const privateExists = fs.existsSync(path.resolve(__dirname, privateKeyPath));
  const publicExists = fs.existsSync(path.resolve(__dirname, publicKeyPath));
  
  console.log(`   Private Key (${privateKeyPath}): ${privateExists ? '✅' : '❌'}`);
  console.log(`   Public Key (${publicKeyPath}): ${publicExists ? '✅' : '❌'}`);
  
  if (privateExists && publicExists) {
    console.log('\n🎉 Configuration complete!');
    console.log('📋 Next steps:');
    console.log('1. Restart your backend server');
    console.log('2. Test the SSO login flow');
    console.log('3. Verify that JWT tokens are using RS256');
  } else {
    console.log('\n❌ RSA key files not found!');
    console.log('   Please run: node generate-rsa-keys.js');
  }
  
} catch (error) {
  console.error('❌ Error updating .env file:', error.message);
  process.exit(1);
}
