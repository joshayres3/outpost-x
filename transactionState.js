'use strict';

const TRANSITIONS = Object.freeze({
  created: Object.freeze({ verify: 'player_verified_online' }),
  player_verified_online: Object.freeze({ reserve: 'payment_reserved' }),
  payment_reserved: Object.freeze({ deliver: 'delivery_requested', refund: 'refund_pending' }),
  delivery_requested: Object.freeze({ confirm: 'delivery_confirmed', fail: 'delivery_failed' }),
  delivery_confirmed: Object.freeze({ complete: 'completed' }),
  delivery_failed: Object.freeze({ refund: 'refund_pending' }),
  refund_pending: Object.freeze({ refunded: 'refunded', fail: 'refund_failed' }),
});
function next(state, event) { return TRANSITIONS[state]?.[event] || null; }
function transition(state, event) {
  const value = next(state, event);
  if (!value) throw new Error(`Invalid transaction transition: ${state} -> ${event}`);
  return value;
}
module.exports = { TRANSITIONS, next, transition };
