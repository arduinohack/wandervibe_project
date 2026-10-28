const crypto = require('crypto');

const KEY_LABEL = 'wv_live_';
const NAME_LIMIT = 80;

function hashApiKey(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

// 32 random bytes, shown once. The stored prefix is the first 8 characters.
function generateApiKey() {
  const key = KEY_LABEL + crypto.randomBytes(32).toString('base64url');
  return {
    key,
    prefix: key.slice(0, 8),
    keyHash: hashApiKey(key),
  };
}

module.exports = {
  KEY_LABEL,
  NAME_LIMIT,
  hashApiKey,
  generateApiKey,
};
