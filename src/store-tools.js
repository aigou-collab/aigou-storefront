/** MCP store tools backed by WooCommerce REST v3 + an in-memory cart. */
import { authUrl, getJson, hasValidPrice, mapProduct, mapVariation, postJson } from "./source-woocommerce.js";

const MAX_SEARCH = 20;

function simpleVariant(p) {
  return { variant_id: `${p.id}-v1`, title: "默认规格", price: Number(p.price),
           available: p.purchasable !== false && p.in_stock !== false };
}

async function fetchProductLive(source, fetchImpl, productId) {
  const url = authUrl(source, `/wp-json/wc/v3/products/${encodeURIComponent(productId)}`);
  const p = await getJson(fetchImpl, url);
  if (p.type === "variable") {
    const vUrl = authUrl(source, `/wp-json/wc/v3/products/${p.id}/variations`);
    vUrl.searchParams.set("per_page", "100");
    const variations = await getJson(fetchImpl, vUrl);
    return { ...mapProduct(p), variants: variations.slice(0, 50).map((v) => mapVariation(v, p.id)) };
  }
  return { ...mapProduct(p), variants: [simpleVariant(p)] };
}

function mapShipping(shipping = {}) {
  const name = String(shipping.name || "");
  const space = name.indexOf(" ");
  const first = space === -1 ? name : name.slice(0, space);
  const last = space === -1 ? "" : name.slice(space + 1);
  return {
    first_name: first, last_name: last,
    phone: shipping.phone || "", address_1: shipping.address1 || "",
    city: shipping.city || "", state: shipping.state || "",
    postcode: shipping.postcode || "", country: shipping.country || "CN",
  };
}

export function buildStoreTools(config, { fetchImpl, randomId }) {
  const source = config.source;
  const currency = config.store.currency || "CNY";
  const newId = randomId || (() => Math.random().toString(36).slice(2, 12));
  const carts = new Map();

  return [
    { name: "search_products",
      description: "按关键词搜索本店在售商品，返回候选列表（含最低价与币种）。",
      inputSchema: { type: "object", properties: {
        query: { type: "string", description: "搜索关键词" },
        max_price: { type: "number", description: "可选价格上限" },
        limit: { type: "integer", description: "返回条数，默认 5，最大 20" } },
        required: ["query"] },
      handler: async (args) => {
        const limit = Math.max(1, Math.min(Number(args.limit || 5), MAX_SEARCH));
        const url = authUrl(source, "/wp-json/wc/v3/products");
        url.searchParams.set("search", String(args.query));
        url.searchParams.set("per_page", String(MAX_SEARCH));
        url.searchParams.set("status", "publish");
        const batch = await getJson(fetchImpl, url);
        const results = batch.filter(hasValidPrice)  // empty price must not become 0
          .map(mapProduct)
          .filter((p) => args.max_price === undefined || p.price_min <= args.max_price)
          .slice(0, limit)
          .map((p) => ({ product_id: p.product_id, title: p.title,
                         price_min: p.price_min, currency }));
        return { results, total: results.length };
      } },

    { name: "get_product",
      description: "获取某商品详情与可选规格（含实时价格与库存），下单前必须先调用核实。",
      inputSchema: { type: "object", properties: { product_id: { type: "string" } },
                     required: ["product_id"] },
      handler: async (args) =>
        ({ store_id: config.store.store_id, currency,
           ...(await fetchProductLive(source, fetchImpl, String(args.product_id))) }) },

    { name: "create_cart",
      description: "校验并锁定价：按商品/规格/数量创建购物车，返回 cart_id 与合计。",
      inputSchema: { type: "object", properties: {
        items: { type: "array", items: { type: "object", properties: {
          product_id: { type: "string" }, variant_id: { type: "string" },
          quantity: { type: "integer" } },
          required: ["product_id", "variant_id", "quantity"] } } },
        required: ["items"] },
      handler: async (args) => {
        const items = [];
        for (const it of args.items) {
          const detail = await fetchProductLive(source, fetchImpl, String(it.product_id));
          const variant = detail.variants.find((v) => v.variant_id === String(it.variant_id));
          if (!variant) throw new Error(`variant ${it.variant_id} not found on product ${it.product_id}`);
          if (!variant.available) throw new Error(`variant ${it.variant_id} is out of stock`);
          const quantity = Math.max(1, Math.floor(Number(it.quantity) || 1));
          items.push({ product_id: detail.product_id, variant_id: variant.variant_id,
                       title: `${detail.title} / ${variant.title}`,
                       unit_price: variant.price, quantity });
        }
        const cart_id = newId();
        const total = Math.round(items.reduce((s, i) => s + i.unit_price * i.quantity, 0) * 100) / 100;
        carts.set(cart_id, { items, currency });
        return { cart_id, items, total, currency };
      } },

    { name: "checkout",
      description: "结算购物车：在商家店铺创建 pending 订单（商家确认后线下收款），返回订单号与总额。",
      inputSchema: { type: "object", properties: {
        cart_id: { type: "string" },
        shipping: { type: "object", properties: {
          name: { type: "string" }, phone: { type: "string" },
          address1: { type: "string" }, city: { type: "string" },
          state: { type: "string" }, postcode: { type: "string" },
          country: { type: "string" } } } },
        required: ["cart_id"] },
      handler: async (args) => {
        const cart = carts.get(String(args.cart_id));
        if (!cart) throw new Error(`cart ${args.cart_id} not found`);
        const line_items = cart.items.map((i) => {
          const product_id = Number(i.product_id);
          if (i.variant_id.endsWith("-v1") && i.variant_id === `${i.product_id}-v1`) {
            return { product_id, quantity: i.quantity };
          }
          return { product_id, variation_id: Number(i.variant_id), quantity: i.quantity };
        });
        const address = mapShipping(args.shipping);
        const url = authUrl(source, "/wp-json/wc/v3/orders");
        const order = await postJson(fetchImpl, url, {
          line_items, shipping: address, billing: address,
          status: "pending", set_paid: false,
        });
        carts.delete(String(args.cart_id));
        return { order_id: String(order.id), order_number: String(order.number),
                 status: order.status, total: Number(order.total), currency: cart.currency };
      } },
  ];
}
