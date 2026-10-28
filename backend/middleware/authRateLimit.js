const { rateLimit, MemoryStore } = require('express-rate-limit');

const TOO_MANY_ATTEMPTS = 'Too many attempts. Try again later.';

// Hit counts live in memory for this one process. A multi-instance deploy
// needs a shared Redis store so a client cannot reset the window by reaching
// another process.

function limitsOffForSuite() {
  // The rest of the suite registers and logs in many times from one IP.
  // Those files leave this unset. The auth rate-limit tests set it so the
  // real windows apply.
  return process.env.JEST_WORKER_ID != null && process.env.AUTH_RATE_LIMIT !== '1';
}

function authLimiter({ windowMs, limit, store }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: TOO_MANY_ATTEMPTS },
    // The default key is req.ip. trust proxy is 1, so behind Nginx that is
    // the client address.
    store,
    skip: () => limitsOffForSuite(),
  });
}

const registerStore = new MemoryStore();
const loginStore = new MemoryStore();
const forgotPasswordStore = new MemoryStore();

const registerLimiter = authLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  store: registerStore,
});

const loginLimiter = authLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  store: loginStore,
});

const forgotPasswordLimiter = authLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  store: forgotPasswordStore,
});

async function resetAuthRateLimits() {
  await Promise.all([
    registerStore.resetAll(),
    loginStore.resetAll(),
    forgotPasswordStore.resetAll(),
  ]);
}

function shutdownAuthRateLimits() {
  registerStore.shutdown();
  loginStore.shutdown();
  forgotPasswordStore.shutdown();
}

module.exports = {
  registerLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  resetAuthRateLimits,
  shutdownAuthRateLimits,
  TOO_MANY_ATTEMPTS,
};
