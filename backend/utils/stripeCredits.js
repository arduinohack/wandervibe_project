const logger = require('./logger');
const { add } = require('./aiCredits');
const StripeEvent = require('../models/StripeEvent');

const CREDIT_PACKS = {
  100: 100,
  500: 500,
};

const BAD_PACK = 'Pack must be 100 or 500';
const BAD_SIGNATURE = 'Invalid signature';
const NOT_CONFIGURED = 'Credit packs are not configured';
const CHECKOUT_FAILED = 'Could not start checkout';

function envValue(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function packCredits(pack) {
  const text = typeof pack === 'number' && Number.isFinite(pack)
    ? String(pack)
    : typeof pack === 'string'
      ? pack.trim()
      : '';
  if (text === '100') return CREDIT_PACKS[100];
  if (text === '500') return CREDIT_PACKS[500];
  return 0;
}

function priceEnv(credits) {
  if (credits === 100) return 'STRIPE_PRICE_CREDITS_100';
  if (credits === 500) return 'STRIPE_PRICE_CREDITS_500';
  return '';
}

function stripeClient() {
  const key = envValue('STRIPE_SECRET_KEY');
  if (!key) return null;
  const Stripe = require('stripe');
  return Stripe(key);
}

function returnUrls() {
  return {
    success_url: envValue('STRIPE_SUCCESS_URL') || 'https://planitvibe.com/?checkout=success',
    cancel_url: envValue('STRIPE_CANCEL_URL') || 'https://planitvibe.com/?checkout=cancel',
  };
}

function duplicateKey(err) {
  if (!err) return false;
  if (err.code === 11000) return true;
  return Boolean(err.cause && err.cause.code === 11000);
}

async function createCreditCheckout({ userId, pack }) {
  if (typeof pack !== 'string') return { status: 400, body: { message: BAD_PACK } };
  const credits = packCredits(pack);
  if (!credits) return { status: 400, body: { message: BAD_PACK } };
  const price = envValue(priceEnv(credits));
  const stripe = stripeClient();
  if (!stripe || !price) return { status: 503, body: { message: NOT_CONFIGURED } };
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: userId,
      metadata: { userId, credits: String(credits) },
      ...returnUrls(),
    });
    const url = session && typeof session.url === 'string' ? session.url.trim() : '';
    if (!url) return { status: 502, body: { message: CHECKOUT_FAILED } };
    return { status: 200, body: { url } };
  } catch (err) {
    const message = err && err.message ? err.message : 'request failed';
    logger.error(`Stripe checkout failed: ${message}`, {
      event: 'StripeCheckout',
      userId,
    });
    return { status: 502, body: { message: CHECKOUT_FAILED } };
  }
}

function readWebhookEvent(rawBody, signature) {
  const secret = envValue('STRIPE_WEBHOOK_SECRET');
  const stripe = stripeClient();
  if (!secret || !stripe) {
    const error = new Error(NOT_CONFIGURED);
    error.status = 500;
    throw error;
  }
  try {
    return stripe.webhooks.constructEvent(rawBody, signature || '', secret);
  } catch (_) {
    const error = new Error(BAD_SIGNATURE);
    error.status = 400;
    throw error;
  }
}

function sessionUserId(session) {
  const metadata = session && session.metadata;
  const userId = metadata && metadata.userId;
  return typeof userId === 'string' ? userId.trim() : '';
}

async function applyCheckoutEvent(event) {
  if (!event || event.type !== 'checkout.session.completed') return;
  const session = event.data && event.data.object;
  if (!session || session.payment_status !== 'paid') return;
  const userId = sessionUserId(session);
  const credits = packCredits(session.metadata && session.metadata.credits);
  const eventId = typeof event.id === 'string' ? event.id.trim() : '';
  if (!eventId || !userId || !credits) {
    logger.error('Stripe checkout session was missing a user or pack', {
      event: 'StripeWebhook',
      context: { eventId },
    });
    return;
  }
  let claimed = false;
  try {
    await StripeEvent.create({
      _id: eventId,
      sessionId: typeof session.id === 'string' ? session.id : '',
      userId,
      credits,
    });
    claimed = true;
    const balance = await add(userId, credits);
    if (balance == null) {
      logger.error('Stripe checkout user was not found', {
        event: 'StripeWebhook',
        userId,
        context: { eventId },
      });
    }
  } catch (err) {
    if (duplicateKey(err)) return;
    if (claimed) await StripeEvent.deleteOne({ _id: eventId });
    throw err;
  }
}

module.exports = {
  CREDIT_PACKS,
  BAD_PACK,
  BAD_SIGNATURE,
  NOT_CONFIGURED,
  CHECKOUT_FAILED,
  createCreditCheckout,
  readWebhookEvent,
  applyCheckoutEvent,
};
