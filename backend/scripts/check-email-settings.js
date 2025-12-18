#!/usr/bin/env node

/**
 * Script to check current email notification settings
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

function checkEmailSettings() {
    try {
        // Check if .env file exists
        if (!fs.existsSync(envPath)) {
            console.log('❌ .env file not found.');
            return;
        }

        // Read current .env file
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        // Extract email settings
        const disableHREmails = envContent.match(/DISABLE_HR_EMAILS=(.*)/);
        const disableAllEmails = envContent.match(/DISABLE_ALL_EMAILS=(.*)/);
        
        console.log('📧 Current Email Notification Settings:');
        console.log('=====================================');
        
        if (disableAllEmails) {
            const allDisabled = disableAllEmails[1] === 'true';
            console.log(`🔔 All Emails: ${allDisabled ? '❌ DISABLED' : '✅ ENABLED'}`);
        } else {
            console.log('🔔 All Emails: ✅ ENABLED (default)');
        }
        
        if (disableHREmails) {
            const hrDisabled = disableHREmails[1] === 'true';
            console.log(`👥 HR Emails: ${hrDisabled ? '❌ DISABLED' : '✅ ENABLED'}`);
        } else {
            console.log('👥 HR Emails: ✅ ENABLED (default)');
        }
        
        console.log('');
        console.log('💡 To change settings, use:');
        console.log('   node scripts/toggle-hr-emails.js off  # Disable HR emails');
        console.log('   node scripts/toggle-hr-emails.js on   # Enable HR emails');
        
    } catch (error) {
        console.error('❌ Error reading .env file:', error.message);
    }
}

checkEmailSettings();

