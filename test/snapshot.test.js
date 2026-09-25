import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_ID, makeSnapshot, stripHtml, validateSnapshotDoc } from "../src/snapshot.js";

test("SCHEMA_ID matches the server-side contract", () => {
  assert.equal(SCHEMA_ID, "aigou/catalog@1");
});

test("stripHtml removes tags, blocks, entities and collapses whitespace", () => {
  assert.equal(stripHtml("<p>竹制&nbsp;腕托</p>\n<div>87 键</div>"), "竹制 腕托 87 键");
  assert.equal(stripHtml('<style>a{}</style><script>x</script>保留<b>加粗</b>'), "保留加粗");
  assert.equal(stripHtml("&lt;a &amp; b &quot;c&quot; &#39;d&#39;"), '<a & b "c" \'d\'');
  assert.equal(stripHtml(42), "");
});

test("makeSnapshot wraps store and defaults variants", () => {
  const doc = makeSnapshot({ store_id: "acme", name: "Acme", currency: "USD" },
                           [{ product_id: "p1", title: "T", price_min: 9.9 }]);
  assert.equal(doc.schema, SCHEMA_ID);
  assert.deepEqual(doc.store, { store_id: "acme", name: "Acme", currency: "USD" });
  assert.deepEqual(doc.products[0].variants, []);
});

test("validateSnapshotDoc accepts good docs and rejects bad ones", () => {
  const good = makeSnapshot({ store_id: "a", name: "A" }, []);
  assert.equal(validateSnapshotDoc(good), good);
  assert.throws(() => validateSnapshotDoc({ schema: "aigou/catalog@9", store: {}, products: [] }), /schema/);
  assert.throws(() => validateSnapshotDoc({ schema: SCHEMA_ID, store: {} }), /store/);
  assert.throws(() => validateSnapshotDoc({ schema: SCHEMA_ID, store: { store_id: "a" } }), /products/);
});
