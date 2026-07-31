'use strict';
const client = require('./client');
module.exports = {
  online: () => client.get('/players.json', { attempts: 2 }),
  one: (steamId) => client.get(`/players/${encodeURIComponent(steamId)}.json`, { attempts: 2 }),
  all: ({ search = '', page = 1 } = {}) => client.get(`/players/all.json?search=${encodeURIComponent(search)}&page=${encodeURIComponent(page)}`, { attempts: 2 }),
  teleport: (steamId, location) => client.post(`/players/${encodeURIComponent(steamId)}/teleport`, location),
  currency: (steamId, action, amount) => client.post(`/players/${encodeURIComponent(steamId)}/currency`, { action, amount }),
  fame: (steamId, action, amount) => client.post(`/players/${encodeURIComponent(steamId)}/fame`, { action, amount }),
  kick: (steamId) => client.post(`/players/${encodeURIComponent(steamId)}/kick`, {}),
  ban: (steamId) => client.post(`/players/${encodeURIComponent(steamId)}/ban`, {}),
};
