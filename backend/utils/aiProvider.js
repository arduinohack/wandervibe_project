const crypto = require('crypto');
const User = require('../models/User');
const { xaiApiKey } = require('./xaiConfirmation');

const AI_PROVIDERS = Object.freeze(['xai', 'openai', 'anthropic', 'gemini', 'none']);
const AI_PROVIDER_SET = new Set(AI_PROVIDERS);
const MIN_SECRET_BYTES = 32;
const ENCRYPTION_MESSAGE = 'AI key encryption is not configured';

function encryptionSecret() {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (typeof secret !== 'string') return null;
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptionConfigured() {
  return encryptionSecret() !== null;
}

function encryptApiKey(plain) {
  const key = encryptionSecret();
  if (!key) {
    const error = new Error(ENCRYPTION_MESSAGE);
    error.status = 500;
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plain), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptApiKey(stored) {
  const key = encryptionSecret();
  if (!key || typeof stored !== 'string' || !stored) return '';
  const parts = stored.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return '';
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parts[0], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts[2], 'base64url')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch (_) {
    return '';
  }
}

function callerIdOf(user) {
  if (!user) return '';
  const id = user.userId || user.id || user._id;
  if (id == null) return '';
  return String(id);
}

function serverClient() {
  const apiKey = xaiApiKey();
  if (!apiKey) return null;
  return {
    provider: 'xai',
    supported: true,
    source: 'server',
    apiKey,
  };
}

// A user key is used only for that user. No user key falls back to the server xAI key.
// Null means paste should use the labeled parser and suggest should skip summaries.
async function getAiClient(user) {
  try {
    const userId = callerIdOf(user);
    if (!userId) return serverClient();
    const record = await User.findById(userId).select('aiProvider +aiApiKeyEncrypted').lean();
    if (!record) return serverClient();
    const provider = AI_PROVIDER_SET.has(record.aiProvider) ? record.aiProvider : 'none';
    const encrypted = typeof record.aiApiKeyEncrypted === 'string'
      ? record.aiApiKeyEncrypted
      : '';
    if (provider === 'none' || !encrypted) return serverClient();
    if (provider !== 'xai') {
      console.error(`AI provider is not yet supported: ${provider}`);
      return { provider, supported: false };
    }
    const apiKey = decryptApiKey(encrypted);
    if (!apiKey) return null;
    return {
      provider: 'xai',
      supported: true,
      source: 'user',
      apiKey,
    };
  } catch (error) {
    const message = error && error.message ? error.message : 'request failed';
    console.error('AI client failed:', message);
    return serverClient();
  }
}

module.exports = {
  AI_PROVIDERS,
  AI_PROVIDER_SET,
  ENCRYPTION_MESSAGE,
  encryptionConfigured,
  encryptApiKey,
  decryptApiKey,
  getAiClient,
};
