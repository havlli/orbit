import fs from 'node:fs';
import path from 'node:path';

const client = path.resolve('dist/client');
const chunks = path.join(client, '_next/static/chunks');
const entries = fs
  .readdirSync(chunks)
  .filter((name) => /^image-bitmap-worker-client-[\w-]+\.js$/.test(name));
if (entries.length !== 1)
  throw new Error('Expected one deferred image decoder client.');
const source = fs.readFileSync(path.join(chunks, entries[0]), 'utf8');
if (source.includes('file:'))
  throw new Error('Image decoder client contains a filesystem URL.');
const urls = [
  ...source.matchAll(
    /[`'"](\/_next\/static\/[^`'"]*image-bitmap\.worker-[\w-]+\.js)[`'"]/g,
  ),
].map((match) => match[1]);
if (new Set(urls).size !== 1)
  throw new Error('Expected a browser-relative image decoder script.');
const worker = path.resolve(client, '.' + urls[0]);
if (!worker.startsWith(client + path.sep) || fs.statSync(worker).size === 0)
  throw new Error('Image decoder script is missing from the export.');

if (process.env.ORBIT_STATIC_EXPORT === '1') {
  const manifest = JSON.parse(
    fs.readFileSync('dist/server/vinext-prerender.json', 'utf8'),
  );
  if (
    manifest.routes.length !== 2 ||
    manifest.routes.some((route) => route.status !== 'rendered') ||
    !manifest.routes.some((route) => route.route === '/') ||
    !manifest.routes.some((route) => route.route === '/404')
  )
    throw new Error('Static export must render both routes with no skips.');
}
console.log('Image decoder script and export checks pass.');
