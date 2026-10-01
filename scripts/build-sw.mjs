import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";

const root = resolve("dist");
async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? filesAt(resolve(directory, entry.name))
        : [resolve(directory, entry.name)],
    ),
  );
  return nested.flat();
}
const files = (await filesAt(root))
  .filter((file) => !file.endsWith("sw.js"))
  .sort();
const digest = createHash("sha256");
for (const file of files) digest.update(await readFile(file));
const cacheName = `dungeon-architect-${digest.digest("hex").slice(0, 12)}`;
const urls = [
  "./",
  ...files.map((file) => `./${relative(root, file).replaceAll("\\", "/")}`),
];
await writeFile(
  resolve(root, "sw.js"),
  `
const CACHE = ${JSON.stringify(cacheName)};
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dungeon-architect-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('./index.html', { ignoreVary: true }))));
  } else {
    // Bundled files are invariant. Dev/preview servers may send Vary: Origin;
    // module requests and install-time precache requests use different modes.
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, { ignoreVary: true })).then(cached => cached || fetch(event.request)));
  }
});
`,
);
console.log(`Offline cache generated: ${files.length} assets.`);
