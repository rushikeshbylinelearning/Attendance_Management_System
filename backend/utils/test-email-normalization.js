/**
 * Test script for email normalization utility
 * Run with: node utils/test-email-normalization.js
 */

const { normalizeEmail, emailsMatch } = require('./emailUtils');

console.log('🧪 Testing Email Normalization Utility\n');
console.log('='.repeat(60));

// Test cases based on acceptance criteria
const testCases = [
    {
        input: 'John.Doe@gmail.com',
        expected: 'johndoe@gmail.com',
        description: 'Gmail: Remove dots'
    },
    {
        input: 'johndoe+work@gmail.com',
        expected: 'johndoe@gmail.com',
        description: 'Gmail: Remove plus alias'
    },
    {
        input: 'john.doe+testing@gmail.com',
        expected: 'johndoe@gmail.com',
        description: 'Gmail: Remove dots and plus alias'
    },
    {
        input: 'test.user@yahoo.com',
        expected: 'test.user@yahoo.com',
        description: 'Non-Gmail: No changes'
    },
    {
        input: 'firstname.lastname@company.com',
        expected: 'firstname.lastname@company.com',
        description: 'Company email: No changes'
    },
    {
        input: 'USER@GMAIL.COM',
        expected: 'user@gmail.com',
        description: 'Uppercase: Convert to lowercase'
    },
    {
        input: 'test.user@googlemail.com',
        expected: 'testuser@googlemail.com',
        description: 'GoogleMail: Remove dots (same as Gmail)'
    },
    {
        input: 'rushikesh.byline@gmail.com',
        expected: 'rushikeshbyline@gmail.com',
        description: 'Real-world example: rushikesh.byline -> rushikeshbyline'
    },
    {
        input: 'rushikeshbyline@gmail.com',
        expected: 'rushikeshbyline@gmail.com',
        description: 'Real-world example: Already normalized'
    }
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
    const result = normalizeEmail(testCase.input);
    const success = result === testCase.expected;
    
    if (success) {
        console.log(`✅ Test ${index + 1}: ${testCase.description}`);
        console.log(`   Input:    ${testCase.input}`);
        console.log(`   Expected: ${testCase.expected}`);
        console.log(`   Got:      ${result}`);
        passed++;
    } else {
        console.log(`❌ Test ${index + 1} FAILED: ${testCase.description}`);
        console.log(`   Input:    ${testCase.input}`);
        console.log(`   Expected: ${testCase.expected}`);
        console.log(`   Got:      ${result}`);
        failed++;
    }
    console.log('');
});

console.log('='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

// Test email matching function
console.log('\n🧪 Testing emailsMatch() function\n');
console.log('='.repeat(60));

const matchTests = [
    {
        email1: 'john.doe@gmail.com',
        email2: 'johndoe@gmail.com',
        expected: true,
        description: 'Gmail variations should match'
    },
    {
        email1: 'user+test@gmail.com',
        email2: 'user@gmail.com',
        expected: true,
        description: 'Gmail with plus alias should match base'
    },
    {
        email1: 'test.user@yahoo.com',
        email2: 'test.user@yahoo.com',
        expected: true,
        description: 'Same non-Gmail emails should match'
    },
    {
        email1: 'user@gmail.com',
        email2: 'user@yahoo.com',
        expected: false,
        description: 'Different domains should not match'
    }
];

matchTests.forEach((test, index) => {
    const result = emailsMatch(test.email1, test.email2);
    const success = result === test.expected;
    
    if (success) {
        console.log(`✅ Match Test ${index + 1}: ${test.description}`);
        console.log(`   ${test.email1} vs ${test.email2} = ${result}`);
        passed++;
    } else {
        console.log(`❌ Match Test ${index + 1} FAILED: ${test.description}`);
        console.log(`   Expected: ${test.expected}, Got: ${result}`);
        failed++;
    }
    console.log('');
});

console.log('='.repeat(60));
console.log(`\n📊 Final Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('\n✅ All tests passed! Email normalization is working correctly.\n');
    process.exit(0);
} else {
    console.log('\n❌ Some tests failed. Please review the implementation.\n');
    process.exit(1);
}























