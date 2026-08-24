import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { handleProxyRequest } from "../edge-functions/_shared/proxy.js";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
const originalSnapshotStore = globalThis.EDGEFLOW_SNAPSHOT;
const originalBlobStore = globalThis.EDGEFLOW_BLOB_STORE;

class MemoryCache {
  constructor() {
    this.items = new Map();
  }

  key(request) {
    return `${request.method} ${request.url} accept=${request.headers.get("accept") || ""}`;
  }

  async match(request) {
    const response = this.items.get(this.key(request));
    return response ? response.clone() : undefined;
  }

  async put(request, response) {
    this.items.set(this.key(request), response.clone());
  }

  async delete(request) {
    return this.items.delete(this.key(request));
  }
}

class MemoryKv {
  constructor() {
    this.items = new Map();
  }

  async get(key, options) {
    const value = this.items.get(key);
    if (value == null) return null;
    const type = typeof options === "string" ? options : options?.type;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.items.set(key, String(value));
  }

  async delete(key) {
    this.items.delete(key);
  }
}

class MemoryBlob {
  constructor() {
    this.items = new Map();
  }

  async get(key, options) {
    const value = this.items.get(key);
    if (value == null) return null;
    return options?.type === "json" ? JSON.parse(value) : value;
  }

  async set(key, value) {
    this.items.set(key, String(value));
  }
}

function createContext(country = "CN") {
  const tasks = [];
  return {
    eo: { geo: { countryCodeAlpha2: country } },
    tasks,
    waitUntil(task) {
      tasks.push(task);
    }
  };
}

async function settle(context) {
  await Promise.all(context.tasks.splice(0));
}

function htmlResponse(body = "<html><body>ok</body></html>", init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

beforeEach(() => {
  globalThis.caches = { default: new MemoryCache() };
  delete globalThis.EDGEFLOW_SNAPSHOT;
  delete globalThis.EDGEFLOW_BLOB_STORE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
  if (originalSnapshotStore === undefined) delete globalThis.EDGEFLOW_SNAPSHOT;
  else globalThis.EDGEFLOW_SNAPSHOT = originalSnapshotStore;
  if (originalBlobStore === undefined) delete globalThis.EDGEFLOW_BLOB_STORE;
  else globalThis.EDGEFLOW_BLOB_STORE = originalBlobStore;
});

test("public CN HTML is cached with observable MISS then HIT", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("<html><body>cache me</body></html>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "_cfuvid=test; HttpOnly; Secure; Domain=origin.example.com; Path=/"
      }
    });
  };

  const context = createContext();
  const request = new Request("https://proxy.example.com/");
  const first = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(first.headers.get("x-edgeflow-cache"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-cache-reason"), "html");
  assert.equal(first.headers.get("set-cookie"), null);
  await settle(context);

  const second = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(second.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(await second.text(), await first.text());
  assert.equal(fetchCount, 1);
});

test("Cookie and Authorization requests bypass cache", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse();
  };

  const context = createContext();
  const cookieResponse = await handleProxyRequest(
    new Request("https://proxy.example.com/account", { headers: { cookie: "session=private" } }),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(cookieResponse.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(cookieResponse.headers.get("x-edgeflow-cache-reason"), "cookie");

  const authResponse = await handleProxyRequest(
    new Request("https://proxy.example.com/api", { headers: { authorization: "Bearer secret" } }),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(authResponse.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(authResponse.headers.get("x-edgeflow-cache-reason"), "authorization");
  assert.equal(fetchCount, 2);
});

test("EdgeOne access-gate cookies do not disable public caching or reach upstream", async () => {
  let fetchCount = 0;
  let upstreamCookie = "not-observed";
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    upstreamCookie = init.headers.get("cookie");
    return htmlResponse("<html><body>protected preview</body></html>");
  };

  const context = createContext();
  const blob = new MemoryBlob();
  const request = new Request("https://proxy.example.com/", {
    headers: { cookie: "eo_token=preview-token; eo_time=123456" }
  });
  const first = await handleProxyRequest(
    request,
    { WEBFLOW_HOST: "origin.example.com", EDGEFLOW_BLOB_STORE: blob },
    context
  );
  assert.equal(first.headers.get("x-edgeflow-cache"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-snapshot"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-snapshot-store"), "blob");
  assert.equal(upstreamCookie, null);
  await settle(context);

  const second = await handleProxyRequest(
    request,
    { WEBFLOW_HOST: "origin.example.com", EDGEFLOW_BLOB_STORE: blob },
    context
  );
  assert.equal(second.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(second.headers.get("x-edgeflow-snapshot"), "FRESH");
  assert.equal(second.headers.get("x-edgeflow-snapshot-store"), "blob");
  assert.equal(fetchCount, 1);
});

test("EdgeOne access-gate cookies do not hide a real session cookie", async () => {
  let upstreamCookie = "";
  globalThis.fetch = async (_url, init) => {
    upstreamCookie = init.headers.get("cookie");
    return htmlResponse();
  };

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/account", {
      headers: { cookie: "eo_token=preview-token; session=private; eo_time=123456" }
    }),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(response.headers.get("x-edgeflow-cache-reason"), "cookie");
  assert.equal(upstreamCookie, "session=private");
});

test("POST and non-200 responses are never cached", async () => {
  let fetchCount = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCount += 1;
    if (init.method === "POST") return htmlResponse("posted");
    return htmlResponse("missing", { status: 404 });
  };

  const context = createContext();
  const post = await handleProxyRequest(
    new Request("https://proxy.example.com/form", { method: "POST", body: "a=1" }),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(post.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(post.headers.get("x-edgeflow-cache-reason"), "method");

  for (let index = 0; index < 2; index += 1) {
    const missing = await handleProxyRequest(
      new Request("https://proxy.example.com/missing"),
      { WEBFLOW_HOST: "origin.example.com" },
      context
    );
    assert.equal(missing.headers.get("x-edgeflow-cache"), "BYPASS");
    assert.equal(missing.headers.get("x-edgeflow-cache-reason"), "status-404");
  }
  assert.equal(fetchCount, 3);
});

test("foreign Geo redirect bypasses cache and never fetches upstream", async () => {
  globalThis.fetch = async () => {
    throw new Error("must not fetch");
  };

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/path?q=1"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext("US")
  );
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://origin.example.com/path?q=1");
  assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(response.headers.get("x-edgeflow-cache-reason"), "geo-redirect");
});

test("health response is minimal and contains no request or runtime dump", async () => {
  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/__proxy/health", {
      headers: { cookie: "private=value", "x-forwarded-for": "203.0.113.8" }
    }),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "cacheApiAvailable",
    "ok",
    "originConfigured",
    "runtime",
    "snapshotStoreAvailable",
    "snapshotStoreType",
    "version"
  ]);
  assert.equal(JSON.stringify(body).includes("203.0.113.8"), false);
  assert.equal(JSON.stringify(body).includes("private=value"), false);
  assert.equal(body.version, "2.5.0");
  assert.equal(body.cacheApiAvailable, true);
  assert.equal(body.snapshotStoreAvailable, false);
  assert.equal(body.snapshotStoreType, null);
  assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
});

