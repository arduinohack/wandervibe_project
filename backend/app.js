const express = require('express');
const authMiddleware = require('./middleware/auth');
const requireAdmin = require('./middleware/requireAdmin');
const morgan = require('morgan');
const cors = require('cors');

const app = express();

// Browser calls from the static admin page. Requests with no Origin (native app, curl) stay allowed.
const browserOrigins = new Set([
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || browserOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
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

// Mount events under /api/events (uses events.js handler)
const eventRoutes = require('./routes/events');
app.use('/api/events', eventRoutes);

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
