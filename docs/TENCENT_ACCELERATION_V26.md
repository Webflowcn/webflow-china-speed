# Tencent acceleration v2.6 test deployment

## Isolation

The production project and `tectura-cn.webflowcn.com` remain unchanged. The test deployment uses:

| Route | Makers project | Webflow origin | Public host |
|---|---|---|---|
| Custom-domain origin | `makers-xe3nuqhd0ypf` | `www.bunkrdesign.co.uk` | `tectura-v26-custom.webflowcn.com` |
| Webflow staging origin | `makers-9xm9tatnnoz9` | `bunkr-design.webflow.io` | `tectura-v26-staging.webflowcn.com` |
| Site Acceleration entry | EdgeOne zone `zone-3p4cmw8cmpj0` | `tectura-v26-staging.webflowcn.com` | `tectura-v26-eo.webflowcn.com` |

The separate `tectura-v26-eo-origin` Makers project was not used because its preset and custom-domain routes returned empty responses. EdgeOne instead reuses the known-good staging Makers project. Direct staging requests retain `PUBLIC_HOST=tectura-v26-staging.webflowcn.com`; EdgeOne injects `X-EdgeFlow-Site-Secret`, and only a constant-time match against `SITE_ACCELERATION_SECRET` activates `SITE_ACCELERATION_PUBLIC_HOST=tectura-v26-eo.webflowcn.com`. The secret is stripped before Webflow fetches and is never returned by health or proxy responses.

`packages/edgeone/config/edgeone-site-acceleration-rules.json` is a template: replace `${SITE_ACCELERATION_SECRET}` only while applying the rule. Never commit the real value.

## Applied EdgeOne policy

The JSON files in `packages/edgeone/config/` are the auditable source used to create the active rules:

- Follow safe origin cache headers. Makers emits a five-minute `s-maxage` for HTML and `no-store` for APIs, functional requests, and errors.
- Cache `/__eo_asset_v3__/*` and fingerprinted fonts, images, CSS, and JavaScript at the edge for 30 days.
- Set the browser TTL for those static resources to one day and pre-refresh at 80% of edge TTL.
- Explicitly bypass `/__proxy/*`, `/api*`, and `/__edgeflow/*`.
- Enable Brotli/Gzip, HTTP/2, and HTTPS redirect.
- Inject the authenticated Makers override header in the base rule.

Rules are scoped to `tectura-v26-eo.webflowcn.com`; they do not alter other `webflowcn.com` hosts.

## Current-plan limits

The existing plan rejected QUIC/HTTP/3 and custom Cache Key. Default prefetch also returned `LimitExceeded.BatchQuota`, including for a single URL. No upgrade or purchase was made.

- HTTP/3 remains off; HTTP/2 is on.
- EdgeOne cannot remove `utm_*`, `fbclid`, and `gclid` from its outer cache key on this plan. Makers still normalizes those parameters internally, but EdgeOne may hold duplicate HTML objects for tracked URLs.
- Version query strings on static resources remain part of the cache key.

## TLS and DNS

The Site Acceleration entry uses an EdgeOne free certificate. Makers custom domains use separate EdgeOne free certificates and DNS delegation records under `_dnsauth.*`. Keep those records in DNSPod so renewal can remain automatic.

## Verification

Do not count requests while DNS, certificates, or configuration deployment are still processing. After all hosts are online:

1. Verify `GET /__proxy/health` returns version `2.6.0`, `siteAccelerationOverrideConfigured: true`, and `siteAccelerationOverrideActive: true` through the EO hostname. Direct staging must report active `false`.
2. Run five ordinary anonymous requests without sending `Cache-Control: no-cache`.
3. Extract one real font, CSS, JavaScript, and image URL from HTML and request each five times.
4. Record `X-EdgeFlow-*`, EdgeOne cache headers, DNS/connect/TLS/TTFB, and browser FCP/LCP.
5. Compare medians against `tectura-cn.webflowcn.com`; do not promote based on a single warm request.

## Verified result on 2026-08-24

Each sample used a new temporary anonymous Chrome profile from mainland-China direct routing. Cookies and browser cache were cleared, browser cache was not disabled, and no `no-cache` header was sent.

| Median, 5 runs | Current `tectura-cn` baseline | v2.6 Site Acceleration | Improvement |
|---|---:|---:|---:|
| HTML TTFB | 1072.5 ms | 22.1 ms | 97.9% |
| FCP | 3148 ms | 208 ms | 93.4% |
| LCP | 3820 ms | 208 ms | 94.6% |
| Full load | 6069.7 ms | 802.2 ms | 86.8% |

Repeated CSS, JavaScript, TTF, and JPG checks all had increasing positive `Age` values. Requests after the first edge fill took 19-59 ms, so the second-round edge hit rate for the four sampled asset classes was 100%. The retained `X-EdgeFlow-Cache: MISS` header describes the original Makers response stored by EdgeOne; `Age` plus the absence of repeat origin latency is the outer-cache evidence.

The corrected Sitemap exposes four EO-host URLs. Automatic prefetch was unavailable under the current quota, so the homepage, `/styles`, `/contact`, `/contact-copy`, and sampled first-screen assets were warmed through ordinary requests. Second requests to the four HTML routes returned in 54-63 ms with positive `Age`.

FeedSpring still returns 403 in every browser run and remains a separate third-party compatibility issue. The browser-vitals table represents this Mac's mainland-China direct route; the following network-level check adds four mainland cities.

### Four-city cold versus warm check

Globalping used the same probes in Beijing, Shanghai, Guangzhou, and Chengdu for the repeat round. The first cold EO fill had 1977-2287 ms TTFB and was not faster than the current baseline's 1854-2275 ms. On the second request from the same probes, EO TTFB fell to 13-30 ms while the baseline remained 888-2062 ms. Warm medians were 19.5 ms for EO versus 1664.5 ms for the baseline; total-time medians were 160 ms versus 1707 ms.

Measurements: EO cold `2KSRpZ8CWpjcN9Hcm000210N5`, EO repeat `2cfpkRfEIZsEd7JmD000210N6`, baseline cold `2psLcwRXmhyPv7AOT000210N5`, baseline repeat `2wJ0Aw8rlo74HnV7T000210N6`.

This confirms that the acceleration benefit depends on an EdgeOne object already existing near the visitor. A previously cold POP can still pay the Makers/Webflow origin cost. Because automatic prefetch is unavailable on the current quota, keeping key routes warm through ordinary traffic or a permitted scheduler is the main remaining performance gap.
