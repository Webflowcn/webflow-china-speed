 # Current State

 **版本**: v2.2 已发布；v2.3 本地优化中
 **状态**: v2.3 已完成本地测试，尚未部署
 **最后更新**: 2026-08-23
 
 ## 已完成的里程碑
 
 - [x] v1.0: 基础反向代理（CF Worker）
 - [x] v2.0: 双路线架构（CF Worker + EdgeOne Pages）
 - [x] v2.1: 优化 - content-length 修复 / 24h 缓存 / Crawl-delay / EdgeOne 清理
 - [x] v2.1.1: 零配置部署 — 移除 wrangler.toml [vars] 占位符，代码 fallback 兜底；EdgeOne 已有代码层默认值
 - [x] v2.3（本地）: 构建修复、显式缓存、安全健康检查、Link 头重写与自动化测试
 
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
 - 当前 `tectura-cn.webflowcn.com` 线上仍是旧版本；v2.3 缓存效果必须部署到测试域名后复测
 - 2026-08-23 中国大陆同机直连冷加载中，旧版 EdgeOne 的 TTFB/LCP/Load 均慢于同项目 Staging
