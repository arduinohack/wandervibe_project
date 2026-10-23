const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

const REFRESH_PREFIX = 'refresh:';
const USER_SET_PREFIX = 'refresh-user:';

function durationToSeconds(value, fallbackSeconds) {
  if (typeof value !== 'string') return fallbackSeconds;
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackSeconds;
  const unit = match[2];
  const scale = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * scale;
}

function accessExpiresIn() {
  const raw = process.env.JWT_ACCESS_EXPIRES_IN;
  if (typeof raw === 'string' && /^\d+[smhd]$/.test(raw.trim())) return raw.trim();
  return '15m';
}

function refreshTtlSeconds() {
  return durationToSeconds(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 86400);
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'your_secret_key';
}

function signAccessToken(user, { includeRole = false } = {}) {
  const payload = {
    userId: user._id || user.userId || user.id,
    // Unique per issue so a same-second token is not the blacklisted one.
    jti: crypto.randomBytes(8).toString('hex'),
  };
  if (includeRole) {
    payload.role = user.role || 'Wanderer';
  }
  return jwt.sign(payload, jwtSecret(), { expiresIn: accessExpiresIn() });
}

function newRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function saveRefreshToken(token, userId) {
  const client = global.redisClient;
  const id = String(userId);
  if (!client) {
    logger.info('Refresh token not stored, Redis unavailable', {
      userId: id,
      event: 'AuthRefresh',
      context: {},
    });
    return false;
  }
  const ttl = refreshTtlSeconds();
  const body = JSON.stringify({ userId: id, createdAt: new Date().toISOString() });
  await client.set(REFRESH_PREFIX + token, body, { EX: ttl });
  const setKey = USER_SET_PREFIX + id;
  await client.sAdd(setKey, token);
  if (typeof client.expire === 'function') {
    await client.expire(setKey, ttl);
  }
  return true;
}

async function issueSession(user, options) {
  const token = signAccessToken(user, options);
  const refreshToken = newRefreshToken();
  const userId = user._id || user.userId || user.id;
  try {
    await saveRefreshToken(refreshToken, userId);
  } catch (error) {
    logger.error('Refresh token save failed', {
      userId: String(userId),
      event: 'AuthRefresh',
      context: { error: error.message },
    });
  }
  return { token, refreshToken };
}

function parseStored(raw) {
  if (raw == null || raw === '' || raw === 'blacklisted') return null;
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.userId == null || data.userId === '') return null;
    return { userId: String(data.userId), createdAt: data.createdAt };
  } catch (_) {
    return null;
  }
}

async function readRefresh(token) {
  const client = global.redisClient;
  if (!client || !token) return null;
  const raw = await client.get(REFRESH_PREFIX + token);
  return parseStored(raw);
}

async function deleteRefresh(token, userId) {
  const client = global.redisClient;
  if (!client || !token) return;
  await client.del(REFRESH_PREFIX + token);
  if (userId && typeof client.sRem === 'function') {
    await client.sRem(USER_SET_PREFIX + String(userId), token);
  }
}

async function revokeUserRefreshTokens(userId) {
  const client = global.redisClient;
  if (!client || !userId) return;
  const setKey = USER_SET_PREFIX + String(userId);
  let members = [];
  if (typeof client.sMembers === 'function') {
    const listed = await client.sMembers(setKey);
    if (Array.isArray(listed)) members = listed;
  }
  for (const token of members) {
    await client.del(REFRESH_PREFIX + token);
  }
  await client.del(setKey);
}

// Save the replacement first so a crash does not drop both tokens.
async function rotateRefresh(oldToken) {
  const stored = await readRefresh(oldToken);
  if (!stored) return null;
  const refreshToken = newRefreshToken();
  await saveRefreshToken(refreshToken, stored.userId);
  await deleteRefresh(oldToken, stored.userId);
  return { userId: stored.userId, refreshToken };
}

async function revokeSessionRefresh(userId, presented) {
  const client = global.redisClient;
  if (!client) return;
  let presentedOwner = null;
  if (presented) {
    const stored = await readRefresh(presented);
    if (stored) presentedOwner = stored.userId;
  }
  if (userId) await revokeUserRefreshTokens(userId);
  if (presented && userId && presentedOwner === String(userId)) {
    await deleteRefresh(presented, userId);
  }
}

module.exports = {
  accessExpiresIn,
  refreshTtlSeconds,
  signAccessToken,
  issueSession,
  readRefresh,
  rotateRefresh,
  revokeSessionRefresh,
};
