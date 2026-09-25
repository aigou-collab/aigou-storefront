// storefront/test/mcp-server.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { handleRpc, createMcpServer } from "../src/mcp-server.js";

const tools = [{
  name: "echo",
  description: "echo back",
  inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
  handler: async (args) => ({ echoed: args.msg }),
}];

test("initialize returns protocol version, capabilities and serverInfo", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
                              { token: "t", tools });
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.deepEqual(res.result.capabilities, { tools: {} });
  assert.equal(res.result.serverInfo.name, "aigou-storefront");
});

test("initialize echoes a known client protocol version", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize",
                                params: { protocolVersion: "2025-06-18" } },
                              { token: "t", tools });
  assert.equal(res.result.protocolVersion, "2025-06-18");
});

test("notifications return null", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" },
                              { token: "t", tools });
  assert.equal(res, null);
});

test("tools/list exposes name, description and inputSchema", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" },
                              { token: "t", tools });
  assert.equal(res.result.tools.length, 1);
  assert.equal(res.result.tools[0].name, "echo");
  assert.deepEqual(res.result.tools[0].inputSchema, tools[0].inputSchema);
});

test("tools/call returns text content with JSON payload", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call",
                                params: { name: "echo", arguments: { msg: "hi" } } },
                              { token: "t", tools });
  assert.equal(res.result.content[0].type, "text");
  assert.deepEqual(JSON.parse(res.result.content[0].text), { echoed: "hi" });
  assert.equal(res.result.isError, undefined);
});

test("tools/call unknown tool is a protocol error (-32602)", async () => {
  const res = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call",
                                params: { name: "nope", arguments: {} } },
                              { token: "t", tools });
  assert.equal(res.error.code, -32602);
});

test("tool handler throw becomes isError result without stack traces", async () => {
  const bad = [{ ...tools[0], name: "boom", handler: async () => { throw new Error("shop down http://x/ck_leak"); } }];
  const res = await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call",
                                params: { name: "boom", arguments: { msg: "x" } } },
                              { token: "t", tools: bad });
  assert.equal(res.result.isError, true);
  assert.ok(res.result.content[0].text.includes("shop down"));
  assert.ok(!res.result.content[0].text.includes("at "));
});

test("unknown method is -32601 and ping returns empty result", async () => {
  const missing = await handleRpc({ jsonrpc: "2.0", id: 7, method: "wat" }, { token: "t", tools });
  assert.equal(missing.error.code, -32601);
  const pong = await handleRpc({ jsonrpc: "2.0", id: 8, method: "ping" }, { token: "t", tools });
  assert.deepEqual(pong.result, {});
});

test("http server: auth, method routing and happy path over a real socket", async () => {
  const { server, port } = await createMcpServer({ token: "s3cret", tools, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${port}/mcp`;
  const noAuth = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(noAuth.status, 401);
  const wrongAuth = await fetch(base, { method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer wrong" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal(wrongAuth.status, 401);
  const get = await fetch(base);
  assert.equal(get.status, 405);
  const ok = await fetch(base, { method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer s3cret" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call",
                           params: { name: "echo", arguments: { msg: "live" } } }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/json");
  const body = await ok.json();
  assert.deepEqual(JSON.parse(body.result.content[0].text), { echoed: "live" });
  const notif = await fetch(base, { method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer s3cret" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(notif.status, 202);
  server.close();
});

test("http server: null body is a -32600 error, invalid JSON is -32700, process stays alive", async () => {
  const { server, port } = await createMcpServer({ token: "s3cret", tools, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${port}/mcp`;
  const auth = { "Content-Type": "application/json", "Authorization": "Bearer s3cret" };
  const nullBody = await fetch(base, { method: "POST", headers: auth, body: "null" });
  assert.equal(nullBody.status, 200);
  const err = await nullBody.json();
  assert.equal(err.jsonrpc, "2.0");
  assert.equal(err.id, null);
  assert.equal(err.error.code, -32600);
  const badJson = await fetch(base, { method: "POST", headers: auth, body: "{" });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, -32700);
  const alive = await fetch(base, { method: "POST", headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "ping" }) });
  assert.equal(alive.status, 200);
  assert.deepEqual((await alive.json()).result, {});
  server.close();
});
