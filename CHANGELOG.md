# Changelog

## [Unreleased] — v2.6.0

### 腾讯云 Site Acceleration 测试候选

- **feat**: 增加 `PUBLIC_HOST`，确保经 Site Acceleration 回源后的 HTML、Canonical、资源和跳转使用外部域名
- **observability**: Cache API 写入明确输出 `STORE_OK / STORE_FAILED`，并增加缓存分类和内容分类响应头
- **cache**: 移除不改变响应内容的 `Accept` 缓存键及 `Vary`，HTML tracking 查询参数归一化，功能性查询继续 BYPASS
- **prewarm**: 受鉴权刷新接口默认读取源站 Sitemap，最多预热 20 个 HTML 页面
- **audit**: 增加静态资源连续请求审计，并将 FeedSpring 403 单列
- **infra**: 创建 custom/staging/EO 三条隔离测试线路；Site Acceleration 已下发 30 天静态缓存、1 天浏览器缓存、80% 预刷新、Brotli/Gzip、HTTP/2 和 HTTPS
- **limit**: 当前套餐不支持 QUIC/HTTP/3 和自定义 Cache Key；未购买或升级，追踪参数只在 Makers 内层归一化

## [v2.5.0] — 2026-08-24

### EdgeOne Blob 备用快照

- **feat**: 增加显式 `SNAPSHOT_BLOB_STORE`，在 KV 未绑定时使用 Makers Blob 保存 HTML 快照
- **safety**: KV 与 Blob 同时配置时保持 KV 优先，不双写、不自动迁移快照
- **observability**: 增加 `X-EdgeFlow-Snapshot-Store: kv|blob` 和健康检查 `snapshotStoreType`
- **build**: 使用 esbuild 打包 Edge Function 与 `@edgeone/pages-blob`，保留 CLI 直传所需的单文件产物
- **test**: 增加 Blob MISS/FRESH、KV 优先级和无效 Blob 配置安全降级测试
- **preview**: EdgeOne 访问门禁的 `eo_token` / `eo_time` Cookie 不再触发缓存绕过，也不会转发到 Webflow；任何其他真实会话 Cookie 仍强制 BYPASS
- **audit**: 浏览器审计支持通过 `EDGEFLOW_AUDIT_COOKIES_JSON` 注入受保护预览所需 Cookie，输出只记录 Cookie 名称、不记录值
- **verified**: 独立预览真实运行时已确认首次 Blob MISS、随后 FRESH/HIT；冷浏览器 HTML TTFB 约 169–335ms，但代理静态资源仍持续 MISS
- **test**: 浏览器审计记录 HTML 与资源的 EdgeFlow 缓存证据，并区分普通冷访问与硬刷新

## [v2.4.0] — 2026-08-24

### EdgeOne 持久快照

- **feat**: 使用 Makers KV 保存完成中国大陆改写后的 HTML 快照
- **feat**: 快照过期时先返回旧内容，再通过 `context.waitUntil()` 后台刷新
- **feat**: 增加受 `SNAPSHOT_REFRESH_SECRET` 保护的主动刷新端点
- **feat**: 增加 `X-EdgeFlow-Snapshot`、快照年龄和后台刷新诊断头
- **safety**: Cookie、Authorization、Range 和功能性查询参数绕过公共 HTML 快照
- **fallback**: KV 未绑定、读取失败或回源刷新失败时保留现有 Cache API/最后成功快照路径
- **test**: 增加 KV MISS/FRESH/STALE、后台刷新、查询归一化和刷新鉴权测试

## [v2.3.1] — 2026-08-23

### EdgeOne 缓存与安全

- **fix**: 将 Makers 原生缓存配置改为官方 `caches` + `cacheTtl` schema，移除未受支持的字段
- **fix**: 清除上游 `Age`、`Expires` 及改写后失效的 ETag/摘要头，避免新响应立即过期
- **fix**: Cache API 读取过期或异常后允许回源并重新写入，恢复缓存自愈能力
- **feat**: 增加安全的 `Server-Timing`，区分 cache lookup、origin、rewrite 和 total 耗时
- **test**: 增加原生缓存 schema、过期元数据、计时头和缓存异常恢复覆盖

