import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig, validateConfig } from "../src/config.js";

const GOOD = {
  store: { store_id: "acme", name: "Acme 旗舰店" },
  source: { type: "json", path: "./products.json" },
  publish: { mode: "file", path: "./out.json" },
};

test("validateConfig accepts minimal good config and defaults currency", () => {
  const cfg = validateConfig(GOOD);
  assert.equal(cfg.store.currency, "CNY");
  assert.equal(cfg.source.type, "json");
  assert.equal(cfg.publish.mode, "file");
});

test("validateConfig accepts woocommerce + push shape", () => {
  const cfg = validateConfig({
    store: { store_id: "acme", name: "Acme", currency: "USD" },
    source: { type: "woocommerce", base_url: "https://shop.example.com",
              consumer_key: "ck_x", consumer_secret: "cs_y" },
    publish: { mode: "push", catalog_base_url: "http://127.0.0.1:8000",
               shop_domain: "shop.example.com" },
  });
  assert.equal(cfg.source.base_url, "https://shop.example.com");
});

test("validateConfig rejects with field-path messages", () => {
  const cases = [
    [{ ...GOOD, store: { store_id: "", name: "x" } }, "store.store_id"],
    [{ ...GOOD, source: { type: "csv" } }, "source.type"],
    [{ ...GOOD, source: { type: "woocommerce", base_url: "ftp://x", consumer_key: "k", consumer_secret: "s" } }, "source.base_url"],
    [{ ...GOOD, source: { type: "woocommerce", base_url: "https://x" } }, "source.consumer_key"],
    [{ ...GOOD, publish: { mode: "email" } }, "publish.mode"],
    [{ ...GOOD, publish: { mode: "push", catalog_base_url: "https://c" } }, "publish.shop_domain"],
  ];
  for (const [raw, field] of cases) {
    assert.throws(() => validateConfig(raw), (e) => e instanceof ConfigError && e.message.startsWith(field), JSON.stringify(raw));
  }
});

test("loadConfig reads, parses and validates; failures mention the path", () => {
  const fs = { readFileSync: () => JSON.stringify(GOOD) };
  assert.equal(loadConfig(fs, "cfg.json").store.store_id, "acme");
  const missing = { readFileSync: () => { const err = new Error("ENOENT"); err.code = "ENOENT"; throw err; } };
  assert.throws(() => loadConfig(missing, "nope.json"),
                (e) => e instanceof ConfigError && e.message.includes("nope.json"));
  const broken = { readFileSync: () => "{ not json" };
  assert.throws(() => loadConfig(broken, "cfg.json"), (e) => e instanceof ConfigError);
});
