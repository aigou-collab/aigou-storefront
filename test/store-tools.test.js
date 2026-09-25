// storefront/test/store-tools.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { buildStoreTools } from "../src/store-tools.js";

const config = {
  store: { store_id: "acme", name: "Acme", currency: "CNY" },
  source: { type: "woocommerce", base_url: "https://shop.example.com",
            consumer_key: "ck_test", consumer_secret: "cs_test" },
};

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function wooProduct(id, over = {}) {
  return { id, name: `P${id}`, price: "10.00", short_description: "",
           type: "simple", purchasable: true, in_stock: true,
           images: [], permalink: `https://shop.example.com/?p=${id}`, ...over };
}

test("search_products queries woo with search param and maps results", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse([wooProduct(1), wooProduct(2, { price: "99.00" })]);
  };
  const [search] = buildStoreTools(config, { fetchImpl });
  const out = await search.handler({ query: "widget", max_price: 50, limit: 5 });
  assert.equal(out.total, 1);
  assert.equal(out.results[0].product_id, "1");
  assert.equal(out.results[0].price_min, 10);
  assert.equal(out.results[0].currency, "CNY");
  assert.equal(new URL(calls[0]).searchParams.get("search"), "widget");
  assert.equal(new URL(calls[0]).searchParams.get("status"), "publish");
});

test("search_products skips products without a valid price", async () => {
  // price "" (e.g. variable product with no default variant price) must not
  // become price_min 0 in results — same guard as catalog sync
  const fetchImpl = async () => jsonResponse([wooProduct(1, { price: "" }), wooProduct(2)]);
  const [search] = buildStoreTools(config, { fetchImpl });
  const out = await search.handler({ query: "widget" });
  assert.equal(out.total, 1);
  assert.deepEqual(out.results.map((r) => r.product_id), ["2"]);
  assert.equal(out.results[0].price_min, 10);
});

test("get_product returns ProductDetail shape with variants", async () => {
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/products/7")) {
      return jsonResponse(wooProduct(7, { type: "variable" }));
    }
    if (url.pathname.endsWith("/variations")) {
      return jsonResponse([{ id: 71, attributes: [{ option: "Red" }], price: "12.00",
                             purchasable: true, in_stock: true }]);
    }
    throw new Error("unexpected " + url.pathname);
  };
  const tools = Object.fromEntries(buildStoreTools(config, { fetchImpl }).map((t) => [t.name, t]));
  const out = await tools.get_product.handler({ product_id: "7" });
  assert.equal(out.store_id, "acme");
  assert.equal(out.price_min, 10);
  assert.deepEqual(out.variants, [{ variant_id: "71", title: "Red", price: 12, available: true }]);
});

test("create_cart validates variant availability live and prices the cart", async () => {
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("/products/7")) {
      return jsonResponse(wooProduct(7, { type: "variable" }));
    }
    if (url.pathname.endsWith("/variations")) {
      return jsonResponse([{ id: 71, attributes: [{ option: "Red" }], price: "12.50",
                             purchasable: true, in_stock: true }]);
    }
    throw new Error("unexpected " + url.pathname);
  };
  const tools = Object.fromEntries(buildStoreTools(config, { fetchImpl }).map((t) => [t.name, t]));
  const cart = await tools.create_cart.handler(
    { items: [{ product_id: "7", variant_id: "71", quantity: 2 }] });
  assert.ok(cart.cart_id);
  assert.equal(cart.total, 25);
  assert.equal(cart.currency, "CNY");
  const bad = await tools.create_cart.handler(
    { items: [{ product_id: "7", variant_id: "nope", quantity: 1 }] }).catch((e) => e);
  assert.ok(String(bad.message).includes("nope"));
});

test("checkout posts a woo order with mapped line_items and address", async () => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      posts.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ id: 501, number: "501", status: "pending",
                            total: "25.00", currency: "CNY" });
    }
    if (url.pathname.endsWith("/products/7")) return jsonResponse(wooProduct(7, { type: "variable" }));
    if (url.pathname.endsWith("/variations")) {
      return jsonResponse([{ id: 71, attributes: [{ option: "Red" }], price: "12.50",
                             purchasable: true, in_stock: true }]);
    }
    throw new Error("unexpected " + url.pathname);
  };
  const tools = Object.fromEntries(buildStoreTools(config, { fetchImpl }).map((t) => [t.name, t]));
  const cart = await tools.create_cart.handler(
    { items: [{ product_id: "7", variant_id: "71", quantity: 2 }] });
  const order = await tools.checkout.handler({ cart_id: cart.cart_id,
    shipping: { name: "张三", phone: "13800000000", address1: "南京路 1 号",
                city: "上海", country: "CN" } });
  assert.deepEqual(order, { order_id: "501", order_number: "501", status: "pending",
                            total: 25, currency: "CNY" });
  assert.equal(posts.length, 1);
  assert.equal(new URL(posts[0].url).pathname, "/wp-json/wc/v3/orders");
  assert.deepEqual(posts[0].body.line_items,
                   [{ product_id: 7, variation_id: 71, quantity: 2 }]);
  assert.equal(posts[0].body.shipping.address_1, "南京路 1 号");
  assert.equal(posts[0].body.shipping.first_name, "张三");
  assert.equal(posts[0].body.set_paid, false);
  // simple product synthetic variant `${id}-v1` maps to product-only line item
  const posts2 = [];
  const fetch2 = async (url, init) => {
    if (init && init.method === "POST") {
      posts2.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ id: 502, number: "502", status: "pending", total: "10.00", currency: "CNY" });
    }
    return jsonResponse(wooProduct(9));
  };
  const tools2 = Object.fromEntries(buildStoreTools(config, { fetchImpl: fetch2 }).map((t) => [t.name, t]));
  const cart2 = await tools2.create_cart.handler(
    { items: [{ product_id: "9", variant_id: "9-v1", quantity: 1 }] });
  const order2 = await tools2.checkout.handler({ cart_id: cart2.cart_id });
  assert.equal(order2.order_id, "502");
  assert.deepEqual(posts2[0].body.line_items, [{ product_id: 9, quantity: 1 }]);
});

test("checkout unknown cart throws a clear error", async () => {
  const tools = Object.fromEntries(buildStoreTools(config, { fetchImpl: async () => jsonResponse([]) }).map((t) => [t.name, t]));
  const err = await tools.checkout.handler({ cart_id: "ghost" }).catch((e) => e);
  assert.ok(String(err.message).includes("ghost"));
});

test("error messages carry pathname only, never credentials", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const [search] = buildStoreTools(config, { fetchImpl });
  const err = await search.handler({ query: "x" }).catch((e) => e);
  assert.ok(String(err.message).includes("/wp-json/wc/v3/products"));
  assert.ok(!String(err.message).includes("ck_test"));
  assert.ok(!String(err.message).includes("cs_test"));
});

test("tool specs expose names, descriptions and object schemas", () => {
  const tools = buildStoreTools(config, { fetchImpl: async () => jsonResponse([]) });
  assert.deepEqual(tools.map((t) => t.name),
                   ["search_products", "get_product", "create_cart", "checkout"]);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 10);
  }
});
