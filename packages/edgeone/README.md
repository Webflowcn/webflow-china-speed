# Webflow China Speedup — EdgeOne Pages

> EdgeOne 部署路径。与 `packages/cf-worker/`（Cloudflare Worker 路径）并列，用户可按需选择。
>
> 本路径利用 EdgeOne 国内节点、Edge Functions 和显式 Cache API。是否比 Webflow 直连更快，取决于备案、节点调度、缓存命中和源站状态，部署后必须实测。

## 为什么选择 EdgeOne 路径？

| 特性 | EdgeOne | Cloudflare Worker |
|------|---------|-------------------|
| 国内节点 | ✅ 3200+ 边缘节点（全国覆盖） | ❌ 无国内节点 |
| 免费额度 | 500 万请求/月（Edge Function） | 10 万请求/天（Worker） |
| 缓存 | 节点 Cache API（非持久存储） | R2 持久存储 + 边缘缓存 |
| 爬虫控制 | ✅ 免费 AI Bot Management（2026.02 上线） | ❌ 需要额外规则 |
| 部署复杂度 | 腾讯云国内账号 | Cloudflare 全球账号 |

## 缓存架构

EdgeOne 路径不需要存储桶，但节点 Cache API **不等同于 R2 持久存储**。函数先检查 `caches.default`，命中后直接返回；未命中才回源、改写并异步写入当前节点缓存。

| 层级 | 组件 | TTL | 说明 |
|------|------|-----|------|
| L1 | `caches.default` | HTML 默认 5 分钟；指纹资源 30 天 | Edge Function 内显式 HIT/MISS；节点可能提前淘汰 |
| L2 | EdgeOne 平台缓存规则 | 见 `edgeone.json` | 作为静态资源缓存补充，实际行为需线上验证 |
| L3 | Webflow 源站 | — | 缓存未命中时回源 |

- 仅中国大陆地区的 `GET`/`HEAD` 参与显式缓存查找。
- HTML 默认 TTL 5 分钟；带内容指纹的静态资源 30 天；其他静态资源 1 天。
- 带 `Cookie`、`Authorization`、`Range`、`no-cache/no-store` 的请求直接绕过。
- 非 200、`Set-Cookie`、私有或 `no-store` 响应不写缓存；Geo 301 永不缓存。
- 用 `X-EdgeFlow-Cache: HIT|MISS|BYPASS` 判断函数缓存结果，不再根据耗时或 `Age` 猜测。

## 2026 年 EdgeOne 新功能

| 功能 | 上线时间 | 对本项目的影响 |
|------|---------|---------------|
| AI Bot Management（爬虫控制） | 2026.02 | 可在控制台免费开启，无需代码修改 |
| AI 爬虫画像库 | 2026.03 | 自动识别 AI 爬虫并限制频率，GUI 配置 |
| 永久免费套餐 | 2026.03 | 基础 Edge Function 配额永久免费 |
| 一键式 KV 存储 | 2026.05 | 如需要缓存共享数据，控制台直接开启 |

以上功能均通过 EdgeOne 控制台 GUI 配置，无需修改 Edge Function 代码。

## 版本历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初始版本 |
| v2.0 | 修复 Geo 路由、Health 端点、缓存地区分离 |
| v2.1 | 目录整合（`edgeone-optimized` 合并到 `edgeone`）、更新新功能文档 |
| v2.3 | 修复构建、显式 Cache API、最小健康检查、Link 头重写、缓存测试 |
| v2.3.1 | 修复 Makers 原生缓存 schema、过期元数据、缓存自愈与分阶段计时 |

## v2.0 修复内容

| # | 问题 | 修复方式 |
|---|------|---------|
| 1 | Geo 路由不生效 | 改用 `getClientCountry()` 多 header fallback，不再只依赖 `EO-Client-IPCountry` |
| 2 | Health 端点 500 | 不用 `Response.json()`，改用 `new Response(JSON.stringify())` |
| 3 | 缓存不分地区 | 响应增加地区 `Vary`；v2.3.1 移除未受 Makers schema 支持的 `varyByHeader`，原生长缓存只用于代理资源路径 |
| 4 | stale 过期太长 | 从 604800(7天) 降至 3600(1小时) |

