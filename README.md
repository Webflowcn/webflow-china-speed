# Webflow-China-Speedup

> Webflow 自定义域名在国内被 GFW 封控，打不开？两条路线，一份方案，5 分钟恢复访问。

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/shenyeah/webflow-china-speedup/tree/main/packages/cf-worker"><img src="https://deploy.workers.cloudflare.com/button" height="32" alt="Deploy to Cloudflare Workers"></a>
<a href="https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fshenyeah%2Fwebflow-china-speedup"><img src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg" height="32" alt="使用 EdgeOne Pages 部署"></a>

🌐 <a href="https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fshenyeah%2Fwebflow-china-speedup">EdgeOne International Deploy →</a>（For Non-Chinese citizen users）

***

## 这是什么？

2025 年 11 月起，Webflow 自定义域名的 CDN 出口 IP（`cdn.webflow.com`）被 GFW 封控。本方案通过反向代理 + 内容改写，让你的网站在国内可访问。

两条路线可选：

| | CF Worker + R2 | EdgeOne Pages |
|---|---|---|
| **ICP 备案** | ❌ 不需要 | ✅ 需要 |
| **国内延迟** | 取决于跨境出口 | 取决于备案、节点调度和缓存命中，部署后实测 |
| **费用** | 免费（10 万请求/天） | 免费起步（300 万/月） |
| **部署方式** | 点按钮，自动创建 | Git 导入 |

有备案 → EdgeOne（延迟最低）；无备案 → CF Worker（免费，够用）。

---

## 快速部署

### 路线 A：CF Worker（无需备案）

点击上方 **Deploy to Cloudflare Workers** → 自动创建 Worker + R2 → 绑定域名 → 完成。无需配置任何环境变量。

### 路线 B：EdgeOne Pages（需备案）

点击上方 **使用 EdgeOne Pages 部署** → 从 Git 导入 → Root Directory 选 `/`（默认值） → 创建 → 绑定域名 → 完成。

---

## 代理你自己的网站

部署完成后，在平台环境变量中添加：

| 变量 | 值 |
|---|---|
| `WEBFLOW_HOST` | `xxx.webflow.io`（你的 Webflow 项目地址） |

代码已内置 `webflowcn.webflow.io` 作为默认值，**零配置即可运行**。

---

## 能解决 / 不能解决

**能解决：**
- 自定义域名完全打不开 → 正常访问
- 可缓存资源加载慢 → 命中境内节点缓存后可改善；动态回源仍受源站影响
- Google Fonts / Analytics 自动清理，不阻塞页面

**不能解决：**
- 不能绕过 Webflow 付费计划（请至少购买一个 Site Plan）
- 不能加速第三方统计的数据上报（脚本加载可加速，上报仍可能被墙）

---

## 关于 Webflow 服务条款

本方案绕过的是 GFW 的地理限制，不是 Webflow 的收费机制。使用免费版（Starter Plan）+ 本方案发布到自定义域名可能违反 Webflow [服务条款](https://webflow.com/legal/terms)。建议购买至少一个付费 Site Plan。

[→ 架构与设计决策](docs/Architecture.md) · [→ API 参考](docs/API.md) · [→ AI 开发上下文](AGENTS.md) · [→ 许可证](LICENSE)

---

本仓库采用 **个人使用许可证**，仅供非商业性个人使用。详见 [LICENSE](LICENSE)。
商业使用需取得作者授权。
