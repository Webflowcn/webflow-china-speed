import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

test("build emits standalone, syntax-valid handlers with full context", () => {
  const options = { cwd: packageDirectory, stdio: "pipe" };
  execFileSync(process.execPath, ["build.mjs"], options);
  execFileSync(process.execPath, ["--check", "scripts/browser-audit.mjs"], options);

  for (const file of [
    ".edgeone/edge-functions/index.js",
    ".edgeone/edge-functions/[[default]].js"
  ]) {
    execFileSync(process.execPath, ["--check", file], options);
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /import\s+\{\s*handleProxyRequest\s*\}/);
    assert.doesNotMatch(source, /from\s+["']@edgeone\/pages-blob["']/);
    assert.match(source, /handleProxyRequest\(context\.request, context\.env \|\| \{\}, context\)/);
    assert.equal((source.match(/async function handleProxyRequest/g) || []).length, 1);
    assert.match(source, /PAGES_BLOB_DEPLOY_CREDENTIAL/);
  }
});

test("EdgeOne native cache configuration uses the supported Makers schema", () => {
  const config = JSON.parse(readFileSync(new URL("../edgeone.json", import.meta.url), "utf8"));
  assert.equal("cache" in config, false);
  assert.equal(
    config.headers[0].headers.find((header) => header.key === "X-Proxy-Version")?.value,
    "webflow-china-speedup/2.5.0"
  );
  assert.deepEqual(config.caches, [
    {
      source: "/__eo_asset_v3__/*",
      cacheTtl: 2592000
    }
  ]);
});
