# webflow-china-speed

**让 Webflow 网站在中国大陆正常访问并高速加载的 Agent Skill**

> ⚠️ **2025 年 11 月起**，Webflow 所有自定义域名在中国大陆被 GFW 封控。本 Skill 提供唯一有效的解决方案。

---

## 快速安装

```bash
npx skills add Webflowcn/webflow-china-speed
```

或在 Claude / Cursor / Copilot 等支持 skills 的 AI Agent 中使用：

```
安装：npx skills add Webflowcn/webflow-china-speed
使用：告诉 Agent "帮我优化 Webflow 网站在中国大陆的访问速度"
```

---

## 这个 Skill 能做什么

一套完整的 Cloudflare Worker 方案，解决 Webflow 网站在大陆访问的所有已知问题：

| 优化项 | 解决的问题 |
|--------|-----------|
| GFW 封控绕过 | Webflow 自定义域名 2025.11 起在大陆不可访问 |
| Google 资源清除 | Google Fonts、preconnect 标签导致页面卡顿 2-5s |
| jQuery CDN 替换 | CloudFront 无大陆节点，阻塞页面渲染 |
| R2 持久化缓存 | 静态资源永久缓存，二次访问极速 |
| CSS 内联 URL 改写 | 字体/图片绕过缓存直连 Fastly 海外节点 |
| 视频分段加载 | HTTP Range 支持，视频立即起播 |
| Webflow Badge 移除 | CSS + MutationObserver 双重方案 |
| CMS 图片加速 | 自动覆盖 CMS 集合图片，无需额外配置 |
| 301/302 重定向修正 | 防止语言路由跳转暴露 webflow.io 域名 |
| 多语言网站支持 | Location 头修正，分流架构指南 |

**共 12 项优化，一次部署全部生效。**

---

## 三条路线，按需选择

```
有 ICP 备案域名？
├── 否 → CF Worker + R2（免费，无需备案，香港节点 50-150ms）
├── 是，低流量 → VPS 反代 + DNS 分流（¥68/年，20-50ms）
└── 是，高并发 → EdgeOne 标准版 + 边缘函数（按量计费，5-20ms）
```

---

## 包含内容

- **`SKILL.md`** — 完整的 Agent 指令文档（12 项优化详解、决策树、诊断清单、常见坑）
- **`references/worker-template.js`** — 可直接部署的 Cloudflare Worker 模板代码

---

## 使用方法

安装 Skill 后，直接告诉你的 AI Agent：

- "帮我把 Webflow 网站优化到可以在中国大陆访问"
- "我的 Webflow 网站在国内打不开，帮我部署 CF Worker"
- "检查我的 Worker 代码有没有遗漏的优化"
- "我有 ICP 备案域名，帮我配置国内外分流"

Agent 会根据 SKILL.md 的指引，结合你的实际情况给出针对性方案。

---

## 技术背景

Webflow 于 2025 年 4 月将所有自定义域名迁移到 Cloudflare（`cdn.webflow.com`，IP `198.202.211.1`），GFW 随后对该 IP 段实施 SNI 封控。`*.webflow.io` staging 域名走不同 IP 段，目前仍可访问但不稳定，不能依赖作为生产方案。

本 Skill 经过真实项目验证（包含 CMS、背景视频、自定义字体、多语言等场景），所有优化项均有详细的问题根因和诊断方法说明。

---

## 适用场景

- Webflow 设计师 / 开发者服务国内客户
- 品牌官网、产品页、作品集需要国内访问
- 需要替代 Chinafy / 21YunBox 等昂贵第三方服务
- 多客户管理，统一架构

---

## 兼容平台

支持所有兼容 [skills.sh](https://skills.sh) 规范的 AI Agent，包括 Claude Code、Cursor、Copilot、Windsurf 等 40+ 平台。

---

## 许可证

MIT License — 自由使用、修改、分发。
