/** WooCommerce REST v3 -> aigou/catalog@1 snapshot conversion. */

import { makeSnapshot, stripHtml } from "./snapshot.js";

export class SourceError extends Error {}

const PRODUCTS_PER_PAGE = 50;
const MAX_VARIANTS = 50;

export function authUrl(source, pathname) {
  const url = new URL(pathname, source.base_url);
  url.searchParams.set("consumer_key", source.consumer_key);
  url.searchParams.set("consumer_secret", source.consumer_secret);
  return url;
}

export async function getJson(fetchImpl, url) {
  let resp;
  try {
    resp = await fetchImpl(url, {});
  } catch (err) {
    throw new SourceError(`woocommerce ${url.pathname}: ${err.message}`);
  }
  if (!resp.ok) {
    throw new SourceError(`woocommerce ${url.pathname}: HTTP ${resp.status}`);
  }
  try {
    return await resp.json();
  } catch (err) {
    throw new SourceError(`woocommerce ${url.pathname}: invalid JSON (${err.message})`);
  }
}

export async function postJson(fetchImpl, url, bodyObj) {
  let resp;
  try {
    resp = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
  } catch (err) {
    throw new SourceError(`woocommerce ${url.pathname}: ${err.message}`);
  }
  if (!resp.ok) {
    throw new SourceError(`woocommerce ${url.pathname}: HTTP ${resp.status}`);
  }
  try {
    return await resp.json();
  } catch (err) {
    throw new SourceError(`woocommerce ${url.pathname}: invalid JSON (${err.message})`);
  }
}

function simpleVariant(p) {
  return { variant_id: `${p.id}-v1`, title: "默认规格", price: Number(p.price),
           available: p.purchasable !== false && p.in_stock !== false };
}

export function mapVariation(v, productId) {
  const title = (v.attributes || [])
    .map((a) => (a && typeof a.option === "string" ? a.option.trim() : ""))
    .filter(Boolean)
    .join(" / ");
  return { variant_id: String(v.id), title: title || `规格 ${v.id}`,
           price: Number(v.price), available: v.purchasable !== false && v.in_stock !== false };
}

function hasValidPrice(p) {
  const raw = typeof p.price === "string" ? p.price.trim() : p.price;
  return raw !== "" && raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

export function mapProduct(p) {
  return {
    product_id: String(p.id),
    title: p.name,
    description: stripHtml(p.short_description || p.description || ""),
    price_min: Number(p.price),
    image_url: p.images?.[0]?.src ?? null,
    url: p.permalink ?? null,
  };
}

export async function fetchWooCommerceCatalog(config, fetchImpl) {
  const source = config.source;
  let page = 1;
  const products = [];
  for (;;) {
    const url = authUrl(source, "/wp-json/wc/v3/products");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PRODUCTS_PER_PAGE));
    url.searchParams.set("status", "publish");
    const batch = await getJson(fetchImpl, url);
    for (const p of batch) {
      if (!hasValidPrice(p)) continue;
      const item = mapProduct(p);
      if (p.type === "variable") {
        const vUrl = authUrl(source, `/wp-json/wc/v3/products/${p.id}/variations`);
        vUrl.searchParams.set("per_page", "100");
        const variations = await getJson(fetchImpl, vUrl);
        item.variants = variations.slice(0, MAX_VARIANTS).map((v) => mapVariation(v, p.id));
      } else {
        item.variants = [simpleVariant(p)];
      }
      products.push(item);
    }
    if (!Array.isArray(batch) || batch.length < PRODUCTS_PER_PAGE) break;
    page += 1;
  }
  return makeSnapshot(config.store, products);
}
