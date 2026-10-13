const sgMail = require('@sendgrid/mail');

async function send({ to, from, subject, text, html }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const msg = { to, from, subject, text };
  if (typeof html === 'string' && html !== '') {
    msg.html = html;
  }
  const [response] = await sgMail.send(msg);
  return { statusCode: response && response.statusCode };
}

module.exports = { send };
