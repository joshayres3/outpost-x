'use strict';

class WatcherError extends Error {
  constructor(message, options = {}) {
    super(message || 'Watcher operation failed.');
    this.name = 'WatcherError';
    this.code = options.code || 'WATCHER_ERROR';
    this.source = options.source || 'watcher';
    this.retryable = options.retryable === true;
    this.status = Number(options.status || 0) || 0;
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

function normalizeError(error, defaults = {}) {
  if (error instanceof WatcherError) return error;
  return new WatcherError(error?.message || String(error), {
    code: defaults.code,
    source: defaults.source,
    retryable: defaults.retryable,
    status: defaults.status,
    details: defaults.details,
    cause: error,
  });
}

module.exports = { WatcherError, normalizeError };
