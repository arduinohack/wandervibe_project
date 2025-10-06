const sgMail = require('@sendgrid/mail');  // For email sending

// Set API key from .env
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Stub function: Notify users (expand for SMS/push later)
async function notifyUsers(userIds, message, type = 'email') {
  try {
    // TODO: Fetch full user data (e.g., email/phone) from DB
    // For now, log and send to test email (replace with real user emails)
    console.log(`🔔 Notifying ${userIds.length} users via ${type}: "${message}"`);

    if (type === 'email') {
      // Example: Send to a test email (update to dynamic user.emails later)
      const msg = {
        to: 'w.ken.allen@gmail.com',  // Placeholder—pull from users collection in full impl
        from: 'ken@eratespecialists.com',  // Your verified sender from SendGrid setup
        subject: 'WanderVibe Update',
        text: message,
      };
      await sgMail.send(msg);
      console.log('✅ Email sent via SendGrid');
    }
    // TODO: Add Twilio for 'sms', Firebase for 'push'
  } catch (err) {
    console.error('Notification error:', err);  // Logs but doesn't crash
  }
}

module.exports = { notifyUsers };