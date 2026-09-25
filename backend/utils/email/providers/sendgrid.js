const sgMail = require('@sendgrid/mail');

async function send({ to, from, subject, text, html }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const msg = { to, from, subject, text };
  if (typeof html === 'string' && html !== '') {
    msg.html = html;
  }
  await sgMail.send(msg);
}

module.exports = { send };
