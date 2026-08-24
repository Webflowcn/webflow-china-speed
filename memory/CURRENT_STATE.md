 # Current State

 **版本**: main 为 v2.4.0（提交 `00f9cd2`）；工作树为 v2.5.0 候选版
 **状态**: v2.5 Blob 备用快照已在独立预览项目完成真实运行时验证，28 项测试通过；正式项目仍运行 v2.3.1，KV 等待审核
 **最后更新**: 2026-08-24
 
 ## 已完成的里程碑
 
 - [x] v1.0: 基础反向代理（CF Worker）
 - [x] v2.0: 双路线架构（CF Worker + EdgeOne Pages）
 - [x] v2.1: 优化 - content-length 修复 / 24h 缓存 / Crawl-delay / EdgeOne 清理
 - [x] v2.1.1: 零配置部署 — 移除 wrangler.toml [vars] 占位符，代码 fallback 兜底；EdgeOne 已有代码层默认值
 - [x] v2.3（本地）: 构建修复、显式缓存、安全健康检查、Link 头重写与自动化测试
 - [x] v2.3.1: Makers 原生缓存 schema、过期元数据、自愈与 `Server-Timing`
 - [x] v2.4: KV HTML 持久快照、后台刷新、最后成功版本回退和主动刷新端点
 - [x] v2.5（候选）: 可选 Blob 备用快照、KV 优先级、esbuild 依赖打包、门禁 Cookie 隔离和后端诊断头
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
 - v2.5 已在独立项目 `tectura-cn-v24-preview` 的 Production 部署 `dpoo6d8pzd4f` 验证：首次 HTML 为 `MISS + blob`，随后为 `HIT + FRESH + blob`
 - 该预览项目 `IsTld=0` 且未绑定自定义域名，必须使用 EdgeOne 访问门禁；测试工具仅注入 `eo_token` / `eo_time`，不能把此口径冒充公开域名的完全匿名测试
 - 冷浏览器三轮（每轮清 Cookie/本地缓存、不发送 `no-cache`）HTML TTFB 约 169–335ms，均命中 Blob；但 14 个代理静态资源每轮仍全部 MISS，当前主要瓶颈已转为字体、图片、Webflow JS/CSS 的持久边缘缓存
 - 对同一指纹字体连续直连 5 次仍全部 `MISS / fingerprinted-static`，每次回源约 482–782ms；已排除浏览器并发、URL 差异和清缓存方式造成的假象
 - 同轮页面 load 约 1.60–2.96 秒，FCP/LCP 波动较大；`api.feedspring.co` 仍返回 403
 - 2026-08-24 中国大陆直连、临时匿名浏览器、每轮清空 Cookie/本地缓存的测试中，首页连续 3 次全部为 `MISS`，TTFB 约 0.79–1.06 秒
 - 同轮资源审计中，EdgeFlow 处理的 14–15 个 HTML/指纹资源也全部为 `MISS`，说明当前正式部署的 `caches.default` 没有形成可复用缓存
 - `api.feedspring.co` 在每轮浏览器测试中返回 403，属于源站第三方组件兼容问题，需要与缓存问题分开处理
