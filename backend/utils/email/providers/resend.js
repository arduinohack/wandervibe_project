const { Resend } = require('resend');

async function send({ to, from, subject, text, html }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = { from, to, subject, text };
  if (typeof html === 'string' && html !== '') {
    payload.html = html;
  }

  const { error } = await resend.emails.send(payload);
  if (error) {
    const err = new Error(error.message || 'Resend send failed');
    err.statusCode = error.statusCode;
    err.provider = 'resend';
    throw err;
  }
}

module.exports = { send };
