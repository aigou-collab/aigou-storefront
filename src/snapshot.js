/** Builds and validates aigou/catalog@1 snapshot documents. */

export const SCHEMA_ID = "aigou/catalog@1";

const BLOCK_RE = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
                   "&#39;": "'", "&nbsp;": " " };

export function stripHtml(html) {
  if (typeof html !== "string") return "";
  let text = html.replace(BLOCK_RE, " ").replace(TAG_RE, "");
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  return text.replace(/\s+/g, " ").trim();
}

export function makeSnapshot(store, products) {
  return {
    schema: SCHEMA_ID,
    store: { store_id: store.store_id, name: store.name,
             currency: store.currency || "CNY" },
    products: products.map((p) => ({ ...p, variants: p.variants ?? [] })),
  };
}

export function validateSnapshotDoc(doc) {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("snapshot: must be a JSON object");
  }
  if (doc.schema !== SCHEMA_ID) {
    throw new Error(`snapshot.schema: expected ${SCHEMA_ID}, got ${String(doc.schema)}`);
  }
  if (!doc.store || typeof doc.store.store_id !== "string" || !doc.store.store_id) {
    throw new Error("snapshot.store.store_id: required");
  }
  if (!Array.isArray(doc.products)) {
    throw new Error("snapshot.products: must be an array");
  }
  return doc;
}
