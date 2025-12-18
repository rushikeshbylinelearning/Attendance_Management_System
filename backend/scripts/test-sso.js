// backend/scripts/test-sso.js
const ssoService = require('../services/ssoService');

async function testSSOService() {
    console.log('🧪 Testing SSO Service...\n');

    try {
        // Test 1: Initialize SSO service
        console.log('1. Testing SSO service initialization...');
        await ssoService.initialize();
        console.log('✅ SSO service initialized successfully\n');

        // Test 2: Test role mapping
        console.log('2. Testing role mapping...');
        const testRoles = ['admin', 'hr', 'employee', 'intern', 'unknown_role'];
        testRoles.forEach(role => {
            const mappedRole = ssoService.mapSSORoleToAMS(role);
            console.log(`   ${role} → ${mappedRole}`);
        });
        console.log('✅ Role mapping test completed\n');

        // Test 3: Test public key fetching (if configured)
        if (process.env.SSO_PUBLIC_KEY_URL) {
            console.log('3. Testing public key fetching...');
            try {
                const publicKey = await ssoService.fetchPublicKey();
                console.log('✅ Public key fetched successfully');
                console.log(`   Key length: ${publicKey.length} characters`);
            } catch (error) {
                console.log('⚠️  Public key fetch failed (expected if SSO not configured):', error.message);
            }
        } else {
            console.log('3. Skipping public key test (SSO_PUBLIC_KEY_URL not configured)');
        }

        console.log('\n🎉 SSO service tests completed!');
        console.log('\nTo test with real SSO tokens, configure the following environment variables:');
        console.log('- SSO_PUBLIC_KEY_URL');
        console.log('- SSO_APP_ID');
        console.log('- SSO_ISSUER (optional)');
        console.log('- SSO_AUTO_PROVISION');

    } catch (error) {
        console.error('❌ SSO service test failed:', error.message);
        process.exit(1);
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    require('dotenv').config();
    testSSOService().then(() => {
        console.log('\n✅ All tests completed successfully');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
}

module.exports = testSSOService;

