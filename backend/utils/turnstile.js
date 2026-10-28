const axios = require('axios');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const NOT_CONFIGURED = 'Registration verification is not configured.';
const FAILED = 'Verification failed. Please try again.';

// The suite registers without a Turnstile token. Those files leave this unset.
// Production always checks. The Turnstile tests set TURNSTILE_TEST=1.
function turnstileRequired() {
  return process.env.JEST_WORKER_ID == null || process.env.TURNSTILE_TEST === '1';
}

function turnstileSecret() {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (typeof secret !== 'string') return '';
  return secret.trim();
}

// Returns { ok: true } or { ok: false, status, message, error? }.
// error is a short reason for logs. It never includes the token or the secret.
async function checkTurnstile(token, remoteIp) {
  if (!turnstileRequired()) return { ok: true };

  if (!turnstileSecret()) {
    return { ok: false, status: 503, message: NOT_CONFIGURED };
  }

  const value = typeof token === 'string' ? token.trim() : '';
  if (!value) {
    return { ok: false, status: 400, message: FAILED };
  }

  try {
    const passed = await verifyTurnstile(value, remoteIp);
    if (!passed) return { ok: false, status: 400, message: FAILED };
  } catch (err) {
    const reason = err && err.message ? String(err.message) : 'siteverify error';
    return { ok: false, status: 400, message: FAILED, error: reason };
  }

  return { ok: true };
}

async function verifyTurnstile(token, remoteIp) {
  const params = new URLSearchParams();
  params.append('secret', turnstileSecret());
  params.append('response', token);
  if (typeof remoteIp === 'string' && remoteIp.trim()) {
    params.append('remoteip', remoteIp.trim());
  }
  const response = await axios.post(SITEVERIFY_URL, params, { timeout: 10000 });
  return Boolean(response && response.data && response.data.success === true);
}

module.exports = {
  SITEVERIFY_URL,
  NOT_CONFIGURED,
  FAILED,
  turnstileRequired,
  turnstileSecret,
  checkTurnstile,
};