test("HEAD reuses a cached GET but cannot poison an empty cache", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("full body");
  };

  const context = createContext();
  const headRequest = new Request("https://proxy.example.com/", { method: "HEAD" });
  const headMiss = await handleProxyRequest(headRequest, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(headMiss.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(headMiss.headers.get("x-edgeflow-cache-reason"), "head-miss");

  const getResponse = await handleProxyRequest(
    new Request("https://proxy.example.com/"),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(getResponse.headers.get("x-edgeflow-cache"), "MISS");
  await settle(context);

  const headHit = await handleProxyRequest(headRequest, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(headHit.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(await headHit.text(), "");
  assert.equal(fetchCount, 2);
});

test("query strings create distinct cache keys", async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return htmlResponse(new URL(url).search);
  };

  const context = createContext();
  for (const query of ["?v=1", "?v=2"]) {
    const response = await handleProxyRequest(
      new Request(`https://proxy.example.com/app.js${query}`),
      { WEBFLOW_HOST: "origin.example.com" },
      context
    );
    assert.equal(response.headers.get("x-edgeflow-cache"), "MISS");
    await settle(context);
  }

  const hit = await handleProxyRequest(
    new Request("https://proxy.example.com/app.js?v=1"),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(hit.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(await hit.text(), "?v=1");
  assert.equal(fetchCount, 2);
});

test("legitimate Set-Cookie responses bypass cache", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("session", { headers: { "set-cookie": "session=abc; Path=/; Secure" } });
  };

  const context = createContext();
  for (let index = 0; index < 2; index += 1) {
    const response = await handleProxyRequest(
      new Request("https://proxy.example.com/login-result"),
      { WEBFLOW_HOST: "origin.example.com" },
      context
    );
    assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
    assert.equal(response.headers.get("x-edgeflow-cache-reason"), "set-cookie");
  }
  assert.equal(fetchCount, 2);
});

test("filtering _cfuvid never removes another upstream cookie", async () => {
  globalThis.fetch = async () => {
    const headers = new Headers({ "content-type": "text/html" });
    headers.append("set-cookie", "_cfuvid=test; Domain=origin.example.com; Path=/");
    headers.append("set-cookie", "session=keep-me; Path=/; Secure");
    return new Response("session", { headers });
  };

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  const cookies = response.headers.getSetCookie();
  assert.deepEqual(cookies, ["session=keep-me; Path=/; Secure"]);
  assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(response.headers.get("x-edgeflow-cache-reason"), "set-cookie");
});

test("upstream redirects rewrite Location and are never cached", async () => {
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "https://origin.example.com/next?q=1" }
    });
  };

  const context = createContext();
  for (let index = 0; index < 2; index += 1) {
    const response = await handleProxyRequest(
      new Request("https://proxy.example.com/start"),
      { WEBFLOW_HOST: "origin.example.com" },
      context
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://proxy.example.com/next?q=1");
    assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
    assert.equal(response.headers.get("x-edgeflow-cache-reason"), "status-302");
  }
  assert.equal(fetchCount, 2);
});

