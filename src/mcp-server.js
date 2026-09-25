/** Minimal stateless MCP server (Streamable HTTP, JSON-RPC 2.0). */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = "2025-06-18";
const MAX_BODY = 1024 * 1024;
const SERVER_INFO = { name: "aigou-storefront", version: "0.2.0" };

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function authorized(req, token) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function handleRpc(body, { token, tools }) {
  if (body.method === undefined) return rpcError(body.id ?? null, -32600, "not a request");
  if (typeof body.method === "string" && body.method.startsWith("notifications/")) return null;
  const id = body.id ?? null;
  if (body.method === "initialize") {
    const requested = body.params && body.params.protocolVersion;
    return { jsonrpc: "2.0", id,
             result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} },
                       serverInfo: SERVER_INFO } };
  }
  if (body.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (body.method === "tools/list") {
    return { jsonrpc: "2.0", id,
             result: { tools: tools.map(({ name, description, inputSchema }) =>
               ({ name, description, inputSchema })) } };
  }
  if (body.method === "tools/call") {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};
    const tool = tools.find((t) => t.name === name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return rpcError(id, -32602, "arguments must be an object");
    }
    try {
      return { jsonrpc: "2.0", id, result: toolResult(await tool.handler(args)) };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { ...toolResult({ error: String(err.message) }), isError: true } };
    }
  }
  return rpcError(id, -32601, `method not found: ${body.method}`);
}

export function createMcpServer({ token, tools, port = 8080, host = "0.0.0.0" }) {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "POST only" }));
      return;
    }
    if (!authorized(req, token)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rpcError(null, -32700, "parse error")));
        return;
      }
      const out = await handleRpc(body, { token, tools });
      if (out === null) { res.writeHead(202); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
