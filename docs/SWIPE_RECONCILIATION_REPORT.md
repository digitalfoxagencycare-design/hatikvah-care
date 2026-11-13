# HaTikvah Care × Swipe: Product Image Correction & Inventory Reconciliation Report

**Audit & Execution Phase:** Phase 1 & 2 (Dry-Run Reconciliation & Root Cause Analysis)  
**Execution Timestamp:** 2026-11-13T22:59:54.368Z  
**Target Organization:** M/s. EXL MARKETING / HaTikvah Care  
**Active Execution Mode:** **DRY-RUN MODE (Audit Only)**  

---

## 1. Executive Summary & Root Cause Investigation

### The Root Cause of Image Duplication:
The investigation into the previous catalog merge identified the exact mechanism causing duplicate images:

1. **Shared Fallback Image Stored as Product Data:**
   In the previous `scripts/merge-swipe-catalog.js` implementation, an object dictionary `CATEGORY_DEFAULT_IMAGE` was defined (e.g. `"guest-amenities": "/catalog/p05-1.jpg"`, `"bath-body": "/catalog/p11-1.jpg"`, `"hotel-linen": "/catalog/p34-1.jpg"`). When Swipe items with no image were imported, the script assigned `images: [CATEGORY_DEFAULT_IMAGE[cat]]`.
2. **Impact on Production Database:**
   This resulted in:
   * `/catalog/p05-1.jpg` (the specific photo of *Hotel Dental Kit – Anchor Toothbrush 1+1*) being copied into **301 unrelated products**!
   * `/catalog/p11-1.jpg` being copied into **93 unrelated products**!
   * `/catalog/p27-1.jpg` and `/catalog/p31-1.jpg` each copied into **32 unrelated products**!
3. **The Solution Implemented Here:**
   * **Separation of Storage vs Display Placeholder:** Stored product records in the database must store `images: []` (an empty array) when no genuine verified photo exists.
   * **Frontend Display Behavior:** The application's existing visual helper (`<Photo src={p.images[0]} />` in `apps/web/src/admin/visual.jsx`) already gracefully renders `<span className="ph none"><Icon name="product" /></span>` (a clean, neutral vector product icon) whenever an image is empty or null.
   * **100% Original Image Preservation:** All 149 original website products retain their verified, unique 1-to-1 photographs from `data/catalog.json`. Exactly 0 original images are overwritten or deleted.

---

## 2. Inventory Metrics & Reconciliation Breakdown

| Reconciliation Category | Item Count | Status / Resolution |
| :--- | :---: | :--- |
| **Total Products Audited** | **646** | Consolidated catalog |
| **Original HaTikvah Website Products** | **149** | 100% Original verified images preserved |
| **Confirmed High-Confidence Swipe Matches** | **2** | Reconciled HSN, GST, and pricing |
| **Ambiguous Matches Flagged for Review** | **10** | Left untouched; flagged in review CSV |
| **Unmatched Original Website Products** | **147** | Preserved with original photos & IDs |
| **Swipe Inventory Items (No Image)** | **497** | **Duplicate images stripped (`images: []`)** |
| **Client-Specific Branded Items Isolated** | **4** | Tenant-boundary protection enforced |

---

## 3. High-Confidence Verified Matches (Sample)

The following products have verified 1-to-1 identity matches where Swipe's official GSTIN HSN codes and tax rates were reconciled while preserving the product's verified photo:

| Product Name & SKU | Verified Photo (Preserved) | Swipe Match ID & Title | Reconciled HSN | GST Rate | Price |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Anchor Paste 8 gms** (`HC-008`) | `/catalog/p06-2.jpg` | ID 10: *Anchor Tooth Paste 8gms* | `33061020` | **5%** | Price on Request |
| **Bamboo Comb** (`HC-023`) | `/catalog/p08-5.jpg` | ID 448: *Bamboo Comb* | `96151900` | **5%** | Price on Request |

---