test("Link preload headers use the proxy host and China CDN mirror", async () => {
  globalThis.fetch = async () => htmlResponse("<html><body>ok</body></html>", {
    headers: {
      link: [
        "<https://cdn.prod.website-files.com/site.css>; rel=preload; as=style",
        "<https://cdnjs.cloudflare.com/ajax/libs/Swiper/11/swiper.css>; rel=preload; as=style"
      ].join(", ")
    }
  });

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  const link = response.headers.get("link");
  assert.match(link, /proxy\.example\.com\/__eo_asset_v3__\/cdn\.prod\.website-files\.com\/site\.css/);
  assert.match(link, /cdn\.jsdmirror\.com\/ajax\/libs\/Swiper\/11\/swiper\.css/);
  assert.doesNotMatch(link, /cdnjs\.cloudflare\.com/);
});

test("ordinary Webflow CSS rewrites nested image and font URLs", async () => {
  globalThis.fetch = async () => new Response([
    ".hero{background:url(https://cdn.prod.website-files.com/site/hero.jpg)}",
    "@font-face{src:url('//cdn.prod.website-files.com/site/font.woff2')}"
  ].join("\n"), { headers: { "content-type": "text/css" } });

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/__eo_asset_v3__/cdn.prod.website-files.com/site/styles.abcdef12.css"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  const css = await response.text();
  assert.match(css, /https:\/\/proxy\.example\.com\/__eo_asset_v3__\/cdn\.prod\.website-files\.com\/site\/hero\.jpg/);
  assert.match(css, /\/\/proxy\.example\.com\/__eo_asset_v3__\/cdn\.prod\.website-files\.com\/site\/font\.woff2/);
  assert.doesNotMatch(css, /url\([^)]*https:\/\/cdn\.prod\.website-files\.com/);
});

test("fingerprinted assets get a long immutable edge TTL", async () => {
  globalThis.fetch = async () => new Response("css", {
    headers: { "content-type": "text/css" }
  });

  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/site.abcdef123456.css"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  assert.equal(response.headers.get("x-edgeflow-cache"), "MISS");
  assert.match(response.headers.get("cache-control"), /s-maxage=2592000/);
  assert.match(response.headers.get("cache-control"), /immutable/);
});

