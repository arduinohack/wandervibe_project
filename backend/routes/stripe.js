const express = require('express');
const logger = require('../utils/logger');
const {
  BAD_SIGNATURE,
  NOT_CONFIGURED,
  readWebhookEvent,
  applyCheckoutEvent,
} = require('../utils/stripeCredits');

const router = express.Router();

// POST /api/stripe/webhook. Stripe calls this with the raw body. No login.
router.post('/', async (req, res) => {
  try {
    const event = readWebhookEvent(req.body, req.get('stripe-signature'));
    await applyCheckoutEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    const status = err && err.status === 400 ? 400 : 500;
    if (status === 400) return res.status(400).json({ message: BAD_SIGNATURE });
    const message = err && err.message ? err.message : 'request failed';
    logger.error(`Stripe webhook failed: ${message}`, { event: 'StripeWebhook' });
    if (message === NOT_CONFIGURED) {
      return res.status(500).json({ message: NOT_CONFIGURED });
    }
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
