'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const projectRoot = path.resolve(__dirname, '..');
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const uploadKey = String(
  process.env.MAP_ASSET_UPLOAD_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  ''
).trim();
const bucket = String(process.env.PORTAL_MAP_STORAGE_BUCKET || 'outpost-x-static').trim();
const prefix = String(process.env.PORTAL_MAP_STORAGE_PREFIX || 'maps').trim().replace(/^\/+|\/+$/g, '');

if (!supabaseUrl || !uploadKey) {
  console.error('Missing SUPABASE_URL and an upload-capable key. Set MAP_ASSET_UPLOAD_KEY or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const client = createClient(supabaseUrl, uploadKey, { auth: { persistSession: false } });
const files = [
  { local: path.join(projectRoot, 'tracker-map.png'), remote: 'tracker-map.png', contentType: 'image/png' },
  { local: path.join(projectRoot, 'tracker-map-hi.webp'), remote: 'tracker-map-hi.webp', contentType: 'image/webp' },
];

const tilesRoot = path.join(projectRoot, 'portal-map-tiles', 'hi');
if (fs.existsSync(tilesRoot)) {
  for (const name of fs.readdirSync(tilesRoot).filter((name) => /^\d+_\d+\.jpg$/i.test(name)).sort()) {
    files.push({ local: path.join(tilesRoot, name), remote: `tiles/hi/${name}`, contentType: 'image/jpeg' });
  }
}

function remotePath(relative) {
  return [prefix, relative].filter(Boolean).join('/');
}

async function ensurePublicBucket() {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;
  const existing = (buckets || []).find((item) => item.name === bucket);
  if (!existing) {
    const { error } = await client.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 25 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/webp', 'image/jpeg'],
    });
    if (error) throw error;
    console.log(`Created public bucket: ${bucket}`);
    return;
  }
  if (!existing.public) {
    const { error } = await client.storage.updateBucket(bucket, {
      public: true,
      fileSizeLimit: 25 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/webp', 'image/jpeg'],
    });
    if (error) throw error;
    console.log(`Updated bucket to public: ${bucket}`);
  }
}

async function uploadAll() {
  if (!files.length || files.some((file) => !fs.existsSync(file.local))) {
    throw new Error('Map source files are missing. Run this uploader from the one-time map asset package before deploying the slim project.');
  }
  await ensurePublicBucket();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const target = remotePath(file.remote);
    const body = fs.readFileSync(file.local);
    const { error } = await client.storage.from(bucket).upload(target, body, {
      contentType: file.contentType,
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) throw new Error(`${target}: ${error.message}`);
    console.log(`[${i + 1}/${files.length}] Uploaded ${target}`);
  }
  const base = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${prefix.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`.replace(/\/$/, '');
  console.log('\nUpload complete.');
  console.log(`Public asset base: ${base}`);
  console.log('The slim Watcher project will derive this URL automatically from SUPABASE_URL and the default bucket/prefix.');
  console.log('Optional Railway override:');
  console.log(`PORTAL_MAP_ASSET_BASE_URL=${base}`);
}

uploadAll().catch((error) => {
  console.error(`Map upload failed: ${error.message}`);
  process.exit(1);
});
