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

// Attach on finish so a later auth middleware can set req.user first.
function requestLog(req, res, next) {
  res.on('finish', () => {
    try {
      if (shouldSkipRequestLog(req)) return;
      const actor = req.user && (req.user.userId || req.user.id);
      const entry = {
        level: levelForStatus(res.statusCode),
        event: requestLogEvent(req),
        message: String(res.statusCode),
        extra: {
          method: req.method,
          path: pathWithoutQuery(req.originalUrl || req.url),
          statusCode: res.statusCode,
        },
      };
      if (actor) entry.actorUserId = String(actor);
      for (const key of ID_KEYS) {
        const id = readId(req, key);
        if (id) entry[key] = id;
      }
      logSupport(entry);
    } catch (err) {
      console.error(`Support log insert failed: ${err.message}`);
    }
  });
  next();
}

module.exports = requestLog;
module.exports.requestLogEvent = requestLogEvent;
module.exports.shouldSkipRequestLog = shouldSkipRequestLog;
