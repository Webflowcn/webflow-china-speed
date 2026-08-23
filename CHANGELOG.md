# Changelog

## [Unreleased] — v2.3

### EdgeOne 缓存与安全

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
