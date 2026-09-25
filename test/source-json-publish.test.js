import test from "node:test";
import assert from "node:assert/strict";
import { readJsonSource } from "../src/source-json.js";
import { publishFile, publishPush, PublishError } from "../src/publish.js";

const SNAPSHOT = {
  schema: "aigou/catalog@1",
  store: { store_id: "beta", name: "Beta 家居", currency: "CNY" },
  products: [{ product_id: "b1", title: "竹制腕托", price_min: 69,
               variants: [{ variant_id: "b1-v1", title: "标准", price: 69 }] }],
};

test("readJsonSource validates and returns the document's own store", () => {
  const readFileSync = () => JSON.stringify(SNAPSHOT);
  const doc = readJsonSource({ source: { path: "products.json" } }, readFileSync);
  assert.deepEqual(doc.store, SNAPSHOT.store);
});

test("readJsonSource failures mention the path", () => {
  const readFileSync = () => { throw new Error("ENOENT"); };
  assert.throws(() => readJsonSource({ source: { path: "gone.json" } }, readFileSync), /gone.json/);
  assert.throws(() => readJsonSource({ source: { path: "bad.json" } }, () => "{"), /bad.json/);
  assert.throws(() => readJsonSource({ source: { path: "wrong.json" } },
                                     () => JSON.stringify({ schema: "x", store: {}, products: [] })), /schema/);
});

function pushConfig() {
  return { publish: { mode: "push", catalog_base_url: "http://127.0.0.1:8000",
                      shop_domain: "beta.example.com" } };
}

test("publishPush without register posts only the catalog", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, status: 200, json: async () => ({ products: 1 }) };
  };
  const out = await publishPush(SNAPSHOT, pushConfig(), { fetchImpl });
  assert.deepEqual(out, { products: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/stores/beta/catalog");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).schema, "aigou/catalog@1");
});

test("publishPush with register posts store first and reports fresh registration", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    if (new URL(url).pathname === "/stores") {
      return { ok: true, status: 201, json: async () => ({ store_id: "beta", updated: false }) };
    }
    return { ok: true, status: 200, json: async () => ({ products: 1 }) };
  };
  const out = await publishPush(SNAPSHOT, pushConfig(), { fetchImpl, register: true });
  assert.deepEqual(out, { registered: true, products: 1 });
  assert.equal(calls[0].pathname, "/stores");
  assert.equal(calls[1].pathname, "/stores/beta/catalog");
});

test("publishPush surfaces http errors with status and body snippet", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404,
                                   json: async () => ({ detail: "store beta not found" }) });
  await assert.rejects(
    () => publishPush(SNAPSHOT, pushConfig(), { fetchImpl }),
    (e) => e instanceof PublishError && e.message.includes("HTTP 404") && e.message.includes("store beta not found"));
});

test("publishFile writes pretty JSON and returns counts", async () => {
  let written;
  const writeFile = async (path, content) => { written = { path, content }; };
  const out = await publishFile(SNAPSHOT, { publish: { mode: "file", path: "out/aigou-catalog.json" } }, { writeFile });
  assert.equal(out.path, "out/aigou-catalog.json");
  assert.equal(out.products, 1);
  assert.equal(written.path, "out/aigou-catalog.json");
  assert.equal(JSON.parse(written.content).store.store_id, "beta");
  assert.ok(written.content.endsWith("\n"));
});

test("publishPush registers an mcp endpoint when configured", async () => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url: url.toString(), body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname === "/stores") return { ok: true, json: async () => ({ updated: false }) };
    return { ok: true, json: async () => ({ products: 1 }) };
  };
  const config = { store: { store_id: "acme", name: "Acme" },
    source: { type: "json", path: "./p.json" },
    publish: { mode: "push", catalog_base_url: "http://cat.local", shop_domain: "shop.example.com" },
    mcp: { port: 8080, token: "tok-1", public_base_url: "https://shop.example.com" } };
  const out = await publishPush({ schema: "aigou/catalog@1", store: { store_id: "acme", name: "Acme" }, products: [] },
    config, { fetchImpl, register: true });
  assert.equal(out.registered, true);
  assert.equal(posts[0].body.endpoint_type, "mcp");
  assert.equal(posts[0].body.mcp_url, "https://shop.example.com/mcp");
  assert.equal(posts[0].body.mcp_token, "tok-1");
});

test("publishPush refuses mcp registration without public_base_url", async () => {
  const config = { store: { store_id: "acme", name: "Acme" },
    source: { type: "json", path: "./p.json" },
    publish: { mode: "push", catalog_base_url: "http://cat.local", shop_domain: "shop.example.com" },
    mcp: { port: 8080, token: "tok-1", public_base_url: null } };
  const err = await publishPush({ schema: "aigou/catalog@1", store: { store_id: "acme", name: "Acme" }, products: [] },
    config,
    { fetchImpl: async () => { throw new Error("should not register"); }, register: true })
    .catch((e) => e);
  assert.ok(err instanceof PublishError);
  assert.ok(String(err.message).includes("public_base_url"));
});