## 部署步骤

### 方式一：通过 EdgeOne Pages 控制台（推荐）

 1. 执行 `node build.mjs` 生成 `.edgeone/` 目录
 2. 将整个仓库提交到 Git（根目录含部署所需的软链接）
 3. 打开 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → Pages → 新建项目
 4. 选择「从 Git 导入」，Root directory 选择根目录 `/`（默认值，无需修改）
 5. 构建配置留空，直接创建
 6. 绑定自定义域名 → 代理立即生效（默认 `webflowcn.webflow.io` 演示站点）
 7. 要代理你自己的网站，在控制台 → 环境变量添加 `WEBFLOW_HOST` = 你的 `xxx.webflow.io`，然后重新部署
 8. （可选）在控制台开启 AI Bot Management 限制爬虫频率

 ### 方式二：直接上传文件夹
 
 1. 执行 `node build.mjs`
 2. 将整个 `edgeone/` 目录压缩上传到 EdgeOne Pages
 3. 绑定域名即可使用（默认代理 `webflowcn.webflow.io`）
 4. 要代理你自己的网站，在控制台添加环境变量 `WEBFLOW_HOST` = 你的 `xxx.webflow.io`

## 爬虫控制建议（EdgeOne 控制台配置）

EdgeOne 提供免费的爬虫管理能力，无需修改 Edge Function 代码：

1. 登录 [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)
2. 进入你的站点 → **安全 → Bot 管理**
3. 开启 **AI Bot 画像识别**（2026.02 上线的免费功能）
4. 设置规则：对 AI 爬虫返回 403 或限制速率
5. 或者在 **速率限制** 中设置：单 IP 每秒不超过 10 次请求

## 验证

本地先执行：

```bash
cd packages/edgeone
npm test
npm run build
npm run audit:live -- https://你的域名
```

部署后访问 `https://你的域名/__proxy/health`，应看到：

```json
{"ok":true,"runtime":"edgeone-pages","version":"2.3.1","originConfigured":true,"cacheApiAvailable":true}
```

- 用美国代理访问 → 应 301 重定向到 `webflowcn.webflow.io`
- 直连访问（CN）→ 正常显示，资源走国内 CDN
- 连续访问同一公开页面 → 首次应为 `MISS`，同节点后续请求应为 `HIT`
- 带 Cookie 或 Authorization 访问 → 必须为 `BYPASS`
- 查看 `Server-Timing` → 可分别检查 cache、origin、rewrite 与 total 耗时

## 环境变量

 | 变量名 | 必填 | 说明 |
 |--------|------|------|
 | `WEBFLOW_HOST` | 可选 | 你的 Webflow 项目地址（默认 `webflowcn.webflow.io`）|
 | `CACHE_TTL` | 可选 | HTML 显式缓存 TTL，默认 300 秒 |
 | `MIRROR_JQUERY` | 可选 | jQuery 国内镜像地址 |
| `MIRROR_JSD_MIRROR` | 可选 | jsDelivr 国内镜像 |
| `MIRROR_WEBFONT` | 可选 | WebFont loader 国内镜像 |
| `ASSET_PROXY_PREFIX` | 可选 | 资源代理路径前缀（默认 `/__eo_asset_v3__`） |

## 注意事项

- 首次部署后，用海外代理访问确认是否触发了 301 重定向
- 如果 Geo 路由仍不工作，检查腾讯云 EdgeOne 控制台 → 「回源 HTTP 请求头」是否传递了 `EO-Client-IPCountry`
- 如需限制爬虫频率，优先使用 EdgeOne 控制台的 Bot Management 功能，不需要修改函数代码
- EdgeOne 免费配额：500 万次 Edge Function 调用/月（2026.07 标准），普通站点远用不完