## 4. Ambiguous Matches Flagged for Manual Review

The following items have multiple competing variants in Swipe or volume differences, and were intentionally **NOT merged** to avoid data corruption:

| Web Product Name & SKU | Issue Detected | Competing Swipe Candidate IDs | Recommendation |
| :--- | :--- | :--- | :--- |
| **Hotel Dental Kit – Anchor Toothbrush with Anchor Paste (1+1)** (`HC-001`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **Hotel Dental Kit – Anchor Toothbrush with Anchor Paste (1+2)** (`HC-002`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **Hotel Dental Kit – Anchor Toothbrush with Meswak Paste (1+1)** (`HC-003`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **Hotel Dental Kit – Anchor Toothbrush with Meswak Paste (1+2)** (`HC-004`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **Hotel Shaving Kit – Dorco Razor with Oxylife Shaving Gel Sachet** (`HC-005`) | AMBIGUOUS_KIT_VARIANT | ID 28 ("Shaving Kit (Glide Gel & Superm)"); ID 40 ("Printed Laminated Paper Pouch (49101910) Green Shaving Kit GBTR"); ID 303 ("Biotique Shaving Kit (Sachet) - Standard") | Retain as separate items until reviewed in CSV |
| **BIO Dental Kit** (`HC-028`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **BIO Dental Kit – Double Brush** (`HC-029`) | AMBIGUOUS_KIT_VARIANT | ID 39 ("Printed Laminated Paper Pouch (48101910) Green Dental Kit GBTR"); ID 297 ("Biotique - Dental Kit - Single Brush with BIO Paste - In Butter Paper") | Retain as separate items until reviewed in CSV |
| **BIO Shaving Kit – Premium** (`HC-030`) | AMBIGUOUS_KIT_VARIANT | ID 28 ("Shaving Kit (Glide Gel & Superm)"); ID 40 ("Printed Laminated Paper Pouch (49101910) Green Shaving Kit GBTR"); ID 303 ("Biotique Shaving Kit (Sachet) - Standard") | Retain as separate items until reviewed in CSV |
| **BIO Shaving Kit – Premium (Style 2)** (`HC-031`) | AMBIGUOUS_KIT_VARIANT | ID 28 ("Shaving Kit (Glide Gel & Superm)"); ID 40 ("Printed Laminated Paper Pouch (49101910) Green Shaving Kit GBTR"); ID 303 ("Biotique Shaving Kit (Sachet) - Standard") | Retain as separate items until reviewed in CSV |
| **BIO Shaving Kit – Generic (Wooden Razor)** (`HC-033`) | AMBIGUOUS_KIT_VARIANT | ID 28 ("Shaving Kit (Glide Gel & Superm)"); ID 40 ("Printed Laminated Paper Pouch (49101910) Green Shaving Kit GBTR"); ID 303 ("Biotique Shaving Kit (Sachet) - Standard") | Retain as separate items until reviewed in CSV |

---

## 5. Client / Tenant Boundary Enforcement

In Swipe's historical database, several custom-manufactured products contain specific hotel client branding (e.g., Radisson, Golkonda, Lemon Tree, Novotel).
* **Isolation Rule:** These items are preserved as distinct SKU items (`SW-XXXX`) and **never merged into generic catalogue items** (`HC-013` laundry bag or `HC-125` table napkins).
* **Image Safety:** Client-branded items are created with `images: []` so generic catalogue photography is never falsely associated with customized client printing.

---

## 6. Backup & Restoration Verification

* **Timestamped Backup File:** `backups/products-backup-2026-11-13T03-24-49-797Z.json`
* **Baseline Seed Ground Truth:** `data/catalog.json` (149 products with 149 verified images).
* **Restoration Procedure:**
  In the event of any rollback requirement, the database can be restored at any time by running:
  ```bash
  node scripts/restore-products-backup.js backups/products-backup-2026-11-13T03-24-49-797Z.json
  ```
