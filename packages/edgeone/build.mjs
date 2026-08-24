import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

const entries = ["index.js", "[[default]].js"];

await mkdir(".edgeone/edge-functions", { recursive: true });

for (const entry of entries) {
  await build({
    entryPoints: [`edge-functions/${entry}`],
    outfile: `.edgeone/edge-functions/${entry}`,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    legalComments: "none",
    minify: false,
    sourcemap: false
  });
}

console.log("✓ Edge functions bundled to .edgeone/edge-functions/");
