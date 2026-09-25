const User = require('../models/User');
const { sendEmail, selectedProviderName } = require('./email/sendEmail');

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

// Notify users by email when their preferences allow it
async function notifyUsers(userIds, message, type = 'email') {
  try {
    console.log(`🔔 Notifying ${userIds.length} users via ${type}: "${message}"`);

    if (type !== 'email') {
      console.log(`Notification type "${type}" is not sent in this pass`);
      return;
    }

    const { to: overrideTo, mode } = emailDestination();
    console.log(`notifyUsers email mode: ${mode}`);

    const users = await User.find({ _id: { $in: userIds } }).select('email notificationPreferences');
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
}

module.exports = { notifyUsers };
