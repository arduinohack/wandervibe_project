const providers = {
  resend: require('./providers/resend'),
  sendgrid: require('./providers/sendgrid'),
  console: require('./providers/console'),
};

const DEFAULT_FROM = 'ken@eratespecialists.com';

function selectedProviderName() {
  return (typeof process.env.EMAIL_PROVIDER === 'string' ? process.env.EMAIL_PROVIDER.trim().toLowerCase() : '') || 'resend';
}

function selectedFrom() {
  const raw = process.env.EMAIL_FROM;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  return DEFAULT_FROM;
}

async function sendEmail({ to, subject, text, html }) {
  const providerName = selectedProviderName();
  const provider = providers[providerName];
  if (!provider) {
    const err = new Error(`Unknown email provider: ${providerName}`);
    err.provider = providerName;
    throw err;
  }

  try {
    await provider.send({
      to,
      from: selectedFrom(),
      subject,
      text,
      html,
    });
  } catch (err) {
    if (!err.provider) err.provider = providerName;
    throw err;
  }
}

module.exports = { sendEmail, selectedProviderName };
