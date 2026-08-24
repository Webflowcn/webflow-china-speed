# Tencent acceleration v2.6 test deployment

## Isolation

The production project and `tectura-cn.webflowcn.com` remain unchanged. The test deployment uses:

| Route | Makers project | Webflow origin | Public host |
|---|---|---|---|
| Custom-domain origin | `makers-xe3nuqhd0ypf` | `www.bunkrdesign.co.uk` | `tectura-v26-custom.webflowcn.com` |
| Webflow staging origin | `makers-9xm9tatnnoz9` | `bunkr-design.webflow.io` | `tectura-v26-staging.webflowcn.com` |
| Site Acceleration origin | `makers-fr98yjbdsuae` | `bunkr-design.webflow.io` | internal `tectura-v26-eo-origin.webflowcn.com` |
| Site Acceleration entry | EdgeOne zone `zone-3p4cmw8cmpj0` | the isolated Makers origin above | `tectura-v26-eo.webflowcn.com` |

The internal Site Acceleration origin has `PUBLIC_HOST=tectura-v26-eo.webflowcn.com`, so rewritten HTML, redirects, Canonical URLs, and asset URLs never expose the internal origin hostname.

## Applied EdgeOne policy

The JSON files in `packages/edgeone/config/` are the auditable source used to create the active rules:

- Follow safe origin cache headers. Makers emits a five-minute `s-maxage` for HTML and `no-store` for APIs, functional requests, and errors.
- Cache `/__eo_asset_v3__/*` and fingerprinted fonts, images, CSS, and JavaScript at the edge for 30 days.
- Set the browser TTL for those static resources to one day and pre-refresh at 80% of edge TTL.
- Explicitly bypass `/__proxy/*`, `/api*`, and `/__edgeflow/*`.
- Enable Brotli/Gzip, HTTP/2, and HTTPS redirect.

Rules are scoped to `tectura-v26-eo.webflowcn.com`; they do not alter other `webflowcn.com` hosts.

## Current-plan limits

The existing plan rejected QUIC/HTTP/3 and custom Cache Key. No upgrade or purchase was made.

- HTTP/3 remains off; HTTP/2 is on.
- EdgeOne cannot remove `utm_*`, `fbclid`, and `gclid` from its outer cache key on this plan. Makers still normalizes those parameters internally, but EdgeOne may hold duplicate HTML objects for tracked URLs.
- Version query strings on static resources remain part of the cache key.

## TLS and DNS

The Site Acceleration entry uses an EdgeOne free certificate. Makers custom domains use separate EdgeOne free certificates and DNS delegation records under `_dnsauth.*`. Keep those records in DNSPod so renewal can remain automatic.

## Verification

Do not count requests while DNS, certificates, or configuration deployment are still processing. After all hosts are online:

1. Verify `GET /__edgeflow/health` returns version `2.6.0` and `publicHostConfigured: true`.
2. Run five ordinary anonymous requests without sending `Cache-Control: no-cache`.
3. Extract one real font, CSS, JavaScript, and image URL from HTML and request each five times.
4. Record `X-EdgeFlow-*`, EdgeOne cache headers, DNS/connect/TLS/TTFB, and browser FCP/LCP.
5. Compare medians against `tectura-cn.webflowcn.com`; do not promote based on a single warm request.

