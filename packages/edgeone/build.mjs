import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const proxyCode = readFileSync("edge-functions/_shared/proxy.js", "utf-8");

const wrapperCode = `export default async function onRequest(context) {
  return handleProxyRequest(context.request, context.env || {}, context);
}
`;

mkdirSync(".edgeone/edge-functions", { recursive: true });

writeFileSync(".edgeone/edge-functions/index.js", wrapperCode + "\n" + proxyCode);
writeFileSync(".edgeone/edge-functions/[[default]].js", wrapperCode + "\n" + proxyCode);

console.log("✓ Edge functions bundled to .edgeone/edge-functions/");
