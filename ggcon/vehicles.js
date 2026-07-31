'use strict';
const client = require('./client');
module.exports = {
  list: () => client.get('/vehicles.json', { attempts: 2 }),
  types: () => client.get('/vehicle-types.json', { attempts: 2 }),
  spawnForPlayer: (steamId, vehicle) => client.post('/spawn-vehicle', { steamId, vehicle }, { requireConfirmed: true }),
  spawnAt: (vehicleClass, location) => client.post('/vehicles/spawn', { class: vehicleClass, ...location }),
  destroy: (vehicleId) => client.post(`/vehicles/${encodeURIComponent(vehicleId)}/destroy`, {}),
};