test("rewritten responses reset stale upstream cache metadata and expose safe timing", async () => {
  globalThis.fetch = async () => htmlResponse("<html><body>fresh proxy representation</body></html>", {
    headers: {
      age: "7628",
      etag: '"upstream-compressed-etag"',
      expires: "Wed, 21 Oct 2015 07:28:00 GMT",
      "content-md5": "invalid-after-rewrite",
      "server-timing": "upstream;dur=999"
    }
  });

  const context = createContext();
  const request = new Request("https://proxy.example.com/");
  const response = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(response.headers.get("age"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("expires"), null);
  assert.equal(response.headers.get("content-md5"), null);
  assert.match(response.headers.get("server-timing"), /edgeflow-cache;desc="MISS"/);
  assert.match(response.headers.get("server-timing"), /origin;dur=/);
  assert.match(response.headers.get("server-timing"), /rewrite;dur=/);
  assert.doesNotMatch(response.headers.get("server-timing"), /upstream/);
});

test("an expired cache read can recover by fetching and storing a fresh response", async () => {
  let fetchCount = 0;
  let firstMatch = true;
  const cache = new MemoryCache();
  const originalMatch = cache.match.bind(cache);
  cache.match = async (request) => {
    if (firstMatch) {
      firstMatch = false;
      throw new Error("504 expired cache entry");
    }
    return originalMatch(request);
  };
  globalThis.caches = { default: cache };
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("fresh");
  };

  const context = createContext();
  const request = new Request("https://proxy.example.com/recover");
  const refreshed = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(refreshed.headers.get("x-edgeflow-cache"), "MISS");
  await settle(context);

  const hit = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(hit.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(fetchCount, 1);
});

test("missing Cache API degrades safely to BYPASS", async () => {
  globalThis.caches = undefined;
  globalThis.fetch = async () => htmlResponse();
  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  assert.equal(response.headers.get("x-edgeflow-cache"), "BYPASS");
  assert.equal(response.headers.get("x-edgeflow-cache-reason"), "cache-api-unavailable");
});

test("KV snapshot persists rewritten HTML when Cache API is unavailable", async () => {
  globalThis.caches = undefined;
  globalThis.EDGEFLOW_SNAPSHOT = new MemoryKv();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("<html><body>persistent snapshot</body></html>");
  };

  const context = createContext();
  const request = new Request("https://proxy.example.com/");
  const first = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(first.headers.get("x-edgeflow-cache"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-snapshot"), "MISS");
  await settle(context);

  const second = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, createContext());
  assert.equal(second.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(second.headers.get("x-edgeflow-cache-reason"), "snapshot-fresh");
  assert.equal(second.headers.get("x-edgeflow-snapshot"), "FRESH");
  assert.equal(await second.text(), await first.text());
  assert.equal(fetchCount, 1);
});

test("Blob fallback persists rewritten HTML when KV and Cache API are unavailable", async () => {
  globalThis.caches = undefined;
  const blob = new MemoryBlob();
  globalThis.EDGEFLOW_BLOB_STORE = blob;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse("<html><body>blob snapshot</body></html>");
  };

  const context = createContext();
  const request = new Request("https://proxy.example.com/");
  const first = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, context);
  assert.equal(first.headers.get("x-edgeflow-cache"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-snapshot"), "MISS");
  assert.equal(first.headers.get("x-edgeflow-snapshot-store"), "blob");
  await settle(context);
  assert.equal([...blob.items.keys()].every((key) => key.startsWith("snapshots/html_")), true);

  const second = await handleProxyRequest(request, { WEBFLOW_HOST: "origin.example.com" }, createContext());
  assert.equal(second.headers.get("x-edgeflow-cache"), "HIT");
  assert.equal(second.headers.get("x-edgeflow-cache-reason"), "snapshot-fresh");
  assert.equal(second.headers.get("x-edgeflow-snapshot"), "FRESH");
  assert.equal(second.headers.get("x-edgeflow-snapshot-store"), "blob");
  assert.match(await second.text(), /blob snapshot/);
  assert.equal(fetchCount, 1);
});

test("KV remains the preferred snapshot backend when Blob is also configured", async () => {
  globalThis.caches = undefined;
  const kv = new MemoryKv();
  const blob = new MemoryBlob();
  globalThis.EDGEFLOW_SNAPSHOT = kv;
  globalThis.EDGEFLOW_BLOB_STORE = blob;
  globalThis.fetch = async () => htmlResponse("<html><body>kv wins</body></html>");

  const context = createContext();
  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/"),
    { WEBFLOW_HOST: "origin.example.com" },
    context
  );
  assert.equal(response.headers.get("x-edgeflow-snapshot-store"), "kv");
  await settle(context);
  assert.equal(kv.items.size, 1);
  assert.equal(blob.items.size, 0);
});

test("invalid Blob store configuration degrades without breaking health", async () => {
  const response = await handleProxyRequest(
    new Request("https://proxy.example.com/__proxy/health"),
    { WEBFLOW_HOST: "origin.example.com", SNAPSHOT_BLOB_STORE: "invalid/name" },
    createContext()
  );
  const body = await response.json();
  assert.equal(body.snapshotStoreAvailable, false);
  assert.equal(body.snapshotStoreType, null);
});

test("stale KV snapshot is served immediately and refreshed in background", async () => {
  globalThis.caches = undefined;
  const kv = new MemoryKv();
  globalThis.EDGEFLOW_SNAPSHOT = kv;
  let body = "old";
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return htmlResponse(`<html><body>${body}</body></html>`);
  };

  const request = new Request("https://proxy.example.com/");
  const warmContext = createContext();
  const warm = await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "1"
  }, warmContext);
  await settle(warmContext);
  assert.equal(warm.headers.get("x-edgeflow-snapshot"), "MISS");

  const [key, serialized] = [...kv.items.entries()][0];
  const expired = JSON.parse(serialized);
  expired.storedAt = Date.now() - 5000;
  kv.items.set(key, JSON.stringify(expired));
  body = "new";

  const staleContext = createContext();
  const stale = await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "1"
  }, staleContext);
  assert.equal(stale.headers.get("x-edgeflow-snapshot"), "STALE");
  assert.equal(stale.headers.get("x-edgeflow-refresh"), "BACKGROUND");
  assert.match(await stale.text(), /old/);
  await settle(staleContext);

  const fresh = await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "60"
  }, createContext());
  assert.equal(fresh.headers.get("x-edgeflow-snapshot"), "FRESH");
  assert.match(await fresh.text(), /new/);
  assert.equal(fetchCount, 2);
});

