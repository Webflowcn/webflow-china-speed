 # Architecture

 ## 系统架构

 Webflow-China-Speedup 本质上是一个**反向代理 + 内容改写**系统，位于用户和 Webflow 源站之间。

 ```
 用户浏览器
     │
     ▼
 ┌─────────────────────┐
 │   CF Worker / EO    │  ← 反向代理 + HTML 改写 + 缓存
 │   Edge Functions    │
 └────────┬────────────┘
          │
     ┌────┴────┐
     │ 缓存层   │  ← R2（CF）/ EdgeOne 节点缓存
     └─────────┘
          │
          ▼
    xxx.webflow.io     ← Webflow 源站
 ```

 ## 请求处理流程

 1. 用户请求 `cdn.example.com/page`
 2. Edge Function 检查请求是否可缓存；中国大陆公开 GET/HEAD 查询 `caches.default`
 3. 命中 → 返回 `X-EdgeFlow-Cache: HIT`
 4. 未命中 → 代理请求配置的 Webflow Staging 或正式自定义域名
 5. HTML 响应 → 流式（CF）或全量（EO）改写：
    - 替换所有资源 URL 为代理地址
    - 移除 Google Fonts/Analytics 引用
    - 替换 jQuery CDN 为国内镜像
    - 移除 SRI integrity 属性
    - 修正 301/302 Location 头
 6. 可安全共享的 200 响应写入节点缓存并返回 `MISS`；敏感或动态响应返回 `BYPASS`
 7. CSS/JS/图片 → 重写内部 URL；指纹资源使用长 TTL
 8. 视频 Range 请求透传且不写完整对象缓存

 ## 缓存架构

 ### CF Worker + R2
 - HTML: 边缘缓存 5 分钟（`CACHE_TTL`）
 - 静态资源: R2 永久缓存 + 边缘缓存 24h（`cacheTtl: 86400`）
 - 缓存键: 包含 query string，支持版本化资源

### EdgeOne Pages
 - HTML: `caches.default` 显式缓存，默认 5 分钟
 - 指纹静态资源: 30 天；非指纹静态资源: 1 天
 - 缓存键: 完整 URL（含 query string）+ `Accept`
 - 安全边界: 只缓存中国大陆公开 GET；HEAD 可读取已有 GET 缓存但不会用空响应填充
 - 可观测性: `X-EdgeFlow-Cache` 和 `X-EdgeFlow-Cache-Reason`
 - `edgeone.json` 仍提供平台静态缓存规则，但不能替代函数层 HIT/MISS 证据

 ## 两条路线对比

 | 维度 | CF Worker + R2 | EdgeOne Pages |
 |------|---------------|---------------|
 | **执行环境** | Cloudflare Workers (V8) | EdgeOne Edge Functions (V8) |
 | **运行时限制** | 10ms CPU / 50MB 内存 | 标准函数限制 |
 | **HTML 改写** | `HTMLRewriter`（流式，低延迟） | `replaceAll()`（全量替换） |
 | **持久存储** | R2（全球读写） | EdgeOne 节点缓存 |
 | **自定义域名** | Worker 域名绑定 | EdgeOne Pages 域名绑定 |
 | **ICP 要求** | 不需要 | 需要 |
 | **大陆延迟** | 取决于出口与回源 | 取决于备案、节点、函数和缓存命中；需实测 |

 ## 关键文件

 - `packages/edgeone/edge-functions/_shared/proxy.js` — EdgeOne 核心代理逻辑
 - `packages/cf-worker/worker.js` — CF Worker 核心代理逻辑
 - `packages/edgeone/edgeone.json` — EdgeOne Pages 缓存/响应头规则
 - `packages/cf-worker/edgeflow.config.js` — CF Worker 用户配置


---

## 为什么要用 webflow.io 地址，而不是发布域名

Webflow 自定义域名的 DNS 指向 `cdn.webflow.com`（Cloudflare IP），这个出口被 GFW 封锁，这就是你的网站在大陆打不开的根本原因。详见 [Webflow 官方文档](https://help.webflow.com/hc/en-us/articles/33961315914515-Connect-your-Cloudflare-domain-to-Webflow)。

本方案通过  地址访问源站——这个域名走的是另一组 IP，目前在大陆仍可访问。代理负责从  拉取内容、改写被墙的资源、通过国内节点返回给用户。

---

## 痛点分析

| 问题 | 影响 |
|---|---|
| GFW 封控  | 自定义域名完全不可访问 |
| Google Fonts / Analytics 被墙 | 字体空白，页面阻塞 2–5 秒 |
| Webflow CDN 无大陆节点 | CSS/JS/图片从海外回源，极慢 |
| jQuery 走 CloudFront（亚马逊 CDN） | 每次页面加载阻塞 500ms–2s |

---

## 代理中的 12 项优化

| # | 优化项 | 说明 |
|---|---|---|
| 1 | HTML 缓存头 | 边缘缓存 5 分钟，避免每次回源 |
| 2 | Google 资源清理 | 移除 preconnect / dns-prefetch / GTM / GA |
| 3 | CSS @import 过滤 | 删除 CSS 内的 Google Fonts 引用 |
| 4 | R2 query string 键 | 带版本参数的资源正确缓存 |
| 5 | jQuery 镜像替换 | CloudFront → 国内 CDN |
| 6 | 视频 URL 重写 | data-video-urls 纳入缓存 |
| 7 | HTTP Range 支持 | 视频分段加载、立即起播 |
| 8 | CSS 内部 URL 改写 | @font-face / 背景图不走 Fastly |
| 9 | SRI integrity 移除 | CSS 改写后防止哈希校验失败 |
| 10 | 视频 poster 补全 | source / srcset / poster-url / style 全覆盖 |
| 11 | 301/302 拦截 | 修正 Location 头，防止 webflow.io 泄露 |
| 12 | Webflow Badge 移除 | CSS + MutationObserver 双重移除 |
