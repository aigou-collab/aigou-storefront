/** Reads a merchant-maintained aigou/catalog@1 snapshot file as the source. */

import { validateSnapshotDoc } from "./snapshot.js";

export function readJsonSource(config, readFileSync) {
  const path = config.source.path;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read source ${path}: ${err.message}`);
  }
  try {
    return validateSnapshotDoc(JSON.parse(text));
  } catch (err) {
    throw new Error(`source ${path} is not a valid aigou snapshot: ${err.message}`);
  }
}
