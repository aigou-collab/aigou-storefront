import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, run } from "../src/cli.js";

const WOO_CONFIG = {
  store: { store_id: "acme", name: "Acme", currency: "CNY" },
  source: { type: "woocommerce", base_url: "https://shop.example.com",
            consumer_key: "ck", consumer_secret: "cs" },
  publish: { mode: "file", path: "out.json" },
};

test("parseArgs: defaults, flags, values and errors", () => {
  assert.deepEqual(parseArgs(["sync"]),
    { command: "sync", configPath: "./aigou-storefront.config.json", register: false, dryRun: false });
  assert.deepEqual(parseArgs(["sync", "--config", "c.json", "--register", "--dry-run"]),
    { command: "sync", configPath: "c.json", register: true, dryRun: true });
  assert.throws(() => parseArgs(["push"]), /usage/i);
  assert.throws(() => parseArgs([]), /usage/i);
  assert.throws(() => parseArgs(["sync", "--wat"]), /usage/i);
  assert.throws(() => parseArgs(["sync", "--config"]), /usage/i);
});

function makeDeps(config, pages, writes) {
  return {
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/products")) {
        const page = Number(u.searchParams.get("page"));
        return { ok: true, status: 200,
                 json: async () => (page === 1 ? pages : []) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    fs: {
      readFileSync: (path) => path === "c.json" ? JSON.stringify(config) : (() => { throw new Error("ENOENT"); })(),
      writeFileSync: (path, content) => writes.push({ path, content }),
    },
    log: (...a) => logs.push(a.join(" ")),
    err: (...a) => errs.push(a.join(" ")),
  };
}
const logs = [];
const errs = [];
const writes = [];

test("run: sync file-publish end to end with injected deps", async () => {
  logs.length = 0; errs.length = 0; writes.length = 0;
  const pages = [{ id: 1, name: "竹制腕托", type: "simple", status: "publish", price: "69",
                   purchasable: true, in_stock: true, images: [], permalink: null,
                   short_description: "" }];
  const deps = makeDeps(WOO_CONFIG, pages, writes);
  const code = await run(["sync", "--config", "c.json"], deps);
  assert.equal(code, 0);
  assert.equal(errs.length, 0);
  assert.match(logs[0], /wrote out\.json \(1 products\)/);
  assert.equal(JSON.parse(writes[0].content).products[0].product_id, "1");
});

test("run: dry-run publishes nothing and prints summary", async () => {
  logs.length = 0; errs.length = 0; writes.length = 0;
  const deps = makeDeps(WOO_CONFIG, [], writes);
  const code = await run(["sync", "--config", "c.json", "--dry-run"], deps);
  assert.equal(code, 0);
  assert.equal(writes.length, 0);
  assert.match(logs[0], /^\[dry-run\] store acme currency CNY products 0$/);
});

test("run: config error exits 1 with prefixed message", async () => {
  logs.length = 0; errs.length = 0; writes.length = 0;
  const deps = makeDeps({ ...WOO_CONFIG, source: { type: "csv" } }, [], writes);
  const code = await run(["sync", "--config", "c.json"], deps);
  assert.equal(code, 1);
  assert.match(errs[0], /^aigou-storefront: source\.type/);
});

test("run: json source flows to push publisher with register", async () => {
  logs.length = 0; errs.length = 0; writes.length = 0;
  const config = {
    store: { store_id: "beta", name: "Beta" },
    source: { type: "json", path: "snap.json" },
    publish: { mode: "push", catalog_base_url: "http://127.0.0.1:8000",
               shop_domain: "beta.example.com" },
  };
  const snapshot = { schema: "aigou/catalog@1",
                     store: { store_id: "beta", name: "Beta", currency: "CNY" },
                     products: [{ product_id: "b1", title: "腕托", price_min: 69 }] };
  const posts = [];
  const deps = {
    fetch: async (url, options) => {
      posts.push({ url: new URL(url), options });
      if (new URL(url).pathname === "/stores") {
        return { ok: true, status: 201, json: async () => ({ updated: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ products: 1 }) };
    },
    fs: {
      readFileSync: (path) => path === "c.json" ? JSON.stringify(config)
        : path === "snap.json" ? JSON.stringify(snapshot)
        : (() => { throw new Error("ENOENT"); })(),
      writeFileSync: () => {},
    },
    log: (...a) => logs.push(a.join(" ")),
    err: (...a) => errs.push(a.join(" ")),
  };
  const code = await run(["sync", "--config", "c.json", "--register"], deps);
  assert.equal(code, 0);
  assert.equal(posts[0].url.pathname, "/stores");
  assert.equal(posts[1].url.pathname, "/stores/beta/catalog");
  assert.match(logs[0], /pushed 1 products to http:\/\/127\.0\.0\.1:8000 \(registered\)/);
});
