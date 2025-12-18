// backend/services/mailService.js
const nodemailer = require('nodemailer');

const createTransporter = async () => {
    // This function remains the same as it correctly checks for .env variables.
    if (!process.env.MAIL_HOST) {
        // Ethereal (testing) setup...
        let testAccount = await nodemailer.createTestAccount();
        console.log("************************************************************");
        console.log("NO REAL MAIL SERVICE CONFIGURED - USING ETHEREAL FOR DEV");
        console.log("Preview emails at:", nodemailer.getTestMessageUrl(null));
        console.log("************************************************************");
        
        return nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass,
            },
        });
    }

    // --- Production/Real SMTP Configuration ---
    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT,
        secure: process.env.MAIL_SECURE === 'true', // Should be true for port 465
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
        // --- ADDED: More robust connection options ---
        // This helps with debugging and potential network issues.
        logger: true, // Log all communication with the mail server
        debug: true,  // Show debug output
    });
};

const sendEmail = async ({ to, subject, text, html, isHREmail = false }) => {
    // Check if all emails are disabled
    if (process.env.DISABLE_ALL_EMAILS === 'true') {
        console.log(`[Email Service] All emails disabled - skipping email to: "${to}", Subject: "${subject}"`);
        return;
    }
    
    // Check if HR emails are disabled
    if (isHREmail && process.env.DISABLE_HR_EMAILS === 'true') {
        console.log(`[Email Service] HR emails disabled - skipping HR email to: "${to}", Subject: "${subject}"`);
        return;
    }
    
    console.log(`[Email Service] Preparing to send email. To: "${to}", Subject: "${subject}"`);
    try {
        const transporter = await createTransporter();
        
        console.log('[Email Service] Transporter created. Verifying connection...');
        // --- ADDED: Verify connection to SMTP server ---
        await transporter.verify();
        console.log('[Email Service] SMTP Connection Verified Successfully.');

        const info = await transporter.sendMail({
            from: `"AMS Portal" <${process.env.MAIL_USER}>`, // Use the configured user as the sender
            to,
            subject,
            text,
            html,
        });

        console.log(`[Email Service] SUCCESS! Message sent: ${info.messageId}`);
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
            console.log(`[Email Service] Preview URL (for Ethereal): ${previewUrl}`);
        }
    } catch (error) {
        // --- IMPROVED: Detailed Error Logging ---
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error('!!! [Email Service] FAILED TO SEND EMAIL !!!');
        console.error(`!!! Reason: ${error.message}`);
        if (error.code === 'EAUTH') {
            console.error('!!! Authentication Error (EAUTH): This is likely an incorrect MAIL_USER or MAIL_PASS (App Password) in your .env file.');
        } else if (error.code === 'ECONNECTION') {
            console.error('!!! Connection Error (ECONNECTION): The server could not connect to the SMTP host. Check for firewall blocks on port 465.');
        }
        console.error('!!! Full Error Details:', error);
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        // We throw the error here so the calling function knows it failed,
        // even though it's fire-and-forget in leaves.js. This is good practice.
        throw error;
    }
};

module.exports = { sendEmail };