# HaTikvah Care × Swipe: Verified 499-Item Catalogue Extraction & Reconciliation Report

**Audit Phase:** Phase 1 — Original Catalogue Extraction, Deduplication, and Field Inventory  
**Date of Verified Snapshot:** 2026-11-12T18:41:00+05:30  
**Current Audit Timestamp:** 2026-11-12T19:40:00+05:30  
**Target Organization:** M/s. EXL MARKETING / HaTikvah Care  
**Swipe API Base URL:** `https://app.getswipe.in/api/partner`  
**Swipe Item API Reference:** `GET /v2/product/list`  
**Official API Docs:** `https://developers.getswipe.in/introduction`

---

## 1. Scope and Execution Boundaries

* **Audit Mode:** Strict **READ-ONLY Extraction & Deduplication**.
* **Integrity Guarantee:**
  * No items, categories, or prices were created, modified, or deleted in Swipe.
  * No products, stock, or ledger entries were imported or updated in HaTikvah.
  * No website product images or database documents were altered.
  * No tokens, headers, or customer PII were exposed.

---

## 2. Company Identity Verification Status

* **Authentication Result:** **AUTHENTICATED (HTTP 200)**.
* **Credential Used:** Server-side `SWIPE_API_TOKEN` environment variable.
* **Account Claims & Transaction Metadata:**
  * **Company Name:** `M/s. EXL MARKETING`
  * **Company ID:** `906400`
  * **API User ID:** `2669420`
* **Account Verification Boundary:**
  * Decoding JWT claims alone does not constitute independent proof of account identity. Independent confirmation is established by the matching company name on active invoice headers (`INV2627/442`) and the client's registered GSTIN (`36AAALG4976H1ZV`). Direct company profile endpoints (`/v2/company`) are not exposed by the Swipe partner API.

---

## 3. Extraction Method & Pagination Verification

* **Endpoint:** `GET /v2/product/list?page={page}&num_records=100`
* **Pagination Settings:** Max supported batch size of 100 records per page.
* **Per-Page Retrieval Log:**
  * **Page 1:** 100 records (IDs 2 through 106)
  * **Page 2:** 100 records (IDs 107 through 209)
  * **Page 3:** 100 records (IDs 210 through 314)
  * **Page 4:** 100 records (IDs 315 through 417)
  * **Page 5:** 99 records (IDs 418 through 521)
  * **Page 6:** 0 records (Stop condition met)
* **Reconciliation Results:**
  * **API-Reported Total (`total_records`):** **499**
  * **Total Records Retrieved Across All Pages:** **499**
  * **Total Verified Unique Swipe Item IDs:** **499**
  * **Repeated Pages:** **0**
  * **Duplicate IDs Across Pages:** **0**
* **Verification Status:** **COMPLETE & RECONCILED (499 / 499)**.

---

## 4. Anchor Paste Investigation & Duplication Root Cause

### Business Question:
> *"Why did Anchor Paste appear four or five times in the previous review, when the business confirms it exists only once in Swipe?"*

### Investigation Findings & Evidence:

1. **Items in Swipe Containing "Anchor":**
   There are **only two** products in the entire 499-item Swipe catalogue containing the word "Anchor":
   * **Item 1 (Swipe ID: 6):** `Anchor Comfort Clean Tooth Brush` | HSN: `96032100` | GST: `5%` | Unit: `NOS` | Price: `₹0`
   * **Item 2 (Swipe ID: 10):** `Anchor Tooth Paste 8gms` | HSN: `33061020` | GST: `5%` | Unit: `NOS` | Price: `₹0`

2. **Anchor Paste Count in Swipe:**
   There is **EXACTLY ONE** Anchor Paste item in the Swipe catalogue:
   * **Swipe ID:** `10`
   * **Exact Name in Swipe:** `"Anchor Tooth Paste 8gms"`
   * **Appearance Count in Swipe API Responses:** **1 time** (Page 1, 0 duplicate occurrences in Swipe).

3. **Why It Appeared Multiple Times in the Previous Review File:**
   The previous file `docs/SWIPE_PRODUCT_MATCHING_REVIEW.csv` was a **candidate-matching review table**, not the original Swipe catalogue. Because `Anchor Tooth Paste 8gms` had ambiguous keyword overlap with multiple Hatikvah website products, the matching script generated one row for each potential candidate to allow human review:
   * **Row 3:** Swipe ID `10` <=> Hatikvah `HC-001` (`Hotel Dental Kit – Anchor Toothbrush with Anchor Paste (1+1)`)
   * **Row 4:** Swipe ID `10` <=> Hatikvah `HC-002` (`Hotel Dental Kit – Anchor Toothbrush with Anchor Paste (1+2)`)
   * **Row 5:** Swipe ID `10` <=> Hatikvah `HC-003` (`Hotel Dental Kit – Anchor Toothbrush with Meswak Paste (1+1)`)
   * **Row 6:** Swipe ID `10` <=> Hatikvah `HC-004` (`Hotel Dental Kit – Anchor Toothbrush with Meswak Paste (1+2)`)
   * **Row 7:** Swipe ID `10` <=> Hatikvah `HC-008` (`Anchor Paste 8 gms`)

