/**
 * Environment Variable Validator
 * Validates required environment variables on startup
 */

const fs = require('fs');
const path = require('path');

const requiredVars = [
  'MONGODB_URI',
  'JWT_PRIVATE_KEY_PATH',
  'JWT_PUBLIC_KEY_PATH',
];

const optionalVars = [
  'NODE_ENV',
  'PORT',
  'FRONTEND_URL',
  'SESSION_SECRET',
  'JWT_ALGORITHM',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASS',
  'MAIL_FROM',
  'SSO_ENABLED',
  'REDIS_HOST',
  'REDIS_PORT',
];

/**
 * Validate environment variables
 * @returns {Object} - Validation result
 */
function validateEnv() {
  const errors = [];
  const warnings = [];
  
  // Check required variables
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    } else if (process.env[varName].includes('your_') || process.env[varName].includes('example')) {
      warnings.push(`${varName} appears to contain placeholder value. Please update with actual value.`);
    }
  });
  
  // Check for weak secrets
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
    warnings.push('SESSION_SECRET should be at least 32 characters long for security');
  }
  
  // RSA Key validation
  if (!process.env.JWT_PRIVATE_KEY_PATH) {
    errors.push('JWT_PRIVATE_KEY_PATH is required for RS256 JWT signing');
  } else if (!fs.existsSync(path.resolve(__dirname, '..', process.env.JWT_PRIVATE_KEY_PATH))) {
    errors.push('JWT_PRIVATE_KEY_PATH file does not exist: ' + process.env.JWT_PRIVATE_KEY_PATH);
  }

  if (!process.env.JWT_PUBLIC_KEY_PATH) {
    errors.push('JWT_PUBLIC_KEY_PATH is required for RS256 JWT verification');
  } else if (!fs.existsSync(path.resolve(__dirname, '..', process.env.JWT_PUBLIC_KEY_PATH))) {
    errors.push('JWT_PUBLIC_KEY_PATH file does not exist: ' + process.env.JWT_PUBLIC_KEY_PATH);
  }

  if (process.env.JWT_ALGORITHM && process.env.JWT_ALGORITHM !== 'RS256') {
    warnings.push('JWT_ALGORITHM should be RS256 for security. Current: ' + process.env.JWT_ALGORITHM);
  }
  
  // Check NODE_ENV
  if (!process.env.NODE_ENV) {
    warnings.push('NODE_ENV not set, defaulting to development');
  }
  
  // Check PORT
  if (!process.env.PORT) {
    warnings.push('PORT not set, defaulting to 3001');
  }
  
  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL) {
      warnings.push('FRONTEND_URL not set in production. CORS may not work correctly.');
    }
    
    if (!process.env.SESSION_SECRET) {
      warnings.push('SESSION_SECRET not set in production. Using JWT_SECRET as fallback.');
    }
    
    // Check MongoDB connection string format
    if (process.env.MONGODB_URI && !process.env.MONGODB_URI.startsWith('mongodb')) {
      errors.push('MONGODB_URI does not appear to be a valid MongoDB connection string');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Print validation results
 */
function printValidationResults() {
  console.log('\n🔍 Environment Variable Validation');
  console.log('===================================');
  
  const result = validateEnv();
  
  if (result.errors.length > 0) {
    console.error('\n❌ ERRORS:');
    result.errors.forEach(error => console.error(`  - ${error}`));
  }
  
  if (result.warnings.length > 0) {
    console.warn('\n⚠️  WARNINGS:');
    result.warnings.forEach(warning => console.warn(`  - ${warning}`));
  }
  
  if (result.valid && result.warnings.length === 0) {
    console.log('\n✅ All environment variables are properly configured');
  } else if (result.valid) {
    console.log('\n✅ Required environment variables are set (but there are warnings)');
  }
  
  console.log('===================================\n');
  
  return result;
}

/**
 * Get environment info
 */
function getEnvironmentInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001,
    mongoConfigured: !!process.env.MONGODB_URI,
    jwtConfigured: !!(process.env.JWT_PRIVATE_KEY_PATH && process.env.JWT_PUBLIC_KEY_PATH),
    mailConfigured: !!(process.env.MAIL_HOST && process.env.MAIL_USER),
    ssoEnabled: process.env.SSO_ENABLED === 'true',
    redisConfigured: !!process.env.REDIS_HOST,
  };
}

/**
 * Print environment info
 */
function printEnvironmentInfo() {
  const info = getEnvironmentInfo();
  
  console.log('\n📊 Environment Information');
  console.log('===================================');
  console.log(`  Node Version: ${info.nodeVersion}`);
  console.log(`  Platform: ${info.platform}`);
  console.log(`  Environment: ${info.environment}`);
  console.log(`  Port: ${info.port}`);
  console.log(`  MongoDB: ${info.mongoConfigured ? '✅' : '❌'}`);
  console.log(`  JWT: ${info.jwtConfigured ? '✅' : '❌'}`);
  console.log(`  Email: ${info.mailConfigured ? '✅' : '❌'}`);
  console.log(`  SSO: ${info.ssoEnabled ? '✅ Enabled' : '⚪ Disabled'}`);
  console.log(`  Redis: ${info.redisConfigured ? '✅' : '⚪ Not configured'}`);
  console.log('===================================\n');
}

/**
 * Validate and print results
 * Exits process if validation fails
 */
function validateAndExit() {
  printEnvironmentInfo();
  const result = printValidationResults();
  
  if (!result.valid) {
    console.error('❌ Application cannot start due to missing required environment variables');
    console.error('Please check your .env file and ensure all required variables are set.\n');
    process.exit(1);
  }
  
  if (result.warnings.length > 0 && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  There are warnings in production environment. Please review them.\n');
  }
}

module.exports = {
  validateEnv,
  printValidationResults,
  getEnvironmentInfo,
  printEnvironmentInfo,
  validateAndExit,
};