test("failed background refresh keeps serving the last successful snapshot", async () => {
  globalThis.caches = undefined;
  const kv = new MemoryKv();
  globalThis.EDGEFLOW_SNAPSHOT = kv;
  globalThis.fetch = async () => htmlResponse("<html><body>last known good</body></html>");
  const request = new Request("https://proxy.example.com/");
  const warmContext = createContext();
  await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "1"
  }, warmContext);
  await settle(warmContext);

  const [key, serialized] = [...kv.items.entries()][0];
  const expired = JSON.parse(serialized);
  expired.storedAt = Date.now() - 5000;
  kv.items.set(key, JSON.stringify(expired));
  globalThis.fetch = async () => { throw new Error("origin unavailable"); };

  const staleContext = createContext();
  const stale = await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "1"
  }, staleContext);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get("x-edgeflow-snapshot"), "STALE");
  assert.match(await stale.text(), /last known good/);
  await settle(staleContext);

  const stillAvailable = await handleProxyRequest(request, {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_TTL: "1"
  }, createContext());
  assert.equal(stillAvailable.status, 200);
  assert.match(await stillAvailable.text(), /last known good/);
});

test("tracking query parameters share a snapshot while functional queries do not", async () => {
  globalThis.EDGEFLOW_SNAPSHOT = new MemoryKv();
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    return htmlResponse(`<html><body>${new URL(url).search}</body></html>`);
  };

  const firstContext = createContext();
  await handleProxyRequest(
    new Request("https://proxy.example.com/?utm_source=test"),
    { WEBFLOW_HOST: "origin.example.com" },
    firstContext
  );
  await settle(firstContext);

  const trackingHit = await handleProxyRequest(
    new Request("https://proxy.example.com/?gclid=123"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  assert.equal(trackingHit.headers.get("x-edgeflow-snapshot"), "FRESH");

  const functional = await handleProxyRequest(
    new Request("https://proxy.example.com/?category=chairs"),
    { WEBFLOW_HOST: "origin.example.com" },
    createContext()
  );
  assert.equal(functional.headers.get("x-edgeflow-snapshot"), null);
  assert.equal(fetchCount, 2);
});

test("authenticated refresh endpoint updates configured snapshot paths", async () => {
  globalThis.caches = undefined;
  globalThis.EDGEFLOW_SNAPSHOT = new MemoryKv();
  globalThis.fetch = async (url) => htmlResponse(`<html><body>${new URL(url).pathname}</body></html>`);
  const env = {
    WEBFLOW_HOST: "origin.example.com",
    SNAPSHOT_REFRESH_SECRET: "test-secret",
    SNAPSHOT_PATHS: "/,/about"
  };

  const unauthorized = await handleProxyRequest(
    new Request("https://proxy.example.com/__proxy/refresh", { method: "POST" }),
    env,
    createContext()
  );
  assert.equal(unauthorized.status, 401);

  const refreshed = await handleProxyRequest(
    new Request("https://proxy.example.com/__proxy/refresh", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" }
    }),
    env,
    createContext()
  );
  assert.equal(refreshed.status, 200);
  assert.deepEqual((await refreshed.json()).results, [
    { path: "/", ok: true },
    { path: "/about", ok: true }
  ]);

  const hit = await handleProxyRequest(
    new Request("https://proxy.example.com/about"),
    env,
    createContext()
  );
  assert.equal(hit.headers.get("x-edgeflow-snapshot"), "FRESH");
});
