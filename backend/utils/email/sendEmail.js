const providers = {
  resend: require('./providers/resend'),
  sendgrid: require('./providers/sendgrid'),
  console: require('./providers/console'),
};

const DEFAULT_FROM = 'ken@eratespecialists.com';
const FROM_DISPLAY_NAME = 'PlanItVibe';

function selectedProviderName() {
  return (typeof process.env.EMAIL_PROVIDER === 'string' ? process.env.EMAIL_PROVIDER.trim().toLowerCase() : '') || 'resend';
}

function fromAddress(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const angled = value.match(/^(.*)<([^<>]+)>\s*$/);
  if (angled) return angled[2].trim();
  return value || DEFAULT_FROM;
}

function selectedFrom() {
  const raw = process.env.EMAIL_FROM;
  const address = fromAddress(typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_FROM);
  return `${FROM_DISPLAY_NAME} <${address}>`;
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

module.exports = { sendEmail, selectedProviderName, selectedFrom };
