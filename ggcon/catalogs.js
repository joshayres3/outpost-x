'use strict';
const client = require('./client');
module.exports = {
  items: () => client.get('/items.json', { attempts: 2 }),
  vehicles: () => client.get('/vehicle-types.json', { attempts: 2 }),
  iconUrl: (ico) => ico ? `https://icons.gghost.games/icons/${encodeURIComponent(ico)}.webp` : null,
};
