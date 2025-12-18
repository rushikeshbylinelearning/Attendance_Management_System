#!/usr/bin/env node

/**
 * Script to check for duplicate React versions in the project
 * Returns non-zero exit code if duplicates are found
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking for duplicate React versions...\n');

try {
  // Check React versions
  const reactVersions = execSync('npm ls react react-dom --depth=0', { 
    encoding: 'utf8',
    cwd: path.join(__dirname, '../frontend')
  });
  
  console.log('📦 React versions:');
  console.log(reactVersions);
  
  // Check for all React installations
  const allReactVersions = execSync('npm ls react --all', { 
    encoding: 'utf8',
    cwd: path.join(__dirname, '../frontend')
  });
  
  // Count unique React versions (only actual React, not packages with "react" in name)
  const reactVersionMatches = allReactVersions.match(/^\+-- react@[\d\.]+/gm);
  const uniqueVersions = [...new Set(reactVersionMatches)];
  
  console.log('\n🔍 All React installations:');
  console.log(allReactVersions);
  
  if (uniqueVersions.length > 1) {
    console.log('\n❌ ERROR: Multiple React versions detected!');
    console.log('Unique versions found:', uniqueVersions);
    process.exit(1);
  } else {
    console.log('\n✅ SUCCESS: Single React version detected');
    console.log('Version:', uniqueVersions[0]);
    process.exit(0);
  }
  
} catch (error) {
  console.error('❌ Error checking React versions:', error.message);
  process.exit(1);
}
