const express = require('express');
const authMiddleware = require('./middleware/auth');
const requireAdmin = require('./middleware/requireAdmin');
const morgan = require('morgan');
const cors = require('cors');

const app = express();

// These origins stay allowed in every environment.
// Development (and an unset NODE_ENV) also allows http://localhost and
// http://127.0.0.1 on any port. Requests with no Origin stay allowed. Never emit *.
const adminOrigins = new Set([
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://192.168.1.140:8081',
]);

const devLocalOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

function developmentCors() {
  const env = process.env.NODE_ENV;
  if (env == null) return true;
  const value = String(env).trim();
  return value === '' || value === 'development';
}

function allowsBrowserOrigin(origin) {
  if (!origin) return true;
  if (adminOrigins.has(origin)) return true;
  return developmentCors() && devLocalOrigin.test(origin);
}

app.use(cors({
  origin(origin, callback) {
    if (!allowsBrowserOrigin(origin)) {
      callback(null, false);
      return;
    }
    callback(null, origin || true);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  optionsSuccessStatus: 204,
}));
app.use(express.json());  // Parses JSON bodies from requests (e.g., { name: 'Paris Trip' })
app.use(morgan('dev'));  // Logs requests to console
app.use('/api', require('./middleware/requestLog'));

// Mount auth routes (e.g., POST /api/auth/login)
app.use('/api/auth', require('./routes/auth'));

// Mount plans routes WITH authMiddleware (protects all /api/plans/*)
const plansRouter = require('./routes/plans');
const { planInviteRouter, invitesRouter } = require('./routes/invites');
app.use('/api/plans', authMiddleware, plansRouter, planInviteRouter);

// Activity API. The handlers live at /api/activities. /api/events is not mounted.
const eventRoutes = require('./routes/events');
app.use('/api/activities', eventRoutes);

// Mount invites routes WITH authMiddleware (protects all /api/invites/*)
app.use('/api/invites', authMiddleware, invitesRouter);

app.use('/api/admin', authMiddleware, requireAdmin, require('./routes/admin'));

// Temp test routes for auth (remove after Phase 2 testing)
app.get('/api/test-auth', authMiddleware, (req, res) => {
  res.json({ msg: 'Auth works!', userId: req.user.userId });
});

app.get('/api/protected', authMiddleware, (req, res) => {
  res.json({ msg: 'You\'re in!', userId: req.user.userId });
});

// Basic root route (health check)
app.get('/', (req, res) => {
  res.send('WanderVibe Backend is running!');
});

module.exports = app;
