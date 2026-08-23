# Webflow China Speedup — EdgeOne Makers

> EdgeOne 部署路径。与 `packages/cf-worker/`（Cloudflare Worker 路径）并列，用户可按需选择。
>
> 本路径利用 EdgeOne 国内节点、Edge Functions 和显式 Cache API。是否比 Webflow 直连更快，取决于备案、节点调度、缓存命中和源站状态，部署后必须实测。

## 为什么选择 EdgeOne 路径？

| 特性 | EdgeOne | Cloudflare Worker |
|------|---------|-------------------|
| 国内节点 | ✅ 3200+ 边缘节点（全国覆盖） | ❌ 无国内节点 |
| 免费额度 | 以 Makers 当前配额页为准（当前 Edge Function 300 万次/月） | 10 万请求/天（Worker） |
| 缓存 | Makers KV 持久 HTML 快照 + 节点 Cache API | R2 持久存储 + 边缘缓存 |
| 爬虫控制 | ✅ 免费 AI Bot Management（2026.02 上线） | ❌ 需要额外规则 |
| 部署复杂度 | 腾讯云国内账号 | Cloudflare 全球账号 |

## 缓存架构

v2.4 优先从 Makers KV 读取已经完成改写的 HTML 快照。快照新鲜时直接返回；过期时先返回旧快照，再通过 `context.waitUntil()` 后台刷新。KV 不可用时安全降级到原有 Cache API 和实时回源。

| 层级 | 组件 | TTL | 说明 |
|------|------|-----|------|
| L1 | Makers KV `EDGEFLOW_SNAPSHOT` | HTML 默认 15 分钟后后台刷新 | 持久保存最后成功快照；边缘读取最长约 60 秒最终一致 |
| L2 | `caches.default` | HTML 默认 5 分钟；指纹资源 30 天 | Edge Function 节点缓存，可能提前淘汰 |
| L3 | EdgeOne 平台缓存规则 | 见 `edgeone.json` | 代理静态资源的原生缓存补充 |
| L4 | Webflow 源站 | — | 所有缓存未命中或后台刷新时才回源 |

- 仅中国大陆地区的 `GET`/`HEAD` 参与显式缓存查找。
- HTML KV 快照默认 15 分钟后转为 STALE；用户仍立即得到旧快照，刷新在后台进行。
- 带内容指纹的静态资源缓存 30 天；其他静态资源 1 天。
- 带 `Cookie`、`Authorization`、`Range`、`no-cache/no-store` 的请求直接绕过。
- 非 200、`Set-Cookie`、私有或 `no-store` 响应不写缓存；Geo 301 永不缓存。
- 用 `X-EdgeFlow-Snapshot: FRESH|STALE|MISS` 判断持久快照状态。
- 用 `X-EdgeFlow-Cache: HIT|MISS|BYPASS` 判断整体缓存结果，不再根据耗时或 `Age` 猜测。
- 带功能性查询参数、Cookie、Authorization 或 Range 的请求不进入 HTML 公共快照；常见 tracking 参数会归一化。

## 2026 年 EdgeOne 新功能

| 功能 | 上线时间 | 对本项目的影响 |
|------|---------|---------------|
| AI Bot Management（爬虫控制） | 2026.02 | 可在控制台免费开启，无需代码修改 |
| AI 爬虫画像库 | 2026.03 | 自动识别 AI 爬虫并限制频率，GUI 配置 |
| 永久免费套餐 | 2026.03 | 基础 Edge Function 配额永久免费 |
| KV 持久存储 | 2026.05 | v2.4 用于保存已重写 HTML 和最后成功版本 |
| Blob 对象存储 | 2026.06 | 可保存较大快照；大量公开静态资产仍建议使用 COS |

KV 命名空间需要在 EdgeOne Makers 控制台创建并绑定到项目，绑定变量名固定为 `EDGEFLOW_SNAPSHOT`。

## 版本历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初始版本 |
| v2.0 | 修复 Geo 路由、Health 端点、缓存地区分离 |
| v2.1 | 目录整合（`edgeone-optimized` 合并到 `edgeone`）、更新新功能文档 |
| v2.3 | 修复构建、显式 Cache API、最小健康检查、Link 头重写、缓存测试 |
| v2.3.1 | 修复 Makers 原生缓存 schema、过期元数据、缓存自愈与分阶段计时 |
| v2.4 | 增加 KV 持久 HTML 快照、stale-while-refresh、主动刷新端点和最后成功版本回退 |

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
9. 在项目 → KV 存储中创建/绑定命名空间，运行时变量名填写 `EDGEFLOW_SNAPSHOT`
10. 在环境变量中设置 `SNAPSHOT_REFRESH_SECRET`，供 SCF 或发布 webhook 调用刷新端点

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
{"ok":true,"runtime":"edgeone-pages","version":"2.4.0","originConfigured":true,"cacheApiAvailable":true,"snapshotStoreAvailable":true}
```

- 用美国代理访问 → 应 301 重定向到 `webflowcn.webflow.io`
- 直连访问（CN）→ 正常显示，资源走国内 CDN
- 连续访问同一公开页面 → 首次 `X-EdgeFlow-Snapshot: MISS`，后续为 `FRESH`
- 超过 `SNAPSHOT_TTL` → 仍立即返回 `STALE`，同时出现 `X-EdgeFlow-Refresh: BACKGROUND`
- 带 Cookie 或 Authorization 访问 → 必须为 `BYPASS`
- 查看 `Server-Timing` → 可分别检查 cache、origin、rewrite 与 total 耗时

## 环境变量

 | 变量名 | 必填 | 说明 |
 |--------|------|------|
 | `WEBFLOW_HOST` | 可选 | 你的 Webflow 项目地址（默认 `webflowcn.webflow.io`）|
 | `CACHE_TTL` | 可选 | HTML 显式缓存 TTL，默认 300 秒 |
 | `SNAPSHOT_TTL` | 可选 | KV HTML 快照新鲜期，默认 900 秒 |
 | `SNAPSHOT_PATHS` | 可选 | 主动刷新页面列表，英文逗号分隔，默认 `/` |
 | `SNAPSHOT_REFRESH_SECRET` | 可选 | 主动刷新端点密钥；必须放在控制台环境变量，不要提交到 Git |
 | `MIRROR_JQUERY` | 可选 | jQuery 国内镜像地址 |
| `MIRROR_JSD_MIRROR` | 可选 | jsDelivr 国内镜像 |
| `MIRROR_WEBFONT` | 可选 | WebFont loader 国内镜像 |
| `ASSET_PROXY_PREFIX` | 可选 | 资源代理路径前缀（默认 `/__eo_asset_v3__`） |

KV 本身不是普通环境变量。在 Makers 控制台把目标命名空间绑定为 `EDGEFLOW_SNAPSHOT` 后，函数会自动启用持久快照；未绑定时保持兼容降级。

主动刷新示例：

```bash
curl -X POST 'https://你的域名/__proxy/refresh' \
  -H 'Authorization: Bearer 你的环境密钥' \
  -H 'Content-Type: application/json' \
  --data '{"paths":["/","/about"]}'
```

## 注意事项

- 首次部署后，用海外代理访问确认是否触发了 301 重定向
- 如果 Geo 路由仍不工作，检查腾讯云 EdgeOne 控制台 → 「回源 HTTP 请求头」是否传递了 `EO-Client-IPCountry`
- 如需限制爬虫频率，优先使用 EdgeOne 控制台的 Bot Management 功能，不需要修改函数代码
- EdgeOne 免费配额和存储限制会调整，部署前以 Makers 官方 Limits and Quotas 页面为准
