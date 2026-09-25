/** Delivers a snapshot to the catalog service (push) or a self-hosted file. */

export class PublishError extends Error {}

async function postJson(fetchImpl, url, body) {
  let resp;
  try {
    resp = await fetchImpl(url.toString(),
      { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch (err) {
    throw new PublishError(`publish ${url.pathname}: ${err.message}`);
  }
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const snippet = JSON.stringify(payload).slice(0, 120);
    throw new PublishError(`publish ${url.pathname}: HTTP ${resp.status} ${snippet}`);
  }
  return payload;
}

export async function publishPush(snapshot, config, { fetchImpl, register = false }) {
  const base = config.publish.catalog_base_url.replace(/\/+$/, "");
  const out = {};
  if (register) {
    const url = new URL("/stores", base);
    const registration = {
      store_id: snapshot.store.store_id,
      name: snapshot.store.name,
      shop_domain: config.publish.shop_domain,
      endpoint_type: "none",
    };
    if (config.mcp) {
      if (!config.mcp.public_base_url) {
        throw new PublishError("mcp.public_base_url is required to register an mcp endpoint");
      }
      registration.endpoint_type = "mcp";
      registration.mcp_url = `${config.mcp.public_base_url}/mcp`;
      registration.mcp_token = config.mcp.token;
    }
    const payload = await postJson(fetchImpl, url, JSON.stringify(registration));
    out.registered = payload.updated !== true;
  }
  const catalogUrl = new URL(`/stores/${encodeURIComponent(snapshot.store.store_id)}/catalog`, base);
  const payload = await postJson(fetchImpl, catalogUrl, JSON.stringify(snapshot));
  out.products = payload.products;
  return out;
}

export async function publishFile(snapshot, config, { writeFile }) {
  const path = config.publish.path;
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n");
  return { path, products: snapshot.products.length };
}
