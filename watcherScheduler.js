'use strict';

const log = require('./lib/logger');
const deploymentCoordinator = require('./deploymentCoordinator');
const tasks = new Map();

function nowIso() { return new Date().toISOString(); }
function normalizeMs(value, fallback) { const n = Number(value); return Number.isFinite(n) && n >= 1000 ? n : fallback; }

function registerTask(name, intervalMs, handler, options = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Scheduler task requires a name and handler.');
  stopTask(name);
  const task = {
    name,
    intervalMs: normalizeMs(intervalMs, 60_000),
    handler,
    essential: options.essential === true,
    leaderOnly: options.leaderOnly !== false,
    jitterMs: Math.max(0, Number(options.jitterMs || 0)),
    timer: null,
    running: false,
    enabled: options.enabled !== false,
    nextRunAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastDurationMs: null,
    consecutiveFailures: 0,
    runCount: 0,
    skipCount: 0,
  };
  tasks.set(name, task);
  const firstDelay = Math.max(0, Number(options.initialDelayMs ?? Math.min(task.intervalMs, 5000)));
  schedule(task, firstDelay);
  return task;
}

function schedule(task, delayMs) {
  if (!task.enabled) return;
  clearTimeout(task.timer);
  const jitter = task.jitterMs ? Math.floor(Math.random() * task.jitterMs) : 0;
  const delay = Math.max(0, delayMs + jitter);
  task.nextRunAt = new Date(Date.now() + delay).toISOString();
  task.timer = setTimeout(() => runTask(task.name), delay);
  task.timer.unref?.();
}

async function runTask(name) {
  const task = tasks.get(name);
  if (!task || !task.enabled) return;
  if (task.leaderOnly && !deploymentCoordinator.isLeader()) {
    task.skipCount += 1;
    schedule(task, task.intervalMs);
    return;
  }
  if (task.running) {
    task.skipCount += 1;
    schedule(task, task.intervalMs);
    return;
  }
  task.running = true;
  task.lastStartedAt = nowIso();
  task.runCount += 1;
  const started = Date.now();
  try {
    await task.handler();
    task.lastSuccessAt = nowIso();
    task.lastError = null;
    task.consecutiveFailures = 0;
    log.info('scheduler.task.completed', { task: name, durationMs: Date.now() - started });
  } catch (error) {
    task.lastErrorAt = nowIso();
    task.lastError = String(error?.message || error).slice(0, 500);
    task.consecutiveFailures += 1;
    log.error('scheduler.task.failed', { task: name, durationMs: Date.now() - started, consecutiveFailures: task.consecutiveFailures, message: task.lastError });
  } finally {
    task.lastDurationMs = Date.now() - started;
    task.running = false;
    task.lastFinishedAt = nowIso();
    schedule(task, task.intervalMs);
  }
}

function stopTask(name) {
  const task = tasks.get(name);
  if (!task) return false;
  task.enabled = false;
  clearTimeout(task.timer);
  tasks.delete(name);
  return true;
}
function stopAll() { for (const name of [...tasks.keys()]) stopTask(name); }
function setTaskEnabled(name, enabled) {
  const task = tasks.get(name);
  if (!task) return false;
  task.enabled = !!enabled;
  if (task.enabled) schedule(task, 0); else clearTimeout(task.timer);
  return true;
}
function snapshot() { return [...tasks.values()].map(({ handler, timer, ...task }) => ({ ...task })); }
module.exports = { registerTask, runTask, stopTask, stopAll, setTaskEnabled, snapshot };
