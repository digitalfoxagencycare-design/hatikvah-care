# HaTikvah Care × Swipe: Product Matching & Image Mapping Audit Report

**Phase:** Phase 1 — Read-Only Product Matching & Image Preservation Audit  
**Audit Timestamp:** 2026-11-12T18:41:00+05:30  
**Target Organization:** M/s. EXL MARKETING / HaTikvah Care  
**Swipe API Base URL:** `https://app.getswipe.in/api/partner`  
**API Documentation Reference:** `https://developers.getswipe.in/introduction`

---

## 1. Scope and Execution Boundaries

* **Audit Mode:** Strict **READ-ONLY Product Matching Audit**.
* **Zero Mutation Guarantee:**
  * No products, categories, stock, prices, HSN, or GST values were created or modified in HaTikvah.
  * No records were created, edited, or deleted in Swipe.
  * No images were overwritten, removed, or attached.
  * No products were published to the website.
  * No code was pushed, merged, or deployed.

---

## 2. Git Branch, Commit, and Environment

* **Git Branch:** `master`
* **Commit Hash:** `8d139c3c9610158ebe89a1557896103f3fa2777b`
* **Hatikvah Care Environment Examined:**
  * **Catalog Source:** Development File Store (`.data/products.json` holding 153 products) and Seed Catalog (`data/catalog.json` holding 149 products).
  * **Static Image Directory:** `apps/web/public/catalog` (150 images) and `apps/web/public/brand` (18 images).
  * **Production MongoDB Comparison:** **NOT VERIFIED / UNAVAILABLE** (The live production MongoDB database is isolated from this development runtime. All matching comparisons in this report are based on the verified local repository store and seed catalog).

---

## 3. Swipe Account Identity Verification

* **Authentication Status:** **VERIFIED (HTTP 200)**.
* **Token Source:** Server-side `SWIPE_API_TOKEN` environment variable.
* **Account Metadata Verified via Token Claims & Headers:**
  * **Company Name:** `M/s. EXL MARKETING`
  * **Company ID:** `906400`
  * **User ID:** `2669420` (`API User`, Partner: `true`, Read-Only: `false`)
* **Verification Caveat:** Direct profile query `/v2/company` is unsupported by the API; company identity is verified via JWT token claims, transaction customer snapshots, and Swipe Dashboard settings.

---

## 4. Product Retrieval & Inventory Summary

All product records were retrieved using the official paginated endpoint `GET /v2/product/list?page={page}&num_records=100`:

| Metric | Count | Notes |
| :--- | :---: | :--- |
| **Swipe Reported Total (`total_records`)** | **499** | Stated by Swipe API response metadata |
| **Actual Unique Swipe Records Retrieved** | **499** | Fetched across 5 complete pages (100+100+100+100+99) |
| **Repeated / Missing Pages** | **0** | No missing pages; 0 duplicates across pages |
| **Swipe Item Types** | **499 Products / 0 Services** | All items belong to `"item_type": "Product"` |
| **Hatikvah Products Examined** | **153** | 149 core seed catalog products + 4 demo catalog entries |
| **Hatikvah Image References** | **154** | Image paths declared across the 153 products |
| **Valid Image Files on Local Disk** | **154** | Verified in `apps/web/public/` |
| **Broken Image References** | **0** | **100% of referenced image files exist on disk** |
| **Shared Images** | **1** | `/brand/exl-logo.jpg` (used by 4 demo Biotique Royal entries) |

---

## 5. Product Matching Results & Category Breakdown

Matching was performed using multi-stage semantic normalization, volume/metric extraction (e.g. `25ml`, `8gms`, `380ml`, `7inch`), brand alias resolution (e.g. `Anchor`, `Bio`/`Biotique`, `Meswak`/`Mesvak`, `Dorco`), and packaging detection.

Summary counts are reported by **distinct, unique Item IDs** to prevent misleading double-counting:

```
+---------------------------------------------------------------------------------------+
| Category                                | Unique Swipe Items | Unique Hatikvah Prods  |
+---------------------------------------------------------------------------------------+
| Category A: Confirmed Matches           |         0          |           0            |
| Category B: High-Confidence Suggestions |        51          |          30*           |
| Category C: Manual-Review Suggestions   |        53          |          63*           |
| Category D: Unmatched Swipe Items       |       395          |         N/A            |
| Category E: Unmatched Hatikvah Products |       N/A          |          75            |
+---------------------------------------------------------------------------------------+
| Total Unique Items Audited              |       499          |         153            |
+---------------------------------------------------------------------------------------+
```
*\* Note on Hatikvah counts: 78 unique Hatikvah products have matches in Category B and/or C (some products matched in both due to multiple candidate variants in Swipe). 153 total - 78 matched = 75 unmatched.*

