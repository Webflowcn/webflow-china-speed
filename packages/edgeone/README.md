# Webflow China Speedup — EdgeOne Makers

> EdgeOne 部署路径。与 `packages/cf-worker/`（Cloudflare Worker 路径）并列，用户可按需选择。
>
> 本路径利用 EdgeOne 国内节点、Edge Functions 和显式 Cache API。是否比 Webflow 直连更快，取决于备案、节点调度、缓存命中和源站状态，部署后必须实测。

## 为什么选择 EdgeOne 路径？

| 特性 | EdgeOne | Cloudflare Worker |
|------|---------|-------------------|
| 国内节点 | ✅ 3200+ 边缘节点（全国覆盖） | ❌ 无国内节点 |
| 免费额度 | 以 Makers 当前配额页为准（当前 Edge Function 300 万次/月） | 10 万请求/天（Worker） |
| 缓存 | Makers KV / 可选 Blob 持久 HTML 快照 + 节点 Cache API | R2 持久存储 + 边缘缓存 |
| 爬虫控制 | ✅ 免费 AI Bot Management（2026.02 上线） | ❌ 需要额外规则 |
| 部署复杂度 | 腾讯云国内账号 | Cloudflare 全球账号 |

## 缓存架构

v2.6 优先从 Makers KV 读取已经完成改写的 HTML 快照。KV 未绑定且显式配置 `SNAPSHOT_BLOB_STORE` 时，改用 Blob 作为备用持久快照；两者同时存在时 KV 永远优先。快照新鲜时直接返回；过期时先返回旧快照，再通过 `context.waitUntil()` 后台刷新。两种持久存储都不可用时安全降级到 Cache API 和实时回源。

| 层级 | 组件 | TTL | 说明 |
|------|------|-----|------|
| L1a | Makers KV `EDGEFLOW_SNAPSHOT` | HTML 默认 15 分钟后后台刷新 | 首选持久快照后端；需要审核、创建并绑定命名空间 |
| L1b | Makers Blob `SNAPSHOT_BLOB_STORE` | HTML 默认 15 分钟后后台刷新 | 可选备用后端；首次调用自动创建 Store，使用边缘加速读取 |
| L2 | `caches.default` | HTML 默认 5 分钟；指纹资源 30 天 | Edge Function 节点缓存，可能提前淘汰 |
| L3 | EdgeOne 平台缓存规则 | 见 `edgeone.json` | 代理静态资源的原生缓存补充 |
| L4 | Webflow 源站 | — | 所有缓存未命中或后台刷新时才回源 |

- 仅中国大陆地区的 `GET`/`HEAD` 参与显式缓存查找。
- HTML 持久快照默认 15 分钟后转为 STALE；用户仍立即得到旧快照，刷新在后台进行。
- 带内容指纹的静态资源缓存 30 天；其他静态资源 1 天。
- 带 `Cookie`、`Authorization`、`Range`、`no-cache/no-store` 的请求直接绕过。
- 非 200、`Set-Cookie`、私有或 `no-store` 响应不写缓存；Geo 301 永不缓存。
- 用 `X-EdgeFlow-Snapshot: FRESH|STALE|MISS` 判断持久快照状态。
- 用 `X-EdgeFlow-Snapshot-Store: kv|blob` 确认实际使用的持久后端。
- 用 `X-EdgeFlow-Cache: HIT|MISS|BYPASS` 判断整体缓存结果，不再根据耗时或 `Age` 猜测。
- 用 `X-EdgeFlow-Cache-Store: STORE_OK|STORE_FAILED` 判断本次节点 Cache API 写入是否成功；该缓存仍只作为非关键临时层。
- 用 `X-EdgeFlow-Cache-Class` 和 `X-EdgeFlow-Content-Class` 区分 HTML、字体、图片、CSS、JS 等资源。
- 带功能性查询参数、Cookie、Authorization 或 Range 的请求不进入 HTML 公共快照；常见 tracking 参数会归一化。

## 2026 年 EdgeOne 新功能

