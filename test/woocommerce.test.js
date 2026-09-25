import test from "node:test";
import assert from "node:assert/strict";
import { fetchWooCommerceCatalog, SourceError } from "../src/source-woocommerce.js";

const CONFIG = {
  store: { store_id: "acme", name: "Acme", currency: "CNY" },
  source: { type: "woocommerce", base_url: "https://shop.example.com",
            consumer_key: "ck_secret_key", consumer_secret: "cs_secret_secret" },
};

function product(id, over = {}) {
  return { id, name: `Item ${id}`, type: "simple", status: "publish",
           price: "10.5", purchasable: true, in_stock: true,
           short_description: "<p>好物 &amp; 实惠</p>", permalink: `https://shop.example.com/?p=${id}`,
           images: [{ src: `https://img/${id}.jpg` }], ...over };
}

function makeFetch(pages, calls) {
  return async (url, options) => {
    calls.push({ url: new URL(url), options });
    const u = new URL(url);
    if (u.pathname.endsWith("/products")) {
      const page = Number(u.searchParams.get("page"));
      const body = pages[Math.min(page - 1, pages.length - 1)] ?? [];
      return { ok: true, status: 200, json: async () => body };
    }
    if (u.pathname.includes("/variations")) {
      return { ok: true, status: 200, json: async () => variationsFor(u.pathname) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function variationsFor(pathname) {
  const productId = pathname.split("/")[5];
  return [{ id: Number(`${productId}01`), price: "12", purchasable: true, in_stock: true,
            attributes: [{ option: "黑" }, { option: "" }, { option: "M" }] },
          { id: Number(`${productId}02`), price: "13", purchasable: false, in_stock: true,
            attributes: [] }];
}

test("paginates products until a short page and maps snapshot fields", async () => {
  const calls = [];
  const full = Array.from({ length: 50 }, (_, i) => product(i + 1));
  const last = [product(51)];
  const doc = await fetchWooCommerceCatalog(CONFIG, makeFetch([full, last], calls));
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/products")).length, 2);
  assert.equal(doc.schema, "aigou/catalog@1");
  assert.equal(doc.products.length, 51);
  const first = doc.products[0];
  assert.equal(first.product_id, "1");
  assert.equal(first.title, "Item 1");
  assert.equal(first.description, "好物 & 实惠");
  assert.equal(first.price_min, 10.5);
  assert.equal(first.image_url, "https://img/1.jpg");
  assert.equal(first.url, "https://shop.example.com/?p=1");
  assert.deepEqual(first.variants, [{ variant_id: "1-v1", title: "默认规格", price: 10.5, available: true }]);
});

test("variable products get variations with joined titles and availability", async () => {
  const calls = [];
  const variable = product(7, { type: "variable", price: "12" });
  const doc = await fetchWooCommerceCatalog(CONFIG, makeFetch([[variable]], calls));
  const variants = doc.products[0].variants;
  assert.deepEqual(variants, [
    { variant_id: "701", title: "黑 / M", price: 12, available: true },
    { variant_id: "702", title: "规格 702", price: 13, available: false },
  ]);
  const varCall = calls.find((c) => c.url.pathname.includes("/variations"));
  assert.equal(varCall.url.searchParams.get("per_page"), "100");
});

test("filters products with invalid prices and keeps the rest", async () => {
  const mixed = [product(1), product(2, { price: "" }), product(3)];
  const doc = await fetchWooCommerceCatalog(CONFIG, makeFetch([mixed], []));
  assert.deepEqual(doc.products.map((p) => p.product_id), ["1", "3"]);
});

test("http errors throw SourceError with query-stripped path and no secrets", async () => {
  const bad = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    () => fetchWooCommerceCatalog(CONFIG, bad),
    (e) => e instanceof SourceError && e.message === "woocommerce /wp-json/wc/v3/products: HTTP 500"
        && !e.message.includes("ck_secret"));
});
