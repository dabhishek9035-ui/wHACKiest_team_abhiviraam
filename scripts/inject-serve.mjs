// owner: M4 (D Venkata Abhishek, 1TD25CS079)
// purpose: minimal localhost static server for fixtures/web/hostile-page.html used
//          by scripts/inject-test.ps1 (A15 web half). Serves the fixture on any GET
//          path so the probe can fetch it like an agent would.
// public interface it must expose: CLI (--file <path> --port <n>), logs SERVING line.
// consumed by: scripts/inject-test.ps1, scripts/inject-probe.mjs (fetch).
// TODO: none (implemented).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const file = argValue("--file", "fixtures/web/hostile-page.html");
const port = Number(argValue("--port", "8099"));

let body;
try {
  body = readFileSync(file);
} catch (err) {
  console.error(`inject-serve: cannot read fixture ${file}: ${String(err)}`);
  process.exit(1);
}

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SERVING http://127.0.0.1:${port}/hostile-page.html (fixture: ${file})`);
});

server.on("error", (err) => {
  console.error(`inject-serve: ${String(err)}`);
  process.exit(1);
});
