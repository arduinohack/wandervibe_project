const crypto = require('crypto');
const { sendEmail } = require('./email/sendEmail');

const VERIFY_HOURS = 24;
const INVALID_LINK = 'Invalid or expired verification link.';
const ALREADY_VERIFIED = 'Your email is already verified.';
const VERIFICATION_SENT = 'Verification email sent.';

function hashVerifyToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function buildVerification(now = new Date()) {
  const raw = crypto.randomBytes(32).toString('base64url');
  return {
    raw,
    hash: hashVerifyToken(raw),
    expires: new Date(now.getTime() + VERIFY_HOURS * 60 * 60 * 1000),
  };
}

// The suite creates plans right after register. Those files leave this unset,
// so the account is stored as already verified and no mail is sent. The email
// verification tests set EMAIL_VERIFY_GATE=1 and exercise the real path.
function mustVerifyEmail() {
  return process.env.JEST_WORKER_ID == null || process.env.EMAIL_VERIFY_GATE === '1';
}

function verificationLink(raw) {
  return `https://planitvibe.com/verify-email?token=${encodeURIComponent(raw)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendVerificationEmail(to, raw) {
  const link = verificationLink(raw);
  const safe = escapeHtml(link);
  await sendEmail({
    to,
    subject: 'PlanItVibe email verification',
    text: `PlanItVibe: verify your email: ${link}\nThis link expires in ${VERIFY_HOURS} hours.`,
    html: `<p>PlanItVibe: verify your email: <a href="${safe}">${safe}</a></p><p>This link expires in ${VERIFY_HOURS} hours.</p>`,
  });
}

module.exports = {
  INVALID_LINK,
  ALREADY_VERIFIED,
  VERIFICATION_SENT,
  hashVerifyToken,
  buildVerification,
  mustVerifyEmail,
  verificationLink,
  sendVerificationEmail,
};
