// JWT claims are local identity hints, not a replacement for server validation.
function deriveIdentity(authBytes) {
  try {
    const auth = JSON.parse(authBytes.toString('utf8'));
    const token = auth?.tokens?.id_token || auth?.tokens?.access_token;
    if (typeof token !== 'string') return {};
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const nested = decoded?.['https://api.openai.com/auth'] || {};
    return {
      email: decoded.email || nested.email || null,
      accountId: auth.tokens.account_id || nested.chatgpt_account_id || null,
      planType: nested.chatgpt_plan_type || null,
    };
  } catch {
    return {};
  }
}

function identityMatches(left = {}, right = {}) {
  // Different users can belong to the same workspace. Require both fields,
  // including after token rotation, rather than falling back to workspace ID.
  return typeof left.accountId === 'string' && left.accountId.length > 0
    && left.accountId === right.accountId
    && typeof left.email === 'string' && left.email.length > 0
    && typeof right.email === 'string'
    && left.email.toLowerCase() === right.email.toLowerCase();
}

function assertSavedIdentity(expected, actual) {
  if (!identityMatches(expected, actual)) {
    throw Object.assign(new Error('The live login does not match this saved account. Import the current login explicitly or re-authenticate the saved account. No saved credential was replaced.'), { code: 'ACCOUNT_IDENTITY_MISMATCH' });
  }
}

module.exports = { deriveIdentity, identityMatches, assertSavedIdentity };
