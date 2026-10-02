const User = require('../models/User');
const { logSupport } = require('../utils/logSupport');

const ID_KEYS = ['planId', 'eventId', 'invitationId'];

function pathWithoutQuery(url) {
  const value = String(url || '');
  const query = value.indexOf('?');
  return query === -1 ? value : value.slice(0, query);
}

function mountPath(baseUrl, routePath) {
  const base = baseUrl || '';
  if (!routePath || routePath === '/') return base || '/';
  if (routePath.startsWith('/')) return `${base}${routePath}`;
  return `${base}/${routePath}`;
}

function requestLogEvent(req) {
  const method = req.method || 'GET';
  const routePath = req.route && req.route.path;
  if (typeof routePath === 'string') {
    return `${method} ${mountPath(req.baseUrl, routePath)}`;
  }
  return `${method} ${pathWithoutQuery(req.originalUrl || req.url)}`;
}

function skipList() {
  const raw = process.env.SUPPORT_LOG_SKIP;
  if (!raw || !String(raw).trim()) return [];
  return String(raw).split(',').map((part) => part.trim()).filter(Boolean);
}

function shouldSkipRequestLog(req) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'OPTIONS') return true;
  const path = pathWithoutQuery(req.originalUrl || req.url);
  if (method === 'GET' && path.startsWith('/api/admin/logs')) return true;
  return skipList().includes(requestLogEvent(req));
}

function levelForStatus(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

function readId(req, key) {
  const sources = [req.params, req.body];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function trimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// Login returns the account on the response as { user }. Copy only id and email.
function accountFromLoginResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const user = body.user;
  if (!user || typeof user !== 'object' || Array.isArray(user)) return {};
  const id = user._id || user.id || user.userId;
  const email = trimmedString(user.email);
  const noted = {};
  if (id) noted.actorUserId = String(id);
  if (email) noted.actorEmail = email;
  return noted;
}

function submittedEmail(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return '';
  return trimmedString(req.body.email);
}

async function actorUserIdForKnownEmail(email) {
  if (!email) return '';
  const account = await User.findOne({ email }).select('_id').lean();
  return account && account._id ? String(account._id) : '';
}

async function emailForUserId(userId) {
  if (!userId) return '';
  const account = await User.findById(userId).select('email').lean();
  return account ? trimmedString(account.email) : '';
}

// Attach on finish so a later auth middleware can set req.user first.
// The login account is copied here, before the support row is inserted.
async function writeRequestLog(req, res, responseBody) {
  if (shouldSkipRequestLog(req)) return;
  const eventName = requestLogEvent(req);
  const noted = req.supportAccount && typeof req.supportAccount === 'object'
    ? req.supportAccount
    : null;
  const blankLogout = eventName === 'POST /api/auth/logout' && res.statusCode === 401;
  let actorUserId;
  let actorEmail;
  if (!blankLogout && noted) {
    if (noted.actorUserId) actorUserId = String(noted.actorUserId);
    actorEmail = trimmedString(noted.actorEmail);
  } else if (!blankLogout) {
    const actor = req.user && (req.user.userId || req.user.id);
    if (actor) actorUserId = String(actor);
  }

  if (eventName === 'POST /api/auth/login' && res.statusCode === 200) {
    const fromResponse = accountFromLoginResponse(responseBody);
    if (fromResponse.actorUserId) actorUserId = fromResponse.actorUserId;
    if (fromResponse.actorEmail) actorEmail = fromResponse.actorEmail;
    if (!actorEmail) actorEmail = submittedEmail(req);
  } else if (eventName === 'POST /api/auth/login' && res.statusCode >= 400) {
    const email = submittedEmail(req);
    if (email) actorEmail = email;
    if (!actorUserId && email) {
      const knownId = await actorUserIdForKnownEmail(email);
      if (knownId) actorUserId = knownId;
    }
  } else if (eventName === 'POST /api/auth/logout' && res.statusCode === 200) {
    if (!actorUserId) {
      const actor = req.user && (req.user.userId || req.user.id);
      if (actor) actorUserId = String(actor);
    }
    if (actorUserId && !actorEmail) actorEmail = await emailForUserId(actorUserId);
  }

  const entry = {
    level: levelForStatus(res.statusCode),
    event: eventName,
    message: String(res.statusCode),
    extra: {
      method: req.method,
      path: pathWithoutQuery(req.originalUrl || req.url),
      statusCode: res.statusCode,
    },
  };
  if (actorUserId) entry.actorUserId = actorUserId;
  if (actorEmail) entry.actorEmail = actorEmail;
  for (const key of ID_KEYS) {
    const id = readId(req, key);
    if (id) entry[key] = id;
  }
  await logSupport(entry);
}

function requestLog(req, res, next) {
  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = function captureJson(payload) {
    responseBody = payload;
    return originalJson(payload);
  };
  res.on('finish', () => {
    writeRequestLog(req, res, responseBody).catch((err) => {
      console.error(`Support log insert failed: ${err.message}`);
    });
  });
  next();
}

module.exports = requestLog;
module.exports.requestLogEvent = requestLogEvent;
module.exports.shouldSkipRequestLog = shouldSkipRequestLog;
