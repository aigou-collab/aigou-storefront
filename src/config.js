/** Configuration loading and validation for the aigou-storefront CLI. */

export class ConfigError extends Error {}

const SOURCE_TYPES = new Set(["woocommerce", "json"]);
const PUBLISH_MODES = new Set(["push", "file"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function requireString(container, field, objectName) {
  if (!container || !isNonEmptyString(container[field])) {
    throw new ConfigError(`${objectName}.${field}: must be a non-empty string`);
  }
}

export function validateConfig(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("config: must be a JSON object");
  }
  const store = raw.store || {};
  requireString(store, "store_id", "store");
  requireString(store, "name", "store");

  const source = raw.source || {};
  if (!SOURCE_TYPES.has(source.type)) {
    throw new ConfigError(`source.type: must be one of ${[...SOURCE_TYPES].join(", ")}`);
  }
  if (source.type === "woocommerce") {
    if (!isHttpUrl(source.base_url)) {
      throw new ConfigError("source.base_url: must be an http(s) URL");
    }
    requireString(source, "consumer_key", "source");
    requireString(source, "consumer_secret", "source");
  } else if (!isNonEmptyString(source.path)) {
    throw new ConfigError("source.path: must be a non-empty string");
  }

  const publish = raw.publish || {};
  if (!PUBLISH_MODES.has(publish.mode)) {
    throw new ConfigError(`publish.mode: must be one of ${[...PUBLISH_MODES].join(", ")}`);
  }
  if (publish.mode === "push") {
    if (!isHttpUrl(publish.catalog_base_url)) {
      throw new ConfigError("publish.catalog_base_url: must be an http(s) URL");
    }
    requireString(publish, "shop_domain", "publish");
  } else if (!isNonEmptyString(publish.path)) {
    throw new ConfigError("publish.path: must be a non-empty string");
  }

  return {
    store: { store_id: store.store_id.trim(), name: store.name.trim(),
             currency: isNonEmptyString(store.currency) ? store.currency : "CNY" },
    source, publish,
  };
}

export function loadConfig(fs, path) {
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`cannot read config ${path}: ${err.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config ${path} is not valid JSON: ${err.message}`);
  }
  return validateConfig(raw);
}
