/** Argument parsing and orchestration for the aigou-storefront CLI. */

import fs from "node:fs";
import { loadConfig } from "./config.js";
import { fetchWooCommerceCatalog } from "./source-woocommerce.js";
import { readJsonSource } from "./source-json.js";
import { publishFile, publishPush } from "./publish.js";

const USAGE = "usage: aigou-storefront sync [--config <path>] [--register] [--dry-run]";

export function parseArgs(argv) {
  const out = { command: null, configPath: "./aigou-storefront.config.json",
                register: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "sync" && i === 0) out.command = "sync";
    else if (arg === "--register") out.register = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--config") {
      const value = argv[i + 1];
      if (!value) throw new Error(USAGE);
      out.configPath = value;
      i += 1;
    } else throw new Error(USAGE);
  }
  if (out.command !== "sync") throw new Error(USAGE);
  return out;
}

async function loadSnapshot(config, deps) {
  if (config.source.type === "woocommerce") {
    return fetchWooCommerceCatalog(config, deps.fetch);
  }
  return readJsonSource(config, deps.fs.readFileSync);
}

export async function run(argv, deps = {}) {
  const log = deps.log ?? console.log;
  const err = deps.err ?? console.error;
  const d = {
    fetch: deps.fetch ?? globalThis.fetch?.bind(globalThis),
    fs: deps.fs ?? fs,
    log, err,
  };
  try {
    const args = parseArgs(argv);
    const config = loadConfig(d.fs, args.configPath);
    const snapshot = await loadSnapshot(config, d);
    if (args.dryRun) {
      log(`[dry-run] store ${snapshot.store.store_id} currency ${snapshot.store.currency} `
          + `products ${snapshot.products.length}`);
      for (const p of snapshot.products.slice(0, 5)) log(`  ${p.product_id}: ${p.title}`);
      return 0;
    }
    if (config.publish.mode === "push") {
      const out = await publishPush(snapshot, config,
                                    { fetchImpl: d.fetch, register: args.register });
      log(`pushed ${out.products} products to ${config.publish.catalog_base_url}`
          + (out.registered ? " (registered)" : ""));
    } else {
      const out = await publishFile(snapshot, config,
                                    { writeFile: d.fs.writeFileSync });
      log(`wrote ${out.path} (${out.products} products)`);
    }
    return 0;
  } catch (e) {
    err(`aigou-storefront: ${e.message}`);
    return 1;
  }
}