| 功能 | 上线时间 | 对本项目的影响 |
|------|---------|---------------|
| AI Bot Management（爬虫控制） | 2026.02 | 可在控制台免费开启，无需代码修改 |
| AI 爬虫画像库 | 2026.03 | 自动识别 AI 爬虫并限制频率，GUI 配置 |
| 永久免费套餐 | 2026.03 | 基础 Edge Function 配额永久免费 |
| KV 持久存储 | 2026.05 | v2.4 用于保存已重写 HTML 和最后成功版本 |
| Blob 对象存储 | 2026.06 | 可作为无需 KV 绑定的备用快照后端；需引入官方 SDK，且不建议当公网 CDN 使用 |

KV 命名空间需要在 EdgeOne Makers 控制台创建并绑定到项目，绑定变量名固定为 `EDGEFLOW_SNAPSHOT`。Blob 不需要控制台绑定；设置 `SNAPSHOT_BLOB_STORE` 后，首次实际读写会自动创建同名 Store。Blob 默认关闭，不能填写与现有 KV 变量相同的值来代替绑定。

## 版本历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初始版本 |
| v2.0 | 修复 Geo 路由、Health 端点、缓存地区分离 |
| v2.1 | 目录整合（`edgeone-optimized` 合并到 `edgeone`）、更新新功能文档 |
| v2.3 | 修复构建、显式 Cache API、最小健康检查、Link 头重写、缓存测试 |
| v2.3.1 | 修复 Makers 原生缓存 schema、过期元数据、缓存自愈与分阶段计时 |
| v2.4 | 增加 KV 持久 HTML 快照、stale-while-refresh、主动刷新端点和最后成功版本回退 |
| v2.5 | 增加可选 Blob 备用快照、KV 优先级、依赖打包和存储后端诊断头 |
| v2.6 | 增加 `PUBLIC_HOST`、Cache API 写入诊断、资源分类、Sitemap 批量预热，并移除无意义的 `Accept/Vary` 变体 |

## v2.0 修复内容

| # | 问题 | 修复方式 |
|---|------|---------|
| 1 | Geo 路由不生效 | 改用 `getClientCountry()` 多 header fallback，不再只依赖 `EO-Client-IPCountry` |
| 2 | Health 端点 500 | 不用 `Response.json()`，改用 `new Response(JSON.stringify())` |
| 3 | 缓存不分地区 | 仅 CN 请求进入共享缓存；Geo 301 为 `no-store`。v2.6 移除不改变内容却会制造重复版本的 `Accept/Vary` |
| 4 | stale 过期太长 | 从 604800(7天) 降至 3600(1小时) |

## 部署步骤

### 方式一：通过 EdgeOne Pages 控制台（推荐）

 1. 执行 `npm install && npm run build` 生成 `.edgeone/` 目录
 2. 将整个仓库提交到 Git（根目录含部署所需的软链接）
 3. 打开 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → Pages → 新建项目
 4. 选择「从 Git 导入」，Root directory 选择根目录 `/`（默认值，无需修改）
 5. 构建配置留空，直接创建
 6. 绑定自定义域名 → 代理立即生效（默认 `webflowcn.webflow.io` 演示站点）
 7. 要代理你自己的网站，在控制台 → 环境变量添加 `WEBFLOW_HOST` = 你的 `xxx.webflow.io`，然后重新部署
8. （可选）在控制台开启 AI Bot Management 限制爬虫频率
9. 在项目 → KV 存储中创建/绑定命名空间，运行时变量名填写 `EDGEFLOW_SNAPSHOT`
10. 在环境变量中设置 `SNAPSHOT_REFRESH_SECRET`，供 SCF 或发布 webhook 调用刷新端点
11. 若 KV 尚未获批，可改为设置 `SNAPSHOT_BLOB_STORE=edgeflow-snapshots`；KV 绑定成功后会自动恢复为 KV 优先

 ### 方式二：直接上传文件夹
 
 1. 执行 `npm install && npm run build`
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

`audit:live` 默认连续运行 3 次。每次运行前都会清空临时匿名浏览器的 Cookie 和本地缓存，但不会发送 `Cache-Control: no-cache`，因此仍可观察 EdgeOne 服务端缓存是否命中。输出会记录主文档及代理资源的 `X-EdgeFlow-Cache`、`X-EdgeFlow-Snapshot` 和 `Server-Timing`。

