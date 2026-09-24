const sgMail = require('@sendgrid/mail');  // For email sending
const User = require('../models/User');

// Set API key from .env
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

      const msg = {
        to: overrideTo || user.email,
        from: 'ken@eratespecialists.com',  // Your verified sender from SendGrid setup
        subject: 'WanderVibe Update',
        text: message,
      };
      await sgMail.send(msg);
      console.log('✅ Email sent via SendGrid');
    }
  } catch (err) {
    console.error('Notification error:', err);  // Logs but doesn't crash
  }
}

module.exports = { notifyUsers };
