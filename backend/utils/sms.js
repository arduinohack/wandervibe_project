// Never log TEXTBELT_KEY, request headers, or the raw env.

const TEXTBELT_URL = 'https://textbelt.com/text';

function providerName() {
  const raw = process.env.SMS_PROVIDER;
  if (typeof raw !== 'string') return 'console';
  return raw.trim().toLowerCase() || 'console';
}

function normalizeSmsTo(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  return trimmed;
}

function textbeltKey() {
  const raw = process.env.TEXTBELT_KEY;
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function logSmsFailure(status, payload) {
  const details = [`SMS failed: provider textbelt`];
  if (status) details.push(`status ${status}`);
  if (payload && payload.error) details.push(`error ${payload.error}`);
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'success')) {
    details.push(`success ${payload.success}`);
  }
  if (payload && payload.quotaRemaining !== undefined && payload.quotaRemaining !== null) {
    details.push(`quotaRemaining ${payload.quotaRemaining}`);
  }
  console.error(details.join(' '));
}

async function sendTextbelt(phone, message) {
  const key = textbeltKey();
  if (!key) {
    console.error('SMS skipped: provider textbelt TEXTBELT_KEY is empty');
    return;
  }

  let response;
  try {
    response = await fetch(TEXTBELT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message, key }),
    });
  } catch (err) {
    console.error(`SMS failed: provider textbelt ${err && err.message ? err.message : 'request failed'}`);
    return;
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch (err) {
    payload = {};
  }
  if (!payload || typeof payload !== 'object') payload = {};

  if (!response.ok || payload.success === false) {
    logSmsFailure(response.status, payload);
    return;
  }

  const quota = payload.quotaRemaining !== undefined && payload.quotaRemaining !== null
    ? ` quotaRemaining ${payload.quotaRemaining}`
    : '';
  console.log(`SMS sent via textbelt status ${response.status}${quota}`);
}

async function sendSms({ to, body } = {}) {
  const name = providerName();
  const phone = normalizeSmsTo(to);
  const message = typeof body === 'string' ? body : '';
  if (!phone) {
    console.error('SMS skipped: no destination');
    return;
  }

  if (name === 'console') {
    const preview = message.slice(0, 80);
    console.log(`SMS console provider: to ${phone} length ${message.length} preview ${preview}`);
    return;
  }

  if (name === 'textbelt') {
    await sendTextbelt(phone, message);
    return;
  }

  console.error(`SMS skipped: provider ${name} is unknown`);
}

module.exports = { sendSms };
