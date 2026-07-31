'use strict';
const assert = require('assert');
function transition(state, event) {
  const allowed = {
    created: { verify: 'player_verified_online' },
    player_verified_online: { reserve: 'payment_reserved' },
    payment_reserved: { deliver: 'delivery_requested', refund: 'refund_pending' },
    delivery_requested: { confirm: 'delivery_confirmed', fail: 'delivery_failed' },
    delivery_confirmed: { complete: 'completed' },
    delivery_failed: { refund: 'refund_pending' },
    refund_pending: { refunded: 'refunded' },
  };
  return allowed[state]?.[event] || null;
}
assert.strictEqual(transition('created','verify'),'player_verified_online');
assert.strictEqual(transition('delivery_requested','fail'),'delivery_failed');
assert.strictEqual(transition('delivery_failed','refund'),'refund_pending');
assert.strictEqual(transition('refund_pending','refunded'),'refunded');
assert.strictEqual(transition('completed','deliver'),null);
console.log('transaction-state tests passed');
