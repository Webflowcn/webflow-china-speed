> 优先用简体中文回答和命名对话。

# Webflow-China-Speedup

 > Webflow 网站在中国大陆的被 GFW 封控，无法访问。本仓库提供反向代理解决方案，两条路线可选，5 分钟恢复访问。

 **仓库**: `shenyeah/webflow-china-speedup`
 **最新 main 版本**: v2.4.0（当前工作树准备 v2.5.0 Blob 备用快照，尚未部署）
 **自动部署**: [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/shenyeah/webflow-china-speedup/tree/main/packages/cf-worker) [![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fshenyeah%2Fwebflow-china-speedup)

 ---

 ## 项目结构

 ```
 webflow-china-speedup/
 ├── AGENTS.md                   # AI 上下文（本文件）
 ├── README.md                   # 项目入口文档
 ├── CHANGELOG.md                # 版本日志
 ├── docs/                       # 架构/API/设计决策文档
 ├── memory/                     # 当前状态 & Roadmap
  │
 ├── packages/
 │   ├── cf-worker/              # [路线 A] CF Worker + R2
 │   │   ├── worker.js           # 核心代理逻辑（含 12 项优化）
 │   │   ├── wrangler.toml       # CF 部署配置
 │   │   ├── build.mjs           # 构建脚本（压缩 + 版本注入）
 │   │   ├── edgeflow.config.js  # 用户配置入口
  │   │
 │   └── edgeone/                # [路线 B] EdgeOne Pages
 │       ├── edgeone.json        # 缓存/响应头规则
 │       ├── build.mjs           # 边缘函数打包
 │       ├── edge-functions/     # 边缘函数源码
 │       │   ├── _shared/proxy.js  # 核心代理逻辑
 │       │   ├── index.js          # 入口
 │       │   └── [[default]].js    # 通配路由
  │
 ├── edgeone.json        → packages/edgeone/edgeone.json     #
 ├── edgeone.config.json → packages/edgeone/edgeone.config.json  # 软链接
 ├── build.mjs           → packages/edgeone/build.mjs       # （EdgeOne 部署用）
 ├── package.json        → packages/edgeone/package.json    #
 ├── package-lock.json   → packages/edgeone/package-lock.json #
 ├── edge-functions/     → packages/edgeone/edge-functions/ #
  ├── .edgeoneignore      → packages/edgeone/.edgeoneignore  #
 └── .env.example        → packages/edgeone/.env.example    #
 ```

 > 根目录的软链接使 EdgeOne Pages 部署时可将 Root Directory 设为 `/`，无需手动输入 `packages/edgeone/`。

 ---

 ## 两条部署路线

 | | CF Worker + R2 | EdgeOne Pages |
 | --- | --- | --- |
 | **适用场景** | 无 ICP 备案 | 有 ICP 备案 |
 | **国内延迟** | 50-150ms（HK/SG 节点） | 5-20ms（国内 2800+ 节点） |
 | **费用** | 免费（100k 请求/天） | 免费起步（300 万次/月） |
 | **部署方式** | 一键 Deploy 按钮 | Git 导入，Root Dir = `/` |
 | **HTML 改写** | HTMLRewriter（流式） | 边缘函数（全量替换） |
 | **静态缓存** | R2 永久缓存 | EdgeOne 节点缓存 |
 | **配置入口** | `edgeflow.config.js` | EdgeOne Console 环境变量 |
 | **核心代理** | `worker.js` | `edge-functions/_shared/proxy.js` |

 ---

 ## URL 重写规则

 两种代理核心逻辑相似，均包含以下 URL 重写：

 1. **Webflow 源站代理**: `https://{WEBFLOW_HOST}.webflow.io` → 改写 HTML 中的资源链接
 2. **Google 资源拦截**: 移除 preconnect/dns-prefetch/GTM/GA/Fonts
 3. **CSS @import 过滤**: 删除 Google Fonts 引用
 4. **jQuery 替换**: CloudFront → 国内 CDN（cdnjs）
 5. **视频 URL 重写**: data-video-urls 纳入缓存键
 6. **SRI 移除**: 防止 CSS 改写后 integrity 校验失败
 7. **301/302 修正**: Location 头重写，防止源站地址泄露
 8. **robots.txt Crawl-delay**: 降低爬虫频率，减少 Worker 调用

 ---

 ## 环境变量

所有环境变量均有默认值，部署后无需配置即可运行。

 ### 通用
 - `WEBFLOW_HOST`: 你的 Webflow 站点标识（如 `webflowcn`），默认值 `webflowcn.webflow.io`
 - `CACHE_TTL`: 边缘缓存 TTL（秒，默认 300）
 - `SNAPSHOT_BLOB_STORE`: KV 不可用时显式启用 Blob 备用 HTML 快照；默认关闭

 > 当前 EdgeOne 路线未实现 `ACCESS_KEY`。不要在文档或交付中声称已支持访问密钥。

 ---


 # CF Worker 本地开发
 cd packages/cf-worker
 node build.mjs                              # 构建
 wrangler deploy                              # 部署
 ```

 ## 设计决策

 - **两条路线共享核心代理逻辑**: CF Worker（`worker.js`）和 EdgeOne（`proxy.js`）的 URL 重写规则一致，只是部署平台不同
 - **R2 永久缓存**: 静态资源首次回源后永久存储在 R2，后续直接从 R2 读取
 - **EdgeOne 边缘函数打包**: `build.mjs` 使用 esbuild 将入口、`proxy.js` 和 Makers Blob SDK打成两个独立 ESM 单文件（`index.js` + `[[default]].js`）
 - **版本隔离**: 两路线独立版本控制，`package.json` 各自管理
- **零配置部署**: 两路线均内置默认值 `webflowcn.webflow.io`，点 badge 部署后即可绑定域名使用

 ## 谁在维护

 - **维护者**: shenyeah
 - **频道**: [@buildwebflow](https://t.me/buildwebflow)
