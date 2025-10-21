const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure logs dir (absolute from backend root)
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`Created logs dir: ${logDir}`);  // Only if new
}

// Logger base
const logger = winston.createLogger({
  level: 'info',
  transports: [
    // Console: Pretty readable with timestamp (unchanged)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        winston.format.simple()
      )
    }),
    // File: Printf for exact ordered JSON (custom string builder)
    new winston.transports.DailyRotateFile({
        dirname: logDir,  // Your logs folder
        filename: 'app-%DATE%.log',  // e.g., app-2025-10-17.log
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,  // Compress old files
        maxSize: '20m',  // Rotate if >20MB (overrides maxsize)
        maxFiles: '14d',  // Keep 14 days
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),  // Adds time
            winston.format.errors({ stack: true }),  // Adds stacks if error
            winston.format((info) => {
                // Enforce defaults safely
                info.userId = info.userId || 'anonymous';
                info.event = info.event || 'unknown';
                info.context = info.context || {};
                info.message = info.message || '';
                return info;
            })(),
        winston.format.printf((info) => {
          // Build ordered object (your sequence)
          const ordered = {
            timestamp: info.timestamp,
            level: (info.level || 'UNKNOWN').toUpperCase(),
            userId: info.userId,
            event: info.event,
            message: info.message,
            context: info.context
          };
          // Merge extras (e.g., stack) into a copy (appends last)
          const extras = {};
          Object.keys(info).forEach(key => {
            if (!['timestamp', 'level', 'userId', 'event', 'message', 'context'].includes(key)) {
              extras[key] = info[key];
            }
          });
          Object.assign(ordered, extras);
          // Return stringified ordered JSON + newline
          return JSON.stringify(ordered);
        })
      )
    })
  ]
});

// Convenience: Wrap originals + defaults (unchanged)
const originalInfo = logger.info;
const originalError = logger.error;
const originalWarn = logger.warn;
const originalDebug = logger.debug;

logger.info = (message, options = {}) => {
  const { userId = 'anonymous', event = 'unknown', context = {} } = options;
  originalInfo.call(logger, message || '', { userId, event, context });
};
logger.error = (message, options = {}) => {
  const { userId = 'anonymous', event = 'unknown', context = {} } = options;
  originalError.call(logger, message || '', { userId, event, context });
};
logger.warn = (message, options = {}) => {
  const { userId = 'anonymous', event = 'unknown', context = {} } = options;
  originalWarn.call(logger, message || '', { userId, event, context });
};
logger.debug = (message, options = {}) => {
  const { userId = 'anonymous', event = 'unknown', context = {} } = options;
  originalDebug.call(logger, message || '', { userId, event, context });
};

module.exports = logger;