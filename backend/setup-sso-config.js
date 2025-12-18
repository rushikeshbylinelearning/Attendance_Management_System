#!/usr/bin/env node

/**
 * SSO Configuration Setup Script
 * This script helps configure SSO integration between SSO portal and AMS backend
 */

const fs = require('fs');
const path = require('path');

const AMS_BACKEND_DIR = path.join(__dirname);
const SSO_BACKEND_DIR = path.join(__dirname, '../../SSO/backend');

console.log('🔧 SSO Configuration Setup Script\n');

// Check if .env exists
const envPath = path.join(AMS_BACKEND_DIR, '.env');
const envExists = fs.existsSync(envPath);

if (!envExists) {
  console.log('❌ .env file not found in AMS backend');
  console.log('📝 Creating .env file...\n');
  
  const envContent = `# AMS Backend Environment Configuration

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/attendance_system
PORT=3001
NODE_ENV=development

# SSO Configuration
SSO_ENABLED=true
SSO_ISSUER=sso-portal
SSO_AUDIENCE=sso-portal
SSO_AUTO_PROVISION=true

# SSO Public Key (will be populated after SSO generates keys)
# Copy the public key from SSO/backend/keys/public-sso-key-*.pem
SSO_PUBLIC_KEY=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk6BTZn+gsIN0jvzq8tIs
7axXQefDQrDRVqfMiP4fwxO1JjDVjVRNDgmx7h47yNKNsHiA6xqjRov4tiUhjNhJ
qClXIPYnCBB8Cs/JCzuMPSJSmpcZaVFGTkpq1jo7A22zCLX7Ngcon9inkQmvd3Lc
HfNjbAANR5GvCOcF5ad96qxM3xELw7Erk35QTvgMz6g0TgpXXHfVHqGpyiB4203a
DPp5vRoil85ZgXzyZelHE9d2+aMp/pEcB6i8GIIBfAvm9zNvHTuh9mvqWigkPqKN
fHEf0tl+PGj4+1doLbvaXrJaQEMd0/enV8atek66asMxFcN1CZhqImWD1X/dthEg
kQIDAQABs

# Alternative: JWKS URL (if SSO serves JWKS endpoint)
SSO_JWKS_URL=http://localhost:3003/.well-known/jwks.json

# Legacy SSO Secret (for backwards compatibility)
SSO_SECRET=sso-secret-key-change-in-production

# Session Configuration
SESSION_SECRET=your-session-secret-change-in-production

# Frontend URL
FRONTEND_URL=http://localhost:5173
`;

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Created .env file');
} else {
  console.log('✅ .env file exists');
}

// Check SSO backend keys
const ssoKeysDir = path.join(SSO_BACKEND_DIR, 'keys');
const ssoKeysExist = fs.existsSync(ssoKeysDir);

if (!ssoKeysExist) {
  console.log('\n❌ SSO backend keys directory not found');
  console.log('🔑 SSO backend needs to generate RSA key pairs first');
  console.log('\n📋 Next Steps:');
  console.log('1. Start SSO backend: cd SSO/backend && npm start');
  console.log('2. This will generate keys in SSO/backend/keys/');
  console.log('3. Run this script again to extract the public key');
} else {
  console.log('\n✅ SSO backend keys directory found');
  
  // Look for public key files
  const files = fs.readdirSync(ssoKeysDir);
  const publicKeyFiles = files.filter(file => file.startsWith('public-') && file.endsWith('.pem'));
  
  if (publicKeyFiles.length === 0) {
    console.log('❌ No public key files found in SSO keys directory');
    console.log('🔑 SSO backend needs to generate keys first');
  } else {
    console.log(`✅ Found ${publicKeyFiles.length} public key file(s)`);
    
    // Get the most recent public key
    const latestPublicKeyFile = publicKeyFiles.sort().pop();
    const publicKeyPath = path.join(ssoKeysDir, latestPublicKeyFile);
    
    try {
      const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      console.log(`\n🔑 Latest public key: ${latestPublicKeyFile}`);
      
      // Update .env file with public key
      let envContent = fs.readFileSync(envPath, 'utf8');
      
      // Replace SSO_PUBLIC_KEY line
      const publicKeyEscaped = publicKey.replace(/\n/g, '\\n');
      envContent = envContent.replace(
        /SSO_PUBLIC_KEY=.*/,
        `SSO_PUBLIC_KEY="${publicKeyEscaped}"`
      );
      
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Updated .env file with SSO public key');
      
      console.log('\n🎯 Configuration Complete!');
      console.log('📋 Next Steps:');
      console.log('1. Restart AMS backend: npm run dev');
      console.log('2. Check health endpoint: http://localhost:3001/health');
      console.log('3. Test SSO auto-login from SSO portal');
      
    } catch (error) {
      console.error('❌ Error reading public key:', error.message);
    }
  }
}

// Check current .env configuration
console.log('\n📊 Current SSO Configuration:');
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  
  const ssoConfig = lines.filter(line => 
    line.startsWith('SSO_') && !line.startsWith('#')
  );
  
  ssoConfig.forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      if (key === 'SSO_PUBLIC_KEY' && value.length > 50) {
        console.log(`${key}=${value.substring(0, 50)}...`);
      } else {
        console.log(`${key}=${value}`);
      }
    }
  });
  
} catch (error) {
  console.error('❌ Error reading .env file:', error.message);
}

console.log('\n✨ Setup script completed!');