受 EdgeOne 访问门禁保护的预览项目可通过 `EDGEFLOW_AUDIT_COOKIES_JSON` 向临时浏览器注入门禁 Cookie；审计输出只列出 Cookie 名称。代理仅忽略并剥离平台的 `eo_token` / `eo_time`，其他会话 Cookie 仍按敏感请求 BYPASS。此模式用于验证运行时，不等同于公开自定义域名的完全匿名性能。

```bash
# 绕过系统代理/VPN，使用本机直连出口
npm run audit:live -- https://你的域名 --direct

# 指定代理出口
npm run audit:live -- https://你的域名 --proxy-server=http://127.0.0.1:7893

# 专门模拟浏览器硬刷新；请求会携带 no-cache，按设计应显示 BYPASS
npm run audit:live -- https://你的域名 --disable-browser-cache
```

不要把“禁用浏览器缓存”和“清空浏览器缓存”混为同一测试：前者会主动要求服务端绕过缓存，不能用于判断普通匿名新用户是否命中边缘缓存。

部署后访问 `https://你的域名/__proxy/health`，应看到：

```json
{"ok":true,"runtime":"edgeone-pages","version":"2.6.0","originConfigured":true,"publicHostConfigured":true,"cacheApiAvailable":true,"snapshotStoreAvailable":true,"snapshotStoreType":"blob"}
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
 | `PUBLIC_HOST` | 可选 | Site Acceleration 对外域名；HTML、Canonical、资源链接和跳转统一改写到该域名 |
 | `CACHE_TTL` | 可选 | HTML 显式缓存 TTL，默认 300 秒 |
 | `SNAPSHOT_TTL` | 可选 | KV/Blob HTML 快照新鲜期，默认 900 秒 |
 | `SNAPSHOT_BLOB_STORE` | 可选 | KV 不可用时启用 Blob 备用快照；建议值 `edgeflow-snapshots`，未设置则关闭 |
 | `SNAPSHOT_PATHS` | 可选 | Sitemap 不可用时的主动刷新备用页面列表，默认 `/` |
 | `SNAPSHOT_REFRESH_SECRET` | 可选 | 主动刷新端点密钥；必须放在控制台环境变量，不要提交到 Git |
 | `MIRROR_JQUERY` | 可选 | jQuery 国内镜像地址 |
| `MIRROR_JSD_MIRROR` | 可选 | jsDelivr 国内镜像 |
| `MIRROR_WEBFONT` | 可选 | WebFont loader 国内镜像 |
| `ASSET_PROXY_PREFIX` | 可选 | 资源代理路径前缀（默认 `/__eo_asset_v3__`） |

KV 本身不是普通环境变量。在 Makers 控制台把目标命名空间绑定为 `EDGEFLOW_SNAPSHOT` 后，函数会自动启用 KV 持久快照。Blob 则通过普通环境变量 `SNAPSHOT_BLOB_STORE` 显式开启；Store 由官方 SDK首次调用时自动创建。两者同时存在时使用 KV，避免迁移期间双写或出现两套快照来源。

主动刷新默认读取源站 Sitemap，最多预热 20 个 HTML 页面：

```bash
curl -X POST 'https://你的域名/__proxy/refresh' \
  -H 'Authorization: Bearer 你的环境密钥' \
  -H 'Content-Type: application/json' \
  --data '{"limit":20}'
```

也可以显式提交 `{"paths":["/","/about"]}`。同一静态资源连续请求 5 次且不主动发送 `no-cache`：

```bash
npm run audit:resource -- 'https://你的域名/__eo_asset_v3__/...woff2' --runs=5
```

腾讯云 v2.6 三线路测试的域名、Site Acceleration 规则、套餐限制和验收步骤见 [`docs/TENCENT_ACCELERATION_V26.md`](../../docs/TENCENT_ACCELERATION_V26.md)。`config/edgeone-site-acceleration-*.json` 是实际下发规则的可审计副本；规则只匹配测试域名，不能直接改成生产域名后盲目执行。

## 注意事项

- 首次部署后，用海外代理访问确认是否触发了 301 重定向
- 如果 Geo 路由仍不工作，检查腾讯云 EdgeOne 控制台 → 「回源 HTTP 请求头」是否传递了 `EO-Client-IPCountry`
- 如需限制爬虫频率，优先使用 EdgeOne 控制台的 Bot Management 功能，不需要修改函数代码
- EdgeOne 免费配额和存储限制会调整，部署前以 Makers 官方 Limits and Quotas 页面为准
