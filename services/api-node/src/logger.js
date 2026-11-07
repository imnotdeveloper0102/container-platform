// Structured JSON logging: one JSON object per line on stdout.
// Fields: timestamp (ISO), level, msg, plus any extra fields passed in
// (request_id, method, path, status, ...). No secrets are ever logged.
'use strict';

function log(level, msg, extra) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...(extra || {}),
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

const logger = {
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};

module.exports = { logger };