### Category Definitions:
1. **Category A — Confirmed Matches (0 items):**
   * Requires a pre-existing verified ID mapping or exact SKU match with compatible identity. As the catalogues were created independently, 0 pre-existing link IDs were found.
2. **Category B — High-Confidence Suggestions (51 unique Swipe items):**
   * Unambiguous normalized name matches where brand, product function, unit, and volume/weight metrics match (e.g., Swipe: `Anchor Tooth Paste 8gms` <=> Hatikvah: `Anchor Paste 8 gms` [HC-008]; Swipe: `Bio Green Apple Shampoo 25ml` <=> Hatikvah candidate).
3. **Category C — Manual-Review Suggestions (53 unique Swipe items):**
   * Ambiguous matches requiring human business judgment. For instance, Swipe's `Table Napkin` matches three different Hatikvah linen products (`Table Napkins`, `Satin Band Table Napkins`, `Jacquard Table Napkins`), or single Swipe items with minor volume discrepancies.
4. **Category D — Unmatched Swipe Items (395 unique Swipe items):**
   * Original items existing in Swipe's billing system for which no corresponding product or image exists in the current Hatikvah storefront/admin catalog.
5. **Category E — Unmatched Hatikvah Products (75 unique Hatikvah products):**
   * Current website products that could not be matched against any Swipe original item.
6. **Category F — Data Conflicts (90 review rows):**
   * Matched items where Swipe and Hatikvah differ in HSN code, GST tax rate, or Category. (Per business requirement, Swipe is the preferred master source for HSN, GST, and Category in the later migration phase).

---

## 6. Image Preservation Audit

* **Total Existing Hatikvah Images:** 150 product photography files in `apps/web/public/catalog/` (e.g. `p05-1.jpg` to `p25-6.jpg`) and brand assets in `apps/web/public/brand/`.
* **Broken References:** **0**. All 154 image references across all 153 products exist as valid files on disk.
* **Image Preservation Mapping:**
  * For the **78 matched Hatikvah products**, their exact image paths (`/catalog/pXX-X.jpg`) have been preserved and linked to their candidate Swipe IDs in the review CSV.
  * For the **395 unmatched Swipe items**, there are currently **no existing website images** in Hatikvah. When these items are imported in the future, image assets will need to be supplied or placeholder images assigned.

---

## 7. Review File Location

A complete product-by-product review file has been generated with all 726 candidate review rows:

👉 **[docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv](file:///c:/hatikvah-care/docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv)**

### CSV Structure:
* `match_status`: `HIGH_CONFIDENCE`, `MANUAL_REVIEW`, `UNMATCHED_SWIPE`, `UNMATCHED_HATIKVAH`.
* `match_reason`: Explains why the pair was selected or flagged.
* `swipe_item_id`, `swipe_item_name`, `swipe_item_type`, `swipe_category`, `swipe_hsn`, `swipe_gst_rate`, `swipe_unit`, `swipe_price`.
* `hatikvah_product_id`, `hatikvah_product_name`, `hatikvah_sku`, `hatikvah_category`, `hatikvah_hsn`, `hatikvah_gst_rate`, `hatikvah_unit`.
* `existing_image_paths`: Preserved local image file paths (e.g. `/catalog/p06-2.jpg`).
* `image_file_status`: `VALID_ON_DISK` or `NO_HATIKVAH_IMAGE`.
* `conflict_details`: Details any HSN, GST rate, or Category divergence.
* `review_decision`: **Left blank** for business review and approval (`APPROVE`, `REJECT`, or `CHANGE_MAPPING`).

---

## 8. Proposed Next Implementation Phase (Phase 2 Roadmap)

Once the business team reviews and approves the CSV decisions, the following migration steps are recommended:

1. **Review & Approval Gate:**
   * Business owner/accountant reviews `SWIPE_PRODUCT_MATCHING_REVIEW.csv` and sets `review_decision` to `APPROVE` or `REJECT`.
2. **Catalog Import & Merging Script (`scripts/import-swipe-products.js`):**
   * For **Approved Matches:** Update Hatikvah product record with Swipe's `swipe_id`, official HSN, and GST rate, while **strictly retaining the existing image paths** (`/catalog/pXX-X.jpg`).
   * For **Unmatched Swipe Items (395 items):** Import them into Hatikvah Care with a default `"unassigned-image"` badge so the store admin can upload photos later.
   * For **Unmatched Hatikvah Products (75 items):** Keep them marked as local-only or archive if they are obsolete.
3. **Dry-Run Mode First:** Always execute the import with `--dry-run` to preview all database updates before committing changes.

