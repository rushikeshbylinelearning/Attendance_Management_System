/**
 * Email normalization utility for consistent user lookups
 * 
 * Normalizes email addresses to prevent duplicate accounts from being created
 * when users authenticate with different email variations (e.g., Gmail aliasing).
 * 
 * Gmail/GoogleMail specific normalization:
 * - Removes dots from the local part (john.doe -> johndoe)
 * - Removes plus aliases (john+work -> john)
 * - Lowercases the entire email
 * 
 * For other domains, only lowercases the email.
 */

/**
 * Normalizes a Gmail address to its canonical form.
 * - Removes dots from the local part.
 * - Removes anything after a plus sign in the local part.
 * - Lowercases the domain.
 * @param {string} email The email address to normalize.
 * @returns {string} The normalized email address.
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return email;
  }

  // Convert to lowercase for case-insensitive matching
  const lowerEmail = email.toLowerCase().trim();
  
  // Split into local and domain parts
  const emailParts = lowerEmail.split('@');
  
  if (emailParts.length !== 2) {
    // Not a valid email format, return as-is
    return email;
  }

  let [localPart, domainPart] = emailParts;

  // Apply normalization only for Gmail accounts (including GoogleMail)
  if (domainPart === 'gmail.com' || domainPart === 'googlemail.com') {
    // Remove everything after the first '+'
    if (localPart.includes('+')) {
      localPart = localPart.substring(0, localPart.indexOf('+'));
    }
    
    // Remove all dots '.' from the local part
    localPart = localPart.replace(/\./g, '');
  }
  
  // For all other domains, we only lowercase (already done)
  // Return the normalized email
  return `${localPart}@${domainPart}`;
}

/**
 * Checks if two email addresses are equivalent after normalization
 * @param {string} email1 First email address
 * @param {string} email2 Second email address
 * @returns {boolean} True if emails are equivalent
 */
function emailsMatch(email1, email2) {
  if (!email1 || !email2) return false;
  return normalizeEmail(email1) === normalizeEmail(email2);
}

module.exports = {
  normalizeEmail,
  emailsMatch
};























