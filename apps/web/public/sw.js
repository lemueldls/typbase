/**
 * Offline shell for the web build.
 *
 * Workspace data already lives in OPFS/IndexedDB, so the only network
 * dependency is the app itself: the document, hashed chunks, fonts, and the
 * Typst wasm. The host caches those for 10 minutes and browsers do not promise
 * stale-on-error, so a cold reload offline fails without this worker.
 *
 * - install precaches the document and the chunks it references.
 * - navigations are network-first, falling back to the cached document.
 * - hashed assets and fonts are cache-first.
 * - everything else same-origin is stale-while-revalidate.
 * - atproto, the relay, and the OAuth metadata documents are never cached.
 *
 * The cache name carries the build id from `_nuxt/builds/latest.json`. Install
 * writes the resolved name to IndexedDB, activate publishes it and drops the
 * older caches. Publishing on activate (not install) means the outgoing worker
 * keeps serving its own cache until the last tab closes, so nothing calls
 * skipWaiting and updates land on the next cold start.
 */

const CACHE_PREFIX = "typbase-shell-";
const FALLBACK_NAME = `${CACHE_PREFIX}fallback`;
const SHELL = "/";
const SHELL_ASSET = /(?:src|href)="(\/_nuxt\/[^"]+)"/g;

const DB_NAME = "typbase-sw";
const DB_STORE = "meta";
const NAME_KEY = "cacheName";
const PENDING_KEY = "pendingName";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readMeta(key) {
  try {
    const db = await openDb();

    return await new Promise((resolve, reject) => {
      const get = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
  } catch {
    return undefined;
  }
}

async function writeMeta(key, value) {
  try {
    const db = await openDb();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // A worker without IndexedDB still serves from the fallback cache.
  }
}

async function fetchBuildId() {
  try {
    const response = await fetch("/_nuxt/builds/latest.json", { cache: "no-store" });
    if (!response.ok) return undefined;

    const data = await response.json();

    return typeof data?.id === "string" ? data.id : undefined;
  } catch {
    return undefined;
  }
}

/** The new build's cache name, reusing the published one when offline. */
async function resolveCacheName() {
  const id = await fetchBuildId();
  if (id) return `${CACHE_PREFIX}${id}`;

  return (await readMeta(NAME_KEY)) ?? FALLBACK_NAME;
}

let cachePromise;

function activeCache() {
  cachePromise ??= (async () => {
    const name = (await readMeta(NAME_KEY)) ?? FALLBACK_NAME;

    return caches.open(name);
  })();

  return cachePromise;
}

async function putIfOk(cache, request, response) {
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkFirst(request) {
  const cache = await activeCache();

  try {
    return await putIfOk(cache, request, await fetch(request));
  } catch {
    return (await cache.match(request)) ?? (await cache.match(SHELL)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await activeCache();
  const cached = await cache.match(request);
  if (cached) return cached;

  return putIfOk(cache, request, await fetch(request));
}

async function staleWhileRevalidate(request) {
  const cache = await activeCache();
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => putIfOk(cache, request, response))
    .catch(() => undefined);

  return cached ?? (await network) ?? Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const name = await resolveCacheName();
      await writeMeta(PENDING_KEY, name);

      try {
        const cache = await caches.open(name);
        const response = await fetch(SHELL, { cache: "no-cache" });
        if (!response.ok) return;

        await cache.put(SHELL, response.clone());
        const html = await response.text();
        const assets = new Set([...html.matchAll(SHELL_ASSET)].map((match) => match[1]));
        await Promise.allSettled([...assets].map((url) => cache.add(url)));
      } catch {
        // Runtime caching still fills the shell; install must not fail.
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const name = (await readMeta(PENDING_KEY)) ?? (await resolveCacheName());
      await writeMeta(NAME_KEY, name);

      const names = await caches.keys();
      await Promise.all(
        names
          .filter((existing) => existing.startsWith(CACHE_PREFIX) && existing !== name)
          .map((existing) => caches.delete(existing)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/oauth-client-metadata") || url.pathname === "/relay") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));

    return;
  }

  if (url.pathname.startsWith("/_nuxt/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(cacheFirst(request));

    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
