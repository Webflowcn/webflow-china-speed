 # Design Decisions

 ## ADR-001: 两条独立部署路线

 **决策**: 同时维护 CF Worker + R2 和 EdgeOne Pages 两条路线，而非选择其一。

 **背景**: 用户群体分两档——有 ICP 备案的（可使用 EdgeOne 国内节点）和无 ICP 备案的（只能走海外节点）。

 **权衡**: 维护两套代码增加复杂度，但覆盖了所有用户的部署条件。

 **结果**: 两路线共享核心 URL 重写逻辑，只是部署平台和实现方式不同。

 ---

 ## ADR-002: 边缘函数依赖打包（EdgeOne）

 **决策**: `build.mjs` 使用 esbuild 将入口、`proxy.js` 和运行时依赖打成单文件 ESM。

 **背景**: EdgeOne CLI 直传需要可独立运行的单文件产物；v2.5 又需要引入官方 `@edgeone/pages-blob` SDK，字符串拼接无法正确处理 CommonJS 包和部署凭证占位符。

 **结果**: `build.mjs` 分别从 `index.js` 和 `[[default]].js` 构建，完整打包到 `.edgeone/edge-functions/`。产物不保留外部 npm import，并保留 Makers 部署阶段识别的 Blob 凭证占位符。

 ---

 ## ADR-003: 根目录软链接简化部署

 **决策**: 使用 Git 跟踪的软链接将 `packages/edgeone/` 的部署文件暴露到根目录。

 **背景**: EdgeOne Pages 的 Git 导入流程要求用户手动指定 Root Directory，每次部署都要输入 `packages/edgeone/`，容易出错且体验差。

 **备选方案**: 拆分独立仓库 / 使用 Git Submodule / 修改 CI 流程。

 **结果**: 软链接方案侵入最小，Git 在 Linux/macOS 上能正确还原，EdgeOne Pages 构建环境（Linux）也能解析。用户现在可以将 Root Directory 设为 `/`。

 ---

 ## ADR-004: R2 永久缓存（CF Worker）

 **决策**: 静态资源首次代理后永久存储在 R2 Bucket。

 **背景**: Webflow 的静态资源（CSS/JS/图片）极少变化，但每次回源都消耗 Worker 调用配额（100k/天）。

 **结果**: 首次访问后资源存储在 R2，后续请求直接从 R2 读取，大幅减少 Worker 调用。配以边缘 `cacheTtl: 86400`，边缘节点命中时完全绕过 Worker。

 ---

 ## ADR-005: EdgeOne HTML 使用 Makers KV 持久快照

 **决策**: EdgeOne Makers 路线使用 KV 保存已重写 HTML，静态资源继续使用节点 Cache API；大规模公开资源后续迁移 COS。

 **背景**: 线上实测连续请求仍然全部 MISS，实时回源和 HTML 全量重写合计可增加数百毫秒到一秒以上。Makers 已提供 KV 和 Blob，旧的“没有持久存储”判断不再成立。

 **结果**: 匿名中国大陆 HTML 请求优先读取 `EDGEFLOW_SNAPSHOT`。快照过期仍立即返回旧版本，并在后台更新；更新失败保留最后成功版本。Cookie、Authorization、Range、功能性查询、非 200、Set-Cookie 和 Geo 301 均绕过。`caches.default` 保留为 KV 不可用时的兼容层和静态资源缓存。

 ---

 ## ADR-006: HTML 改写策略差异

 **决策**: CF Worker 使用 `HTMLRewriter`（流式），EdgeOne 使用 `String.replaceAll()`（全量替换）。

 **背景**: Cloudflare Workers 提供 `HTMLRewriter` API，可以在流式传输 HTML 时实时改写，无需等待完整响应。EdgeOne Edge Functions 不提供等效 API。

 **结果**: CF Worker 的流式改写延迟更低、内存占用更少。EdgeOne 的全量替换实现更简单，且对 EdgeOne 的国内节点来说延迟差异可忽略。

 ---

 ## ADR-007: Blob 只作为显式备用快照后端

 **决策**: 只有设置 `SNAPSHOT_BLOB_STORE` 时才启用 Makers Blob；KV 与 Blob 同时存在时只使用 KV。

 **背景**: KV 需要申请审核，而正式部署中的 `caches.default` 线上连续请求仍全部 MISS。Blob 可由官方 SDK自动创建 Store，并通过边缘节点加速读取，但需要部署阶段凭证注入。

**结果**: 持久后端顺序固定为 KV → Blob → Cache API → 实时回源。Blob 对象放在 `snapshots/` 前缀下；不默认创建、不双写，也不把 Blob 用作公网 CDN。

**运行时验证**: 独立预览项目首次 HTML 请求已观测到 `MISS + blob`，随后请求为 `HIT + FRESH + blob`。为避免预览门禁本身导致误判，只将 EdgeOne 的 `eo_token` / `eo_time` 视为平台门禁并在回源前剥离；任何其他 Cookie 仍绕过缓存。Blob 解决了 HTML 的跨请求持久命中，但静态资源仍依赖 Cache API，冷浏览器复测持续 MISS，因此不能把 Blob 成功解释为整页所有资源均已加速。

---

## ADR-008: Makers 负责改写，Site Acceleration 负责静态边缘缓存

**决策**: v2.6 将 Makers Blob 继续限制为 HTML 快照；`caches.default` 只作可诊断的节点级临时缓存。跨节点静态资源缓存交给独立的 EdgeOne Site Acceleration 测试域名验证。

**背景**: Makers 真实运行时中，同一指纹字体连续请求仍全部 MISS。Cache API 只对当前数据节点有效，不能作为全局持久缓存承诺；Blob 官方也不建议作为公网图片/CDN。

**结果**: 增加 `PUBLIC_HOST` 以支持 CDN 回源域名与外部域名分离；减少 `Accept/Vary` 变体；输出 Cache API 写入和内容分类诊断；通过受鉴权 Sitemap 预热接口准备 HTML，静态字体、图片、CSS、JS 则由 Site Acceleration 规则和预热功能承担。

**实测套餐边界**: 现有套餐允许 30 天静态节点缓存、缓存预刷新、Brotli/Gzip、HTTP/2 和免费证书，但拒绝 QUIC/HTTP/3 与自定义 Cache Key。按“不购买/不升级”约束保留 HTTP/2；追踪参数仅在 Makers 内层归一化，EdgeOne 外层可能产生重复 HTML 缓存对象。


---

## 常见问题

### 第三方统计/检测服务（如 Fathom、GA4）在大陆不工作怎么办？

这类服务通常分两步：① 从海外 CDN 加载 JS 脚本；② 浏览器将数据上报到海外服务器。代理只能解决第①步（让脚本加载更快），第②步的数据上报仍可能因网络问题失败。

**建议**：有 analytics 需求时，替换为国内可访问的服务（如百度统计、CNZZ），或自建开源方案（如 Plausible），确保脚本加载和数据上报都在国内网络下畅通。
