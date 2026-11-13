import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runEnrichment } from "../../../scripts/enrich-original-products.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const CATALOG_PATH = path.resolve(REPO_ROOT, "data/catalog.json");
const REPORT_CSV_PATH = path.resolve(REPO_ROOT, "docs/ORIGINAL_PRODUCTS_ENRICHMENT_MAP.csv");

describe("Original 149 Products Enrichment Verification", () => {
  it("data/catalog.json has all 149 products enriched with HSN, GST rate, and description", () => {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    const catalog = JSON.parse(raw);
    assert.equal(catalog.products.length, 149);

    for (const p of catalog.products) {
      assert.ok(p.sku.startsWith("HC-"), `SKU must be valid: ${p.sku}`);
      assert.ok(p.hsn && p.hsn.length >= 4, `Product ${p.sku} must have valid HSN code: ${p.hsn}`);
      assert.ok([0, 5, 12, 18, 28].includes(p.gstRate), `Product ${p.sku} must have valid GST rate: ${p.gstRate}`);
      assert.ok(p.description && p.description.trim().length > 10, `Product ${p.sku} must have descriptive text`);
      assert.ok(p.images && p.images.length >= 1 && p.images.every(img => img.startsWith("/catalog/")), `Product ${p.sku} must preserve photo: ${p.images?.[0]}`);
    }
  });

  it("dry-run is idempotent and reports 100% coverage", async () => {
    const res = await runEnrichment({ apply: false });
    assert.equal(res.enrichedCount, 149);
    assert.equal(res.preservedImagesCount, 149);
    assert.equal(res.enrichedHsnCount, 149);

    const csvContent = fs.readFileSync(REPORT_CSV_PATH, "utf8");
    const lines = csvContent.split("\n").filter(Boolean);
    assert.equal(lines.length, 150); // header + 149 rows
  });
});
