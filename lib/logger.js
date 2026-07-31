'use strict';

const crypto = require('crypto');

function redact(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|password|secret|authorization|x-password|registration.?code/i.test(key)) out[key] = '[REDACTED]';
    else if (/ip(address)?$/i.test(key) && typeof entry === 'string') out[key] = entry.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.x.x');
    else out[key] = redact(entry);
  }
  return out;
}

function requestId(prefix = 'req') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function write(level, event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (event, fields) => { if (process.env.WATCHER_DEBUG === 'true') write('debug', event, fields); },
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  requestId,
  redact,
};