- **fix**: 修复构建产物重复声明 `handleProxyRequest`，并保留完整 EdgeOne `context`
- **feat**: 使用 `caches.default` + `context.waitUntil()` 实现显式缓存
- **feat**: 增加 `X-EdgeFlow-Cache: HIT|MISS|BYPASS` 及原因头
- **security**: 健康检查改为最小状态，不再公开 IP、Cookie、请求头或运行时对象
- **security**: Cookie、Authorization、Range、非 200、Set-Cookie 和 Geo 301 不写共享缓存
- **fix**: 重写 `Link` preload 响应头，避免资源通过预加载绕过代理与镜像规则
- **fix**: 让普通 Webflow CSS 进入文本改写分支，修复背景图和字体绕过代理的问题
- **test**: 增加构建、Geo、缓存键、Cookie、HEAD、Location、静态资源和浏览器审计覆盖

## [v2.2] — 2026-07-14

### 新增许可证

- **license**: 新增 LICENSE（个人使用许可证），个人免费商用需授权

## [v2.1] — 2026-07-14

### 整理文件简化结构

- **refactor**: 精简 README，只保留项目背景、能力边界和直接操作步骤
- **docs**: 新增 AGENTS.md 提供 AI 上下文，复杂说明移至 docs/ 目录
- **feat**: 根目录添加 EdgeOne 部署软链接，Root Directory 默认选择 /
- **fix**: 统一环境变量 WEBFLOW_ORIGIN_HOST → WEBFLOW_HOST，代码内置默认值
- **chore**: 移除开发缓存文件（.codegraph/、.reasonix/、.wrangler/ cache）
- **chore**: 移除开发任务跟踪（tasks/）和测试脚本（scripts/）
- **chore**: 移除内部验证文档（docs/v2.1-optimize-verify.md）
- **chore**: 更新 .gitignore 覆盖缓存和脚本目录


All notable changes to this project will be documented in this file.

## [v2.0] — 2026-06-09

### 🎯 Geo 路由修复（核心）

- **fix**: 重写 `getClientCountry()` 函数，优先检测 `request.eo.geo.countryCodeAlpha2`（EdgeOne Pages 运行时属性，无需手动配置回源头）
- **fix**: 新增 `eo-is-mainland` 请求头检测作为备用方案（EdgeOne Pages 自动注入）
- **feat**: Health 端点现在显示完整 Geo 检测信息（detectedCountry + 检测到/未检测到提示）
- **feat**: 海外用户（非 CN）访问时返回 `301 redirect → webflowcn.webflow.io`，附带 `cache-control: no-cache` 防止重定向缓存误伤

### 🔧 Health 端点修复

- **fix**: 弃用 `Response.json()`（EdgeOne Pages 运行时不支持，导致 HTTP 500），改用 `new Response(JSON.stringify())` 
- **feat**: 增加完整请求头 dump 和 `request.eo` / `context.eo` 运行时属性探测，方便未来调试

### 🗄️ 缓存分离修复

- **fix**: HTML 响应增加 `Vary: Accept, EO-Client-IPCountry` header，提示边缘缓存按地区区分
- **fix**: `stale-while-revalidate` 从 604800（7 天）降低至 3600（1 小时），避免 Geo 相关内容过期后的缓存混用
- **feat**: `edgeone.json` 全部静态资源规则增加 `varyByHeader: ["EO-Client-IPCountry"]`

### 🏗️ 代码质量

- **fix**: `rewriteCssFonts()` 函数中正则捕获组缺少闭合括号，导致 esbuild 构建失败（Node.js 语法检查能通过但 EdgeOne 的 esbuild 更严格）
- **fix**: 用 `RegExp("str" + var)` 字符串拼接替代模板字面量 `` RegExp(`...${var}`) `` 规避 esbuild 正则校验问题
- **refactor**: `handleProxyRequest` 增加第三个参数 `context`，用于传递 EdgeOne pages 运行时对象

### 🧹 清理

- **chore**: 删除 `packages/edgeone/functions/` 旧版遗留目录（内容已迁移到 `edge-functions/`）
- **chore**: 清理构建临时目录和 zip 文件
- **docs**: 更新 README.md 部署说明

### 验证结果

| 场景 | 预期 | 结果 |
|------|------|------|
| 🇨🇳 CN 直连 | 200 OK, baomitu/jsdmirror 替换 | ✅ |
| 🇺🇸 美国代理 | 301 → webflowcn.webflow.io | ✅ |
| Health 端点 | 200 OK, 返回 Geo 信息 | ✅ |
| esbuild 构建 | 无语法错误 | ✅ |

---

## [v1.0] — 2026-05

- Initial release
- CF Worker + R2 和 EdgeOne Pages 双路线
- 12 项 Webflow 中国大陆加速优化
