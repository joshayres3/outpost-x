'use strict';
const client = require('./client');
module.exports = {
  item: (steamId, item, qty = 1) => client.post('/spawn', { steamId, item, qty }, { requireConfirmed: true }),
  vehicle: (steamId, vehicle) => client.post('/spawn-vehicle', { steamId, vehicle }, { requireConfirmed: true }),
  entity: (steamId, verb, entity) => client.post('/spawn-entity', { steamId, verb, ...(entity ? { entity } : {}) }, { requireConfirmed: true }),
};
