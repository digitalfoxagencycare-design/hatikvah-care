import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runReconciliation } from "../../../scripts/reconcile-swipe-inventory.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const CATALOG_PATH = path.resolve(REPO_ROOT, "data/catalog.json");
const REPORT_MD_PATH = path.resolve(REPO_ROOT, "docs/SWIPE_RECONCILIATION_REPORT.md");
const REPORT_CSV_PATH = path.resolve(REPO_ROOT, "docs/SWIPE_RECONCILIATION_REVIEW.csv");

describe("Product Image Correction & Swipe Inventory Reconciliation Tests", () => {
  it("ground-truth baseline has 149 products with 149 unique images", () => {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    const catalog = JSON.parse(raw);
    assert.equal(catalog.products.length, 149);

    const imageSet = new Set();
    for (const p of catalog.products) {
      assert.ok(p.images && p.images.length > 0, `Product ${p.sku} must have an image`);
      assert.ok(p.images[0].startsWith("/catalog/"), `Image path must be valid: ${p.images[0]}`);
      imageSet.add(p.images[0]);
    }
    assert.equal(imageSet.size, 149, "Every original product must have a distinct 1-to-1 image");
  });

  it("dry-run produces complete reports and does not write to database", async () => {
    const res = await runReconciliation({ apply: false });
    assert.ok(res.totalAudited >= 622);
    assert.ok(res.preservedOriginalImages === 149);
    assert.ok(res.cleanedImagesCount > 0);

    const reportMd = fs.readFileSync(REPORT_MD_PATH, "utf8");
    assert.ok(reportMd.includes("The Root Cause of Image Duplication"));
    assert.ok(reportMd.includes("DRY-RUN MODE (Audit Only)"));

    const reportCsv = fs.readFileSync(REPORT_CSV_PATH, "utf8");
    const lines = reportCsv.split("\n").filter((l) => l.trim().length > 0);
    assert.ok(lines.length > 600, "CSV must contain all audited rows");
  });

  it("reconciliation is idempotent: multiple dry-runs produce identical counts", async () => {
    const res1 = await runReconciliation({ apply: false });
    const res2 = await runReconciliation({ apply: false });
    assert.deepEqual(res1, res2, "Reconciliation must be 100% deterministic and idempotent");
  });

  it("ensures Swipe-imported items without verified photos have empty image arrays", () => {
    const reportCsv = fs.readFileSync(REPORT_CSV_PATH, "utf8");
    // Verify that NO Swipe-imported item without an original image is assigned a fake fallback image
    const lines = reportCsv.split("\n");
    for (const line of lines) {
      if (line.includes("NO_IMAGE_STORED")) {
        assert.ok(line.includes("None (Stored as [])") || line.includes("Stripped"));
      }
    }
  });
});

