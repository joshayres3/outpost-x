'use strict';

const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(require.resolve('../tracker.js'), 'utf8');

assert.match(src, /url\.pathname === '\/health' \|\| url\.pathname === '\/healthz'/, 'liveness route must include /health and /healthz');
assert.match(src, /return json\(res, 200, \{ ok: true, status: 'alive' \}\)/, '/health must always return HTTP 200 once the web server is serving requests');
assert.match(src, /url\.pathname === '\/tracker\/health' \|\| url\.pathname === '\/ready'/, 'readiness must be separate from liveness');
assert.match(src, /return json\(res, ready \? 200 : 503/, 'readiness may return 503 until Watcher dependencies are ready');

const oldCoupledPattern = /url\.pathname === '\/tracker\/health' \|\| url\.pathname === '\/health' \|\| url\.pathname === '\/healthz'/;
assert.ok(!oldCoupledPattern.test(src), 'Railway liveness must not be coupled to Watcher readiness');

console.log('health-liveness.test.js passed');
