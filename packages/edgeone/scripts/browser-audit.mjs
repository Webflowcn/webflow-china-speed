import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function main() {
  const args = process.argv.slice(2);
  const targetUrl = args.find((arg) => !arg.startsWith("--"));
  const proxyArg = args.find((arg) => arg.startsWith("--proxy-server="));
  const chromeBin = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  if (!targetUrl) {
    console.error("Usage: node scripts/browser-audit.mjs <url> [--proxy-server=http://127.0.0.1:7893]");
    process.exitCode = 1;
    return;
  }

  const profileDir = await mkdtemp(join(tmpdir(), "edgeflow-browser-audit-"));
  const chromeArgs = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  ...(proxyArg ? [proxyArg] : []),
  "about:blank"
];

  const chrome = spawn(chromeBin, chromeArgs, { stdio: "ignore" });

  try {
  const port = await readDebugPort(profileDir);
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome did not expose a page target");

  const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
  const responses = [];
  const failures = [];

  cdp.on("Network.responseReceived", ({ response, type }) => {
    responses.push({
      type,
      url: response.url,
      status: response.status,
      mimeType: response.mimeType,
      protocol: response.protocol,
      fromDiskCache: response.fromDiskCache,
      fromServiceWorker: response.fromServiceWorker
    });
  });
  cdp.on("Network.loadingFailed", (event) => {
    failures.push({
      errorText: event.errorText,
      blockedReason: event.blockedReason || "",
      canceled: Boolean(event.canceled)
    });
  });

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      globalThis.__edgeflowVitals = { lcp: 0, cls: 0 };
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) globalThis.__edgeflowVitals.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) globalThis.__edgeflowVitals.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    `
  });

  const loaded = cdp.waitFor("Page.loadEventFired", 30000);
  const navigation = await cdp.send("Page.navigate", { url: targetUrl });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await loaded;
  await delay(1500);

  const evaluation = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
      return {
        url: location.href,
        title: document.title,
        navigation: nav ? {
          dns: nav.domainLookupEnd - nav.domainLookupStart,
          connect: nav.connectEnd - nav.connectStart,
          tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
          ttfb: nav.responseStart - nav.requestStart,
          response: nav.responseEnd - nav.responseStart,
          domContentLoaded: nav.domContentLoadedEventEnd,
          load: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize
        } : null,
        paints,
        vitals: globalThis.__edgeflowVitals,
        resourceCount: performance.getEntriesByType("resource").length,
        slowestResources: performance.getEntriesByType("resource")
          .map((entry) => ({
            url: entry.name,
            initiatorType: entry.initiatorType,
            duration: entry.duration,
            transferSize: entry.transferSize,
            protocol: entry.nextHopProtocol
          }))
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 10)
      };
    })()`
  });

  const result = evaluation.result.value;
  result.network = {
    responseCount: responses.length,
    failures,
    badStatuses: responses.filter((item) => item.status >= 400),
    hosts: [...new Set(responses.map((item) => new URL(item.url).host))].sort()
  };
  console.log(JSON.stringify(result, null, 2));
  await cdp.close();
  } finally {
    if (!chrome.killed) chrome.kill("SIGTERM");
    await rm(profileDir, { recursive: true, force: true });
  }
}

async function readDebugPort(directory) {
  const file = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(file, "utf8")).trim().split("\n");
      return Number(port);
    } catch (_error) {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Chrome DevToolsActivePort");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CDP endpoint returned ${response.status}`);
  return response.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timeout);
        const listeners = this.listeners.get(method) || [];
        this.listeners.set(method, listeners.filter((item) => item !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  async close() {
    this.socket.close();
  }
}

await main();
