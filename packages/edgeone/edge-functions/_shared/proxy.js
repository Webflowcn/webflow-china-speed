/**
 * Webflow China Speedup — EdgeOne Pages 代理核心逻辑 (v2.3)
 *
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  改动记录                                                     ║
 * ║  [v2.3] 显式 Cache API + 安全健康检查 + 可观测缓存状态       ║
 * ║  [v2.0] 修复 Geo 路由不生效 + 缓存不分地区 + Health 500      ║
 * ║  [v1.0] 初始版本                                             ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 *  edge-functions/ 是 EdgeOne Makers 当前使用的函数源码目录。
 */

const DEFAULT_CONFIG = {
  originHost: "webflowcn.webflow.io",
  assetProxyPrefix: "/__eo_asset_v3__",
  proxyableHosts: [
    "website-files.com",
    "uploads-ssl.webflow.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com"
  ],
  mirrorJquery: "https://lib.baomitu.com/jquery/3.5.1/jquery.min.js",
  mirrorWebfont: "https://cdn.jsdelivr.net/npm/webfontloader@1.6.26/webfontloader.js",
  mirrorJsdMirror: "https://cdn.jsdmirror.com"
};

const STRIP_PATTERNS = [
  /<a[^>]*class=["']w-webflow-badge["'][^>]*>[\s\S]*?<\/a>/gi,
  /<div[^>]*class=["']w-webflow-badge["'][^>]*>[\s\S]*?<\/div>/gi,
  /<span[^>]*class=["']w-webflow-badge["'][^>]*>[\s\S]*?<\/span>/gi,
  /<meta[^>]*name=["']generator["'][^>]*content=["']Webflow[^"']*["'][^>]*\/?>/gi
];

const HEAD_INJECT = [].join("");

const BODY_INJECT = `<script>(function(){var r=function(){document.querySelectorAll('.w-webflow-badge,[class*="webflow-badge"]').forEach(function(n){n.remove()})};r();setTimeout(r,800);setTimeout(r,2500);document.querySelectorAll('img:not([loading])').forEach(function(i){i.loading='lazy';i.decoding='async'});}());</script>`;

const STATIC_EXT_RE = /\.(?:js|mjs|css|png|jpg|jpeg|gif|webp|svg|ico|woff2|woff|ttf|map|json|xml|txt|pdf|mp4|webm|ogg|mp3)$/i;
const FINGERPRINT_RE = /(?:^|[._/-])[a-f0-9]{8,}(?:[._/-]|$)/i;
const EDGEFLOW_CACHE_HEADER = "x-edgeflow-cache";
const EDGEFLOW_CACHE_REASON_HEADER = "x-edgeflow-cache-reason";

/**
 * 获取客户端地区代码 — 从多个来源 fallback
 * EdgeOne Pages 通过 request.eo.geo (运行时属性) 传递地区信息，
 * 而非 HTTP 请求头。这里依次兜底。
 */
function getClientCountry(request, context = {}) {
  // 1. 检查 EdgeOne 运行时属性 request.eo.geo（主路径）
  try {
    const eo = request.eo || context.eo;
    if (eo && eo.geo && eo.geo.countryCodeAlpha2) {
      return eo.geo.countryCodeAlpha2.toUpperCase();
    }
  } catch (_) {}

  // 2. 检查 eo-is-mainland 请求头（EdgeOne Pages 注入）
  const isMainland = request.headers.get("eo-is-mainland");
  if (isMainland === "1") return "CN";

  // 3. 传统 HTTP 请求头（需要 EdgeOne 配置才传递）
  return (
    request.headers.get("EO-Client-IPCountry") ||
    request.headers.get("X-EdgeOne-Client-Country") ||
    request.headers.get("CloudFront-Viewer-Country") ||
    request.headers.get("X-EO-Client-IPCountry") ||
    request.cf?.country ||
    ""
  ).toUpperCase();
}

export async function handleProxyRequest(request, env = {}, context = {}) {
  const reqUrl = new URL(request.url);
  const cfg = resolveSiteConfig(env);

  // ════════════════════════════════════════════════════════════
  // Health 端点 — 用 new Response() 而非 Response.json()
  // (EdgeOne 运行时可能不支持 Response.json()，导致 500)
  // ════════════════════════════════════════════════════════════
  if (reqUrl.pathname === "/__proxy/health") {
    const body = JSON.stringify({
      ok: true,
      runtime: "edgeone-pages",
      version: "2.3.0",
      originConfigured: Boolean(cfg.originHost),
      cacheApiAvailable: Boolean(globalThis.caches && globalThis.caches.default)
    });

    return withCacheStatus(new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate"
      }
    }), "BYPASS", request.method, "health");
  }

  // Serve generated robots.txt and sitemap.xml
  if (reqUrl.pathname === "/robots.txt") {
    const sitemapUrl = `${reqUrl.protocol}//${reqUrl.host}/sitemap.xml`;
    const body = `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`;
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" }
    });
  }

  if (reqUrl.pathname === "/sitemap.xml") {
    try {
      const sitemap = await generateSitemap(cfg, reqUrl);
      return new Response(sitemap, {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" }
      });
    } catch (_e) {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>', {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" }
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // Geo 路由（v2.0 修复）：海外用户 301 → 源站直连
  //
  // [修复] 改用 getClientCountry() 多 header fallback
  // [修复] 海外用户也返回 Vary header，防止边缘缓存混用
  // ════════════════════════════════════════════════════════════
  let country = "";
  if (cfg.originHost) {
    country = getClientCountry(request, context);
    if (country && country !== "CN") {
      const originUrl = `https://${cfg.originHost}${reqUrl.pathname}${reqUrl.search}`;
      const resp = new Response(null, {
        status: 301,
        headers: {
          location: originUrl,
          // 海外重定向响应不缓存，防止 CDN 缓存 301 给其他用户
          "cache-control": "no-cache, no-store, must-revalidate"
        }
      });
      return withCacheStatus(resp, "BYPASS", request.method, "geo-redirect");
    }
  }

  if (!cfg.originHost) {
    return new Response(
      "502 PROXY_CONFIG_ERROR: 环境变量 WEBFLOW_HOST 未配置。请在 EdgeOne Pages 控制台 → 设置 → 环境变量中添加，值为你的 Webflow 项目地址（如 xxx.webflow.io）。",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  // 正常代理流程
  const target = resolveUpstreamTarget(reqUrl, cfg);
  if (!target) {
    return new Response("400 Invalid asset proxy target", { status: 400 });
  }

  const cachePlan = createCachePlan(request, reqUrl, target, cfg, country);
  if (cachePlan.lookup) {
    try {
      const hit = await cachePlan.cache.match(cachePlan.key);
      if (hit) return withCacheStatus(hit, "HIT", request.method, cachePlan.kind);
    } catch (_cacheError) {
      cachePlan.lookup = false;
      cachePlan.store = false;
      cachePlan.reason = "cache-read-error";
    }
  }

  const upstreamHeaders = buildUpstreamHeaders(request, reqUrl, target.upstreamHost);

  let upstreamResp;
  try {
    upstreamResp = await fetch(target.upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: canHaveBody(request.method) ? request.body : undefined,
      redirect: "manual"
    });
  } catch (_err) {
    return new Response("502 Upstream fetch failed", { status: 502 });
  }

  const rewritten = await rewriteResponse(upstreamResp, reqUrl, request.method, target, cfg);
  const storeDecision = canStoreResponse(rewritten, cachePlan);

  if (storeDecision.store) {
    const cachedResponse = rewritten.clone();
    const putTask = cachePlan.cache.put(cachePlan.key, cachedResponse);
    if (context && typeof context.waitUntil === "function") {
      context.waitUntil(putTask);
    } else {
      await putTask;
    }
    return withCacheStatus(rewritten, "MISS", request.method, cachePlan.kind);
  }

  return withCacheStatus(
    rewritten,
    "BYPASS",
    request.method,
    storeDecision.reason || cachePlan.reason
  );
}

function resolveSiteConfig(env) {
  return {
    originHost: env.WEBFLOW_HOST || DEFAULT_CONFIG.originHost,
    assetProxyPrefix: ensurePrefix(env.ASSET_PROXY_PREFIX || DEFAULT_CONFIG.assetProxyPrefix),
    proxyableHosts: DEFAULT_CONFIG.proxyableHosts,
    mirrorJquery: env.MIRROR_JQUERY || DEFAULT_CONFIG.mirrorJquery,
    mirrorWebfont: env.MIRROR_WEBFONT || DEFAULT_CONFIG.mirrorWebfont,
    mirrorJsdMirror: env.MIRROR_JSD_MIRROR || DEFAULT_CONFIG.mirrorJsdMirror,
    htmlCacheTtl: parsePositiveInt(env.CACHE_TTL, 300)
  };
}

function createCachePlan(request, reqUrl, target, cfg, country) {
  const method = request.method.toUpperCase();
  const base = {
    lookup: false,
    store: false,
    cache: null,
    key: null,
    kind: classifyCacheKind(target),
    reason: "not-cacheable"
  };

  if (method !== "GET" && method !== "HEAD") return { ...base, reason: "method" };
  if (country !== "CN") return { ...base, reason: country ? "geo" : "geo-unknown" };
  if (request.headers.get("authorization")) return { ...base, reason: "authorization" };
  if (request.headers.get("cookie")) return { ...base, reason: "cookie" };
  if (request.headers.get("range")) return { ...base, reason: "range" };

  const requestCacheControl = (request.headers.get("cache-control") || "").toLowerCase();
  if (requestCacheControl.includes("no-store") || requestCacheControl.includes("no-cache")) {
    return { ...base, reason: "request-cache-control" };
  }

  const cache = globalThis.caches && globalThis.caches.default;
  if (!cache || typeof cache.match !== "function" || typeof cache.put !== "function") {
    return { ...base, reason: "cache-api-unavailable" };
  }

  const keyHeaders = new Headers();
  const accept = request.headers.get("accept");
  if (accept) keyHeaders.set("accept", accept);

  return {
    ...base,
    lookup: true,
    store: method === "GET",
    cache,
    key: new Request(reqUrl.toString(), { method: "GET", headers: keyHeaders }),
    reason: method === "HEAD" ? "head-miss" : "cache-miss",
    htmlCacheTtl: cfg.htmlCacheTtl
  };
}

function classifyCacheKind(target) {
  if (!STATIC_EXT_RE.test(target.sourcePathname)) return "html";
  if (FINGERPRINT_RE.test(target.sourcePathname)) return "fingerprinted-static";
  return "static";
}

function canStoreResponse(response, cachePlan) {
  if (!cachePlan.store) return { store: false, reason: cachePlan.reason };
  if (response.status !== 200) return { store: false, reason: `status-${response.status}` };
  if (response.headers.get("set-cookie")) return { store: false, reason: "set-cookie" };
  if (response.headers.get("content-range")) return { store: false, reason: "partial-content" };

  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.includes("private") || cacheControl.includes("no-store")) {
    return { store: false, reason: "response-cache-control" };
  }
  return { store: true, reason: "" };
}

function withCacheStatus(response, status, method, reason) {
  const headers = new Headers(response.headers);
  headers.set(EDGEFLOW_CACHE_HEADER, status);
  if (reason) headers.set(EDGEFLOW_CACHE_REASON_HEADER, reason);
  else headers.delete(EDGEFLOW_CACHE_REASON_HEADER);
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildUpstreamHeaders(request, reqUrl, upstreamHost) {
  const headers = new Headers(request.headers);
  headers.set("host", upstreamHost);
  headers.set("x-forwarded-host", reqUrl.host);
  headers.set("x-forwarded-proto", reqUrl.protocol.replace(":", ""));
  headers.set("accept-encoding", "identity");
  return headers;
}

function canHaveBody(method) {
  return method !== "GET" && method !== "HEAD";
}

async function rewriteResponse(originResp, requestUrl, method, target, cfg) {
  const headers = new Headers(originResp.headers);
  const upstreamContentEncoding = originResp.headers.get("content-encoding");
  const isCompressed = upstreamContentEncoding && upstreamContentEncoding !== "identity";
  const contentType = (headers.get("content-type") || "").toLowerCase();
  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
  const isCss = contentType.includes("text/css");
  const shouldRewriteBodyText = isHtml || isCss;
  const isStatic = STATIC_EXT_RE.test(target.sourcePathname);

  rewriteLocationHeader(headers, requestUrl, cfg);
  rewriteLinkHeader(headers, requestUrl, cfg);
  dropUnsafeUpstreamHeaders(headers, requestUrl.host);

  // MIME override: .txt files through asset proxy are often JS code
  if (target.assetProxy && target.sourcePathname.endsWith('.txt') && contentType === 'text/plain') {
    headers.set('content-type', 'text/javascript; charset=utf-8');
  }

  setCachingHeaders(headers, isStatic, target, cfg);
  setSecurityHeaders(headers);

  // [v2.0] 对 HTML 响应添加 Vary: EO-Client-IPCountry
  // 提示边缘缓存按地区区分，不同地区的用户获得不同的缓存版本
  if (isHtml) {
    headers.append("vary", "EO-Client-IPCountry, X-EdgeOne-Client-Country");
  }

  if (!shouldRewriteBodyText || method === "HEAD") {
    normalizeTransferHeaders(headers);
    headers.set("x-proxy-cache-policy", isStatic ? "static" : "dynamic");
    headers.set("x-proxy-upstream", target.upstreamHost);
    if (isCompressed) {
      const decompressed = await originResp.arrayBuffer();
      return new Response(decompressed, {
        status: originResp.status,
        headers
      });
    }
    return new Response(originResp.body, {
      status: originResp.status,
      headers
    });
  }

  let text = await originResp.text();
  text = rewriteDomainTokens(text, requestUrl, cfg);

  if (isHtml) {
    text = stripWebflowBranding(text);
    text = injectOptimizations(text);
    text = applyChinaSpeedRewrites(text, requestUrl, cfg);
    text = stripCssIntegrity(text);
  } else if (isCss) {
    text = rewriteCssFonts(text, requestUrl, cfg);
  }

  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("vary");
  headers.set("vary", "Accept, EO-Client-IPCountry");
  headers.set("x-proxy-cache-policy", isStatic ? "static" : "dynamic");
  headers.set("x-proxy-upstream", target.upstreamHost);

  return new Response(text, {
    status: originResp.status,
    headers
  });
}

function rewriteLocationHeader(headers, requestUrl, cfg) {
  const location = headers.get("location");
  if (!location) return;
  headers.set("location", rewriteDomainTokens(location, requestUrl, cfg));
}

function rewriteLinkHeader(headers, requestUrl, cfg) {
  const link = headers.get("link");
  if (!link) return;
  headers.set("link", rewriteChinaCdnTokens(rewriteDomainTokens(link, requestUrl, cfg), cfg));
}

function dropUnsafeUpstreamHeaders(headers, publicHost) {
  [
    "x-lambda-id",
    "surrogate-key",
    "surrogate-control",
    "x-wf-region",
    "x-wf-accelerated",
    "cf-ray",
    "cf-cache-status"
  ].forEach((key) => headers.delete(key));

  // Cloudflare's upstream tracking cookie is scoped to the origin domain and
  // cannot be used by the public proxy host. Do not leak or globally cache it.
  const isForeignCfuvid = (cookie) => (
    /^_cfuvid=/i.test(cookie) &&
    !new RegExp(`(?:^|;\\s*)domain=${escapeRegExp(publicHost)}(?:;|$)`, "i").test(cookie)
  );
  if (typeof headers.getSetCookie === "function") {
    const cookies = headers.getSetCookie();
    const filtered = cookies.filter((cookie) => !isForeignCfuvid(cookie));
    if (filtered.length !== cookies.length) {
      headers.delete("set-cookie");
      filtered.forEach((cookie) => headers.append("set-cookie", cookie));
    }
  } else {
    const setCookie = headers.get("set-cookie");
    if (setCookie && !setCookie.includes(",") && isForeignCfuvid(setCookie)) {
      headers.delete("set-cookie");
    }
  }
}

function normalizeTransferHeaders(headers) {
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set("content-encoding", "identity");
  headers.delete("vary");
  headers.set("vary", "Accept");
}

function setCachingHeaders(headers, isStatic, target, cfg) {
  if (target.assetProxy && target.upstreamHost === "fonts.googleapis.com") {
    headers.set("cache-control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000, no-transform");
    return;
  }
  if (isStatic) {
    const fingerprinted = FINGERPRINT_RE.test(target.sourcePathname);
    const edgeTtl = fingerprinted ? 2592000 : 86400;
    const immutable = fingerprinted ? ", immutable" : "";
    headers.set("cache-control", `public, max-age=86400, s-maxage=${edgeTtl}, stale-while-revalidate=2592000${immutable}, no-transform`);
    return;
  }
  // [v2.0] 降低 stale-while-revalidate 从 7 天 → 1 小时
  // 原因：HTML 可能因 Geo 地区不同而内容不同，缓存过期后应尽快回源校验
  headers.set("cache-control", `public, max-age=0, s-maxage=${cfg.htmlCacheTtl}, stale-while-revalidate=3600, no-transform`);
}

function setSecurityHeaders(headers) {
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-dns-prefetch-control", "on");
}

function rewriteDomainTokens(input, requestUrl, cfg) {
  const reqHost = requestUrl.host;
  const reqOrigin = `${requestUrl.protocol}//${reqHost}`;
  let output = input
    .replace(new RegExp(`https://${escapeRegExp(cfg.originHost)}`, "gi"), reqOrigin)
    .replace(new RegExp(`//${escapeRegExp(cfg.originHost)}`, "gi"), `//${reqHost}`)
    .replace(new RegExp(escapeRegExp(cfg.originHost), "gi"), reqHost);

  cfg.proxyableHosts.forEach((host) => {
    const escapedHost = escapeRegExp(host);
    output = output
      .replace(new RegExp(`https://[\\w.-]*${escapedHost}`, "gi"), (m) => `${reqOrigin}${cfg.assetProxyPrefix}/${m.replace("https://", "")}`)
      .replace(new RegExp(`//[\\w.-]*${escapedHost}`, "gi"), (m) => `//${reqHost}${cfg.assetProxyPrefix}/${m.replace("//", "")}`);
  });

  return output;
}

function stripWebflowBranding(input) {
  let output = input;
  STRIP_PATTERNS.forEach((re) => {
    output = output.replace(re, "");
  });
  return output;
}

function injectOptimizations(input) {
  let output = input;
  output = output.replace(/<head([^>]*)>/i, `<head$1>${HEAD_INJECT}`);
  output = output.replace(/<\/body>/i, `${BODY_INJECT}</body>`);
  output = output.replace(/<img(?![^>]*decoding)([^>]*?)>/gi, '<img decoding="async"$1>');
  return output;
}

function applyChinaSpeedRewrites(input, requestUrl, cfg) {
  let output = rewriteChinaCdnTokens(input, cfg);
  const reqHost = requestUrl.host;
  const reqOrigin = `${requestUrl.protocol}//${reqHost}`;

  output = output.replace(
    /<style>\s*html\.w-mod-js:not\(\.w-mod-ix3\)\s*:is\(\.post_collection-item\)\s*\{[^}]*\}\s*<\/style>/gi,
    ""
  );

  output = output.replace(
    /<link[^>]*(?:rel=["'](?:preconnect|dns-prefetch)["'][^>]*href=["'][^"']*(?:google|gstatic)[^"']*|href=["'][^"']*(?:google|gstatic)[^"']*["'][^>]*rel=["'](?:preconnect|dns-prefetch)["'])[^>]*>/gi,
    ""
  );

  output = output.replace(/<script[^>]*src=["'][^"']*(?:googletagmanager|google-analytics)\.com[^"']*["'][^>]*>\s*<\/script>/gi, "");
  output = output.replace(/<noscript>\s*<iframe[^>]*googletagmanager\.com[^>]*><\/iframe>\s*<\/noscript>/gi, "");
  output = output.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, (match) => {
    if (/(?:dataLayer|gtag\(|GoogleAnalyticsObject)/i.test(match)) return "";
    return match;
  });

  output = output.replace(
    /https?:\/\/ajax\.googleapis\.com\/ajax\/libs\/webfont\/[\d.]+\/webfont\.js/gi,
    cfg.mirrorWebfont
  );
  // Convert WebFont.load({google:{families:["..."]}}) to <link> tags via Google Fonts China mirror
  output = output.replace(
    /<script[^>]*>\s*WebFont\.load\(\s*\{[\s\S]*?google\s*:\s*\{[\s\S]*?families\s*:\s*\[([\s\S]*?)\][\s\S]*?\)\s*;?\s*<\/script>/gi,
    (_match, familiesContent) => {
      const families = [...familiesContent.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      const links = families.map(f => {
        const [name, weights] = f.split(':');
        const href = weights
          ? `https://fonts.googleapis.cn/css?family=${name}:${weights}&display=swap`
          : `https://fonts.googleapis.cn/css?family=${name}&display=swap`;
        return `<link href="${href}" rel="stylesheet">`;
      });
      return links.join('\n');
    }
  );

  output = output.replace(
    /https?:\/\/d3e54v103j8qbb\.cloudfront\.net\/js\/jquery-3\.5\.1\.min\.dc5e7f18c8\.js\?site=[^"']+/gi,
    cfg.mirrorJquery
  );

  // GSAP — already proxied via rewriteDomainTokens, keep explicit patterns for version flexibility
  output = output
    .replace(
      /https?:\/\/([\w.-]*website-files\.com)\/gsap\/([\d.]+)\/([\w.]+\.min\.js)/gi,
      `${reqOrigin}${cfg.assetProxyPrefix}/$1/gsap/$2/$3`
    );

  // Remove webfontloader.js script (no longer needed since WebFont.load is converted to <link>)
  output = output.replace(
    /<script[^>]*src=["'][^"']*\/webfontloader[^"']*\.js["'][^>]*>\s*<\/script>/gi,
    ""
  );

  return output;
}

function rewriteChinaCdnTokens(input, cfg) {
  return input
    .replace(
      /https?:\/\/cdn\.jsdelivr\.net\/(npm|gh)\//gi,
      `${cfg.mirrorJsdMirror}/$1/`
    )
    .replace(
      /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\//gi,
      `${cfg.mirrorJsdMirror}/ajax/libs/`
    )
    .replace(
      /https?:\/\/unpkg\.com\/(.+?)(?=["')\s>,])/gi,
      `${cfg.mirrorJsdMirror}/npm/$1`
    );
}

function stripCssIntegrity(input) {
  return input.replace(
    /<link\b([^>]*?\brel\s*=\s*["']stylesheet["'])([^>]*)>/gi,
    (_, relAttr, rest) => {
      rest = rest.replace(/\s*integrity\s*=\s*["'][^"']*["']/gi, "");
      rest = rest.replace(/\s*crossorigin\s*=\s*["'][^"']*["']/gi, "");
      return `<link${relAttr}${rest}>`;
    }
  );
}

function resolveUpstreamTarget(reqUrl, cfg) {
  if (!cfg.originHost) return null;
  const originBase = `https://${cfg.originHost}`;
  if (!reqUrl.pathname.startsWith(`${cfg.assetProxyPrefix}/`)) {
    return {
      assetProxy: false,
      upstreamHost: cfg.originHost,
      upstreamUrl: new URL(reqUrl.pathname + reqUrl.search, originBase),
      sourcePathname: reqUrl.pathname
    };
  }

  const rest = reqUrl.pathname.slice(`${cfg.assetProxyPrefix}/`.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;

  const host = rest.slice(0, slashIndex).toLowerCase();
  if (!cfg.proxyableHosts.some(h => host.endsWith(h))) return null;

  const path = rest.slice(slashIndex);
  return {
    assetProxy: true,
    upstreamHost: host,
    upstreamUrl: new URL(`https://${host}${path}${reqUrl.search}`),
    sourcePathname: path
  };
}

function ensurePrefix(s) {
  if (!s) return DEFAULT_CONFIG.assetProxyPrefix;
  return s.startsWith("/") ? s : `/${s}`;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteCssFonts(input, requestUrl, cfg) {
  const reqHost = requestUrl.host;
  const reqOrigin = requestUrl.protocol + "//" + reqHost;
  const prefix = cfg.assetProxyPrefix;
  let output = input;
  cfg.proxyableHosts.forEach(function(host) {
    const escaped = escapeRegExp(host);
    // Build regex via string concatenation to avoid esbuild template literal regex issues
    var re1 = new RegExp("url\\(\\s*([\"']?)https?://([\\w.-]*" + escaped + ")", "gi");
    var re2 = new RegExp("url\\(\\s*([\"']?)//([\\w.-]*" + escaped + ")", "gi");
    output = output.replace(re1, function(m, q, fullHost) {
      return "url(" + (q || "") + reqOrigin + prefix + "/" + fullHost;
    });
    output = output.replace(re2, function(m, q, fullHost) {
      return "url(" + (q || "") + "//" + reqHost + prefix + "/" + fullHost;
    });
  });
  return output;
}

async function generateSitemap(cfg, reqUrl) {
  const reqOrigin = `${reqUrl.protocol}//${reqUrl.host}`;

  // Strategy 1: If origin already has a sitemap.xml, proxy it with domain rewriting
  try {
    const originSitemapUrl = `https://${cfg.originHost}/sitemap.xml`;
    const resp = await fetch(originSitemapUrl, { headers: { "accept-encoding": "identity" } });
    if (resp.ok) {
      const text = await resp.text();
      if (text.includes("<urlset") || text.includes("<sitemapindex")) {
        return rewriteDomainTokens(text, reqUrl, cfg);
      }
    }
  } catch (_e) { /* origin has no sitemap, continue */ }

  // Strategy 2: Scrape homepage for internal links (no auth or third-party services needed)
  try {
    const items = await scrapeHomepageLinks(cfg, reqOrigin);
    if (items.length > 0) {
      return buildSitemapXml(items);
    }
  } catch (_e) { /* scraping failed, use fallback */ }

  // Fallback: single-entry sitemap with homepage only
  return buildSitemapXml([{ loc: reqOrigin, lastmod: new Date().toISOString().slice(0, 10) }]);
}

async function scrapeHomepageLinks(cfg, reqOrigin) {
  const homepageUrl = `https://${cfg.originHost}/`;
  const resp = await fetch(homepageUrl, { headers: { "accept-encoding": "identity" } });
  if (!resp.ok) return [];

  const html = await resp.text();
  const seen = new Set();
  const items = [];

  const hrefRe = /<a\b[^>]*?\bhref\s*=\s*["']([^"']*?)["'][^>]*>/gi;
  let match;
  while ((match = hrefRe.exec(html)) !== null) {
    let href = match[1];
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let absolute;
    try {
      absolute = new URL(href, reqOrigin);
    } catch (_e) { continue; }
    if (absolute.host !== new URL(reqOrigin).host) continue;
    absolute.search = "";
    absolute.hash = "";
    let normalized = absolute.toString().replace(/\/$/, "");
    if (normalized === reqOrigin.replace(/\/$/, "")) continue;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      items.push({ loc: normalized });
    }
  }

  return items;
}

function buildSitemapXml(items) {
  const urls = items.map(i =>
    `  <url><loc>${escapeXml(i.loc)}</loc>${i.lastmod ? `<lastmod>${i.lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