### Conclusion on Root Cause:
* **The repetition was Cause (a): Multiple Hatikvah product candidates for one single Swipe product.**
* There was no deduplication bug and no repeated API pages.
* In the newly generated clean catalogue (`docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv`), **`Anchor Tooth Paste 8gms` appears EXACTLY ONCE (Line 10)**.

---

## 5. Field Completeness & Data Inventory (499 Items)

Every item in the verified catalogue was analyzed across all available API fields:

| Field Name | Source API Key | Populated Count | Missing / Blank Count | Notes |
| :--- | :--- | :---: | :---: | :--- |
| **Swipe Item ID** | `swipe_id` | **499 (100%)** | 0 | Stable permanent integer ID |
| **Partner Product ID** | `id` | **0 (0%)** | 499 (All null) | Null for native items |
| **Item Name** | `name` | **499 (100%)** | 0 | 100% complete product titles |
| **Item Type** | `item_type` | **499 (100%)** | 0 | 100% "Product" (0 Services) |
| **Category** | `category` | **0 (0%)** | 499 (100% blank) | Unassigned in Swipe account |
| **HSN/SAC Code** | `hsn_code` | **468 (93.8%)** | 31 (6.2% blank) | Preserved as text |
| **GST Percentage** | `tax_rate` | **488 (97.8%)** | 11 (2.2% are 0%) | Valid rates (5%, 12%, 18%, 28%) |
| **Unit of Measure** | `unit` | **493 (98.8%)** | 6 (1.2% blank) | e.g. NOS, PCS, BOX, SET |
| **Unit Price** | `unit_price` | **5 (1.0%)** | 494 (99.0% are ₹0) | B2B items priced per order |
| **Stock / Quantity** | `quantity` | **365 (73.1%)** | 134 are 0 | Physical balance in Swipe |

### Critical Finding on Product-Level Charges:
* **Item-Specific Charges / CESS / Shipping:** The Swipe product catalog API does **not** expose product-level shipping charges or surcharges. Such charges in Swipe exist only at the **document/invoice level** (e.g. freight on invoices) or when added as distinct service line items.

---

## 6. Live API Limit Notice

During this audit at 19:36 IST, Swipe's API responded with:
```json
{
  "error_code": "DAILY_LIMIT_EXCEEDED",
  "message": "You have reached your daily API usage limit. To adjust your limit, please visit: https://app.getswipe.in/user?tab=api_integration.",
  "success": false
}
```
* **Impact Assessment:** This limit was reached due to cumulative automated queries during today's audit sessions.
* **Catalogue Completeness:** Our complete 499-item extraction was successfully executed and stored during the earlier session (`2026-11-12T18:41:00+05:30`) and verified with 100% data integrity.
* **Action Required:** If future automated real-time syncing requires higher query volumes, the business owner can increase the daily limit under **Settings > API Integration** in the Swipe Dashboard.

---

## 7. Output Files Generated

1. **Clean Verified Catalogue (Excel-ready CSV):**
   👉 **[docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv](file:///c:/hatikvah-care/docs/SWIPE_VERIFIED_PRODUCT_CATALOG.csv)**
   * **Exact 499 data rows** (1 row per unique Swipe item ID).
   * 0 Hatikvah candidate rows mixed in.
   * Protected against formula injection (`=`, `+`, `-`, `@`).
   * Text-safe formatting for HSN codes and IDs.

2. **Data Dictionary:**
   👉 **[docs/SWIPE_CATALOG_DATA_DICTIONARY.csv](file:///c:/hatikvah-care/docs/SWIPE_CATALOG_DATA_DICTIONARY.csv)**
   * Full mapping between CSV columns, Swipe raw keys, types, and completeness.

3. **Automated Test Suite:**
   👉 `apps/api/test/swipe-catalog-extraction.test.js`
   * 7 unit tests covering 5-page pagination, rate limits, deduplication, and formula protection (All passing).

---

## 8. Summary & Next Steps

* **Status:** **COMPLETE & VERIFIED.** The 499-item original Swipe catalogue is fully isolated, deduplicated, and documented.
* **Next Phase:** In the upcoming Phase 2 session, we will map this verified 499-item list to Hatikvah products with a strict 1-to-1 matching interface, preserving all existing website images without creating multiple ambiguous rows.

