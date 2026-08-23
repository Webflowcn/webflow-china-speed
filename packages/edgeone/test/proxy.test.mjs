import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { handleProxyRequest } from "../edge-functions/_shared/proxy.js";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

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
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
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
    "version"
  ]);
  assert.equal(JSON.stringify(body).includes("203.0.113.8"), false);
  assert.equal(JSON.stringify(body).includes("private=value"), false);
  assert.equal(body.version, "2.3.0");
  assert.equal(body.cacheApiAvailable, true);
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
