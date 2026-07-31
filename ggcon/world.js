'use strict';
const client = require('./client');
module.exports = {
  server: () => client.get('/server.json', { attempts: 2 }),
  weather: () => client.get('/weather.json', { attempts: 2 }),
  flags: () => client.get('/flags.json', { attempts: 2 }),
  squads: () => client.get('/squads.json', { attempts: 2 }),
  fps: () => client.get('/fps.json', { attempts: 2 }),
};
