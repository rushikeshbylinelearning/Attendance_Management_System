#!/usr/bin/env node

/**
 * Script to toggle HR email notifications
 * Usage: node scripts/toggle-hr-emails.js [on|off]
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

function toggleHREmails(enable) {
    try {
        // Check if .env file exists
        if (!fs.existsSync(envPath)) {
            console.log('❌ .env file not found. Please create one from env.example first.');
            process.exit(1);
        }

        // Read current .env file
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        // Check if DISABLE_HR_EMAILS already exists
        if (envContent.includes('DISABLE_HR_EMAILS=')) {
            // Update existing setting
            envContent = envContent.replace(
                /DISABLE_HR_EMAILS=.*/,
                `DISABLE_HR_EMAILS=${!enable}`
            );
        } else {
            // Add new setting
            envContent += `\n# Email Notifications Control\nDISABLE_HR_EMAILS=${!enable}\n`;
        }

        // Write back to .env file
        fs.writeFileSync(envPath, envContent);
        
        const status = enable ? 'ENABLED' : 'DISABLED';
        console.log(`✅ HR emails have been ${status}`);
        console.log(`📧 HR email setting: DISABLE_HR_EMAILS=${!enable}`);
        console.log('🔄 Please restart the backend server for changes to take effect.');
        
    } catch (error) {
        console.error('❌ Error updating .env file:', error.message);
        process.exit(1);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (!command || !['on', 'off'].includes(command)) {
    console.log('Usage: node scripts/toggle-hr-emails.js [on|off]');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/toggle-hr-emails.js off  # Disable HR emails');
    console.log('  node scripts/toggle-hr-emails.js on   # Enable HR emails');
    process.exit(1);
}

const enable = command === 'on';
toggleHREmails(enable);

