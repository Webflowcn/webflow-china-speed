 # Design Decisions

 ## ADR-001: 两条独立部署路线

 **决策**: 同时维护 CF Worker + R2 和 EdgeOne Pages 两条路线，而非选择其一。

 **背景**: 用户群体分两档——有 ICP 备案的（可使用 EdgeOne 国内节点）和无 ICP 备案的（只能走海外节点）。

 **权衡**: 维护两套代码增加复杂度，但覆盖了所有用户的部署条件。

 **结果**: 两路线共享核心 URL 重写逻辑，只是部署平台和实现方式不同。

 ---

 ## ADR-002: 边缘函数内联打包（EdgeOne）

 **决策**: `build.mjs` 将 `proxy.js` 内联进入口文件，而非使用 npm 包管理。

 **背景**: EdgeOne Pages 的构建环境不支持 `npm install`，所有代码必须在一个文件或预构建产物中。

 **结果**: `build.mjs` 读取 `edge-functions/_shared/proxy.js`，将其内联到 `index.js` 和 `[[default]].js` 两个入口文件。构建产物输出到 `.edgeone/edge-functions/`。

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

## 常见问题

### 第三方统计/检测服务（如 Fathom、GA4）在大陆不工作怎么办？

这类服务通常分两步：① 从海外 CDN 加载 JS 脚本；② 浏览器将数据上报到海外服务器。代理只能解决第①步（让脚本加载更快），第②步的数据上报仍可能因网络问题失败。

**建议**：有 analytics 需求时，替换为国内可访问的服务（如百度统计、CNZZ），或自建开源方案（如 Plausible），确保脚本加载和数据上报都在国内网络下畅通。
