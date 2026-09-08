 # Current State

 **版本**: main 为 v2.6.0（2026-09-08 发布；来自 `feat/v2.6-tencent-acceleration` 的 `3324b71`，另补发布文档）
 **状态**: v2.5/v2.6 代码已进入 main；39 项本地测试与构建通过。下方部署和网络性能记录为 2026-08-24 历史快照，本次未重新确认客户正式域名版本或 KV 审核状态。
 **最后更新**: 2026-09-08
 
 ## 已完成的里程碑
 
 - [x] v1.0: 基础反向代理（CF Worker）
 - [x] v2.0: 双路线架构（CF Worker + EdgeOne Pages）
 - [x] v2.1: 优化 - content-length 修复 / 24h 缓存 / Crawl-delay / EdgeOne 清理
 - [x] v2.1.1: 零配置部署 — 移除 wrangler.toml [vars] 占位符，代码 fallback 兜底；EdgeOne 已有代码层默认值
 - [x] v2.3（本地）: 构建修复、显式缓存、安全健康检查、Link 头重写与自动化测试
 - [x] v2.3.1: Makers 原生缓存 schema、过期元数据、自愈与 `Server-Timing`
 - [x] v2.4: KV HTML 持久快照、后台刷新、最后成功版本回退和主动刷新端点
 - [x] v2.5（已纳入 main）: 可选 Blob 备用快照、KV 优先级、esbuild 依赖打包、门禁 Cookie 隔离和后端诊断头
 - [x] v2.6（已纳入 main）: `PUBLIC_HOST`、Cache API 写入结果、资源分类、Sitemap 批量预热和静态资源重复审计
 - [x] v2.6 腾讯云测试架构: custom/staging/EO 三条隔离线路、DNSPod CNAME、免费证书和可审计缓存规则；EO 安全复用 staging Makers 回源
 - [x] 匿名浏览器审计: 多轮清空 Cookie/本地缓存，并分别支持直连、指定代理和硬刷新口径
 
 ## 当前覆盖的优化项
 
 | # | 优化 | 状态 |
 |---|------|------|
 | 1 | HTML 缓存头 | ✅ |
 | 2 | Google 资源清理 | ✅ |
 | 3 | CSS @import 过滤 | ✅ |
 | 4 | R2 query string 缓存键 | ✅ |
 | 5 | jQuery 镜像替换 | ✅ |
 | 6 | 视频 URL 重写 | ✅ |
 | 7 | HTTP Range 支持 | ✅ |
 | 8 | CSS 内部 URL 改写 | ✅ |
 | 9 | SRI integrity 移除 | ✅ |
 | 10 | 视频 poster 补全 | ✅ |
 | 11 | 301/302 拦截 | ✅ |

 ## 已知问题
 
 - EdgeOne 边缘函数使用字符串全量改写 HTML，对大型页面内存占用较高
 - 当前 `tectura-cn.webflowcn.com` 线上仍为 v2.3.1；v2.4 只在独立预览项目运行，KV 尚未绑定
 - v2.6 冷回源抽样中 Webflow staging 源站约 1.276 秒，正式自定义源站约 3.677 秒；热 Blob HTML 中位数仍约 0.40–0.46 秒，尚未达到 300ms 验收线
 - 现有 Site Acceleration 套餐拒绝 QUIC/HTTP/3 与自定义 Cache Key；已保留 HTTP/2，不升级套餐。静态边缘缓存规则可用，追踪参数在 EO 外层可能产生重复缓存对象
 - 2026-08-24 每轮新建匿名 Chrome 的 5 次本机中国大陆直连对比：正式基准 TTFB/FCP/LCP/load 中位数为 1072.5/3148/3820/6069.7ms；EO 为 22.1/208/208/802.2ms，分别改善 97.9%/93.4%/94.6%/86.8%
 - EO 抽样 CSS/JS/TTF/JPG 第二轮后 `Age > 0`，4 类资源边缘命中率 100%，重复耗时 19-59ms；内层 `X-EdgeFlow-Cache: MISS` 是被外层缓存保留的首次回源诊断头
 - 当前套餐默认预热接口对单 URL 也返回 `LimitExceeded.BatchQuota`，未升级；已用普通访问暖起 4 个 Sitemap HTML 路径及首屏抽样资源
 - 北京/上海/广州/成都同探针复测：EO 首次冷节点 TTFB 1977-2287ms，未优于正式基准 1854-2275ms；第二次 EO 为 13-30ms（中位数 19.5ms），正式基准仍为 888-2062ms（中位数 1664.5ms）。EO 的收益依赖边缘已有对象，冷 POP 首次回源仍是剩余短板
 - v2.5 已在独立项目 `tectura-cn-v24-preview` 的 Production 部署 `dpoo6d8pzd4f` 验证：首次 HTML 为 `MISS + blob`，随后为 `HIT + FRESH + blob`
 - 该预览项目 `IsTld=0` 且未绑定自定义域名，必须使用 EdgeOne 访问门禁；测试工具仅注入 `eo_token` / `eo_time`，不能把此口径冒充公开域名的完全匿名测试
 - 冷浏览器三轮（每轮清 Cookie/本地缓存、不发送 `no-cache`）HTML TTFB 约 169–335ms，均命中 Blob；但 14 个代理静态资源每轮仍全部 MISS，当前主要瓶颈已转为字体、图片、Webflow JS/CSS 的持久边缘缓存
 - 对同一指纹字体连续直连 5 次仍全部 `MISS / fingerprinted-static`，每次回源约 482–782ms；已排除浏览器并发、URL 差异和清缓存方式造成的假象
 - 同轮页面 load 约 1.60–2.96 秒，FCP/LCP 波动较大；`api.feedspring.co` 仍返回 403
 - 2026-08-24 中国大陆直连、临时匿名浏览器、每轮清空 Cookie/本地缓存的测试中，首页连续 3 次全部为 `MISS`，TTFB 约 0.79–1.06 秒
 - 同轮资源审计中，EdgeFlow 处理的 14–15 个 HTML/指纹资源也全部为 `MISS`，说明当前正式部署的 `caches.default` 没有形成可复用缓存
 - `api.feedspring.co` 在每轮浏览器测试中返回 403，属于源站第三方组件兼容问题，需要与缓存问题分开处理
