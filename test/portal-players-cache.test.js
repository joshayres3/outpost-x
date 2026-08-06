const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'portal.js'), 'utf8');
const tracker = fs.readFileSync(path.join(root, 'tracker.js'), 'utf8');

assert(portal.includes('<b>Players</b>'), 'Admin tile must be labeled Players.');
assert(portal.includes('<h3>Players</h3>'), 'Player directory heading must be labeled Players.');
assert(!portal.includes('Find a Player') && !portal.includes('Find Player'), 'Old Find Player label must be removed.');
assert(portal.includes('setTimeout(loadAdminPlayers,0)'), 'Players view must load the online player list automatically.');
assert(portal.includes("if(!q)return loadAdminPlayers()"), 'Clearing search must restore the online list.');

assert(tracker.includes("crypto.createHash('sha256')"), 'Portal asset version must use a content hash.');
assert(tracker.includes("'no-cache, must-revalidate'"), 'Portal JS/CSS must revalidate instead of using a stale immutable URL.');
assert(!tracker.includes("fs.statSync(file).mtimeMs"), 'Portal version must not rely on ZIP-preserved timestamps.');

console.log('portal players/cache tests passed');
