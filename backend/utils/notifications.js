const User = require('../models/User');
const { sendEmail, selectedProviderName } = require('./email/sendEmail');
const { sendSms } = require('./sms');

const DEV_EMAIL = 'w.ken.allen@gmail.com';

function emailDestination() {
  const override = process.env.NOTIFY_OVERRIDE_EMAIL;
  if (typeof override === 'string' && override.trim() !== '') {
    return { to: override.trim(), mode: 'override (NOTIFY_OVERRIDE_EMAIL)' };
  }
  if (process.env.NODE_ENV === 'development') {
    return { to: DEV_EMAIL, mode: 'override (NODE_ENV=development)' };
  }
  return { to: null, mode: 'user-email' };
}

function smsDestination() {
  const override = process.env.NOTIFY_OVERRIDE_SMS;
  if (typeof override === 'string' && override.trim() !== '') {
    return { to: override.trim(), mode: 'override (NOTIFY_OVERRIDE_SMS)' };
  }
  if (process.env.NODE_ENV === 'development') {
    return { to: null, mode: 'skip (NODE_ENV=development)' };
  }
  return { to: null, mode: 'user-phone' };
}

function smsTo(user, overrideTo, mode) {
  if (overrideTo) return overrideTo;
  if (mode !== 'user-phone') return '';
  return typeof user.phoneNumber === 'string' ? user.phoneNumber.trim() : '';
}

// SMS errors stay here so a failed text does not skip email or the request handler.
async function deliverSms(users, message) {
  try {
    const { to: overrideTo, mode } = smsDestination();
    console.log(`notifyUsers sms mode: ${mode}`);
    for (const user of users) {
      try {
        const prefs = user.notificationPreferences || {};
        if (prefs.sms !== true) continue;
        const to = smsTo(user, overrideTo, mode);
        if (!to) continue;
        await sendSms({ to, body: message });
      } catch (err) {
        console.error(`SMS notification error: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`SMS notification error: ${err.message}`);
  }
}

// Notify users by email, then SMS when they opted in.
async function notifyUsers(userIds, message, type = 'email') {
  let users = [];
  try {
    console.log(`🔔 Notifying ${userIds.length} users via ${type}: "${message}"`);

    if (type !== 'email') {
      console.log(`Notification type "${type}" is not sent in this pass`);
      return;
    }

    const { to: overrideTo, mode } = emailDestination();
    console.log(`notifyUsers email mode: ${mode}`);

    users = await User.find({ _id: { $in: userIds } }).select('email phoneNumber notificationPreferences');
    for (const user of users) {
      const prefs = user.notificationPreferences || {};
      if (prefs.email === false) continue;
      if (!user.email) continue;

      await sendEmail({
        to: overrideTo || user.email,
        subject: 'WanderVibe Update',
        text: message,
      });
      console.log(`✅ Email sent via ${selectedProviderName()}`);
    }
  } catch (err) {
    const status = (err.response && err.response.statusCode) || err.statusCode;
    const provider = err.provider || selectedProviderName();
    console.error(`Notification error: provider ${provider}: ${err.message}${status ? ` status ${status}` : ''}`);
  }

  await deliverSms(users, message);
}

module.exports = { notifyUsers };
