import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Genera `sw.js` al terminar el build: precachea todo `dist/` con rutas relativas
 * (funciona bajo cualquier subruta) y versiona la caché con un hash del contenido.
 */
export function pwaPlugin(appId: string): Plugin {
  let outDir = '';
  return {
    name: `pwa-${appId}`,
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).split(sep).join('/'));
        }
      };
      walk(outDir);
      // sw.js no se precachea a sí mismo; los .woff antiguos sobran porque todo navegador con service worker lee woff2.
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.woff') && !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const list = ['./', ...precache.map((f) => `./${f}`)];
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource(appId, version, list));
    },
  };
}

function serviceWorkerSource(appId: string, version: string, files: string[]): string {
  return `// Service worker de ${appId} generado en el build. No editar a mano.
const PREFIX = '${appId}-';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)));
});
`;
}
