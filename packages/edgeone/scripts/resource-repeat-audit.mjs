import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const urls = args.filter((arg) => !arg.startsWith("--"));
const runs = parseIntegerArg(args, "--runs=", 5, 1, 20);

if (!urls.length) {
  console.error("Usage: node scripts/resource-repeat-audit.mjs <url> [url...] [--runs=5]");
  process.exitCode = 1;
} else {
  const resources = [];
  for (const url of urls) {
    const attempts = [];
    for (let run = 1; run <= runs; run += 1) {
      const startedAt = performance.now();
      try {
        const response = await fetch(url, {
          redirect: "manual",
          headers: {
            accept: "*/*",
            "user-agent": "EdgeFlowResourceAudit/2.6"
          }
        });
        await response.arrayBuffer();
        attempts.push({
          run,
          ok: response.ok,
          status: response.status,
          totalMs: round(performance.now() - startedAt),
          cache: response.headers.get("x-edgeflow-cache") || "",
          reason: response.headers.get("x-edgeflow-cache-reason") || "",
          store: response.headers.get("x-edgeflow-cache-store") || "",
          cacheClass: response.headers.get("x-edgeflow-cache-class") || "",
          contentClass: response.headers.get("x-edgeflow-content-class") || "",
          snapshot: response.headers.get("x-edgeflow-snapshot") || "",
          age: response.headers.get("age") || "",
          serverTiming: response.headers.get("server-timing") || ""
        });
      } catch (error) {
        attempts.push({
          run,
          ok: false,
          status: 0,
          totalMs: round(performance.now() - startedAt),
          error: error?.message || "request-failed"
        });
      }
    }
    resources.push({ url, attempts });
  }
  console.log(JSON.stringify({ anonymous: true, cacheControlOverride: false, runs, resources }, null, 2));
}

function parseIntegerArg(values, prefix, fallback, min, max) {
  const raw = values.find((value) => value.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.slice(prefix.length), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
