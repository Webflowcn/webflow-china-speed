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
    assert.match(source, /handleProxyRequest\(context\.request, context\.env \|\| \{\}, context\)/);
    assert.equal((source.match(/export async function handleProxyRequest/g) || []).length, 1);
  }
});
