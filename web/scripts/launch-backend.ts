/**
 * Optional standalone launch API on :8788 — same handlers as Next `/api/*`.
 * Default dev: `cd web && npm run dev` (no separate backend needed).
 */
import * as http from "node:http";
import {
  executeLaunch,
  getLaunchConfig,
  handleRequestPool,
  type ExecutorPayload,
  type LaunchRequest,
} from "../src/server/launch-service";

const PORT = Number(process.env.ARANCIO_LAUNCH_BACKEND_PORT ?? "8788");

function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/request-pool") {
    void (async () => {
      try {
        const body = await readJson<LaunchRequest>(req);
        const result = await handleRequestPool(body);
        sendJson(res, result.status, result.body);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("request-pool error:", message);
        sendJson(res, 502, { ok: false, error: message });
      }
    })();
    return;
  }

  if (req.method === "POST" && req.url === "/api/internal/execute") {
    void (async () => {
      try {
        const body = await readJson<ExecutorPayload>(req);
        const result = await executeLaunch(body);
        sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("execute error:", message);
        sendJson(res, 500, { ok: false, error: message });
      }
    })();
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    const cfg = getLaunchConfig();
    sendJson(res, 200, { ok: true, rpc: cfg.rpcUrl });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  const cfg = getLaunchConfig();
  console.log(`launch API (local) http://127.0.0.1:${PORT}`);
  console.log(`  POST /api/request-pool → policy + Meteora launch`);
  console.log(`  POST /api/internal/execute → Meteora + register (${cfg.rpcUrl})`);
  console.log(`  Tip: Next.js dev serves the same routes on :3000/api/*`);
});
