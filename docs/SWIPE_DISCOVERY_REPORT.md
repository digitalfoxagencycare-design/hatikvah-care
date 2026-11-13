# HaTikvah Care × Swipe: Read-Only Data Discovery & Mapping Report

**Document Version:** 1.0.0 (Read-Only Audit Phase)  
**Date:** 2026-11-12  
**Target Organization:** M/s. EXL MARKETING / HaTikvah Care  
**Swipe Base URL:** `https://app.getswipe.in/api/partner`  
**API Documentation Reference:** `https://developers.getswipe.in/introduction`

---

## 1. Repository Branch and Commit Reviewed

* **Repository Working Copy:** `C:\hatikvah-care`
* **Active Git Branch:** `master`
* **Commit Hash:** `8d139c3c9610158ebe89a1557896103f3fa2777b` (`feat(core): logistics, whatsapp outbox, and doc improvements`)
* **Uncommitted Changes Status:** No functional source code modified during this audit. Only new local diagnostic scripts (`scripts/swipe-audit.js`) and test suite (`apps/api/test/swipe-audit.test.js`) added.

---

## 2. Scope and Environment Examined

* **Audit Mode:** Strict **READ-ONLY Discovery**.
  * No records created, updated, or voided in Swipe.
  * No stock movements or ledger adjustments posted in HaTikvah.
  * No WhatsApp notifications or emails dispatched.
  * No production configurations altered.
* **Hatikvah Care Environment Examined:**
  * **Store Layer:** Development File Store (`.data/` directory fallback from local MongoDB).
  * **Live Production Database Comparison:** Marked **UNAVAILABLE** (as production MongoDB is isolated and not connected to this local development runtime).
* **Credential Source:** Configured via `SWIPE_API_TOKEN` in `.env` (kept server-side only; never committed, printed, or exported).

---

## 3. Swipe Account Verification Status

* **Authentication Result:** **SUCCESS (HTTP 200)**.
* **API Version:** `v2` (official partner API).
* **JWT Claims & Company Metadata:**
  * **Declared Company Name:** `M/s. EXL MARKETING`
  * **Declared Company ID:** `906400`
  * **User ID:** `2669420` (`API User`, Partner: `true`, Read-Only: `false`)
* **Verification Caveat:**
  * While the JWT claims and live transactions (invoices, company name on bills) match `M/s. EXL MARKETING` and ID `906400`, the Swipe API does not expose a standalone `/v2/company` or `/v1/company` profile endpoint (returns HTTP 404). Verification is established through JWT claims and transaction headers. Formal confirmation remains visible in the Swipe Dashboard under **Settings > Company Profile**.

---

## 4. API Endpoint Coverage and Record Counts

All data was queried via strict GET requests using polite rate pacing (200ms sleep) and exponential backoff on HTTP 429:

| Data Category | HTTP Endpoint Tested | HTTP Status | Total Records in Swipe | Notes / Status |
| :--- | :--- | :---: | :---: | :--- |
| **Customers** | `/v2/customer/list` | 200 | **178** | Complete party directory |
| **Vendors** | `/v2/vendor/list` | 200 | **14** | Active supplier list |
| **Products / Items** | `/v2/product/list` | 200 | **499** | Complete SKU catalog |
| **Tax Invoices** | `/v2/doc/list?document_type=invoice` | 200 | **1,261** | Historical & active invoices |
| **Estimates / Quotes** | `/v2/doc/list?document_type=estimate` | 200 | **55** | Estimates / quotations |
| **Purchases** | `/v2/doc/list?document_type=purchase` | 200 | **21** | Inward purchase entries |
| **Delivery Challans** | `/v2/doc/list?document_type=delivery_challan` | 200 | **0** | No records found in account |
| **Purchase Orders** | `/v2/doc/list?document_type=purchase_order` | 200 | **0** | No records found in account |
| **Credit Notes** | `/v2/doc/list?document_type=credit_note` | 400 | N/A | Validation error on doc type |
| **Debit Notes** | `/v2/doc/list?document_type=debit_note` | 400 | N/A | Validation error on doc type |
| **Payments** | `/v2/payment/list?status=all` | 200 | **1,187** | Payment transaction receipts |
| **Warehouses** | `/v2/warehouse/list` | 404 | N/A | Endpoint unsupported/disabled |

---

## 5. Date Ranges and Completeness Limitations

* **Historical Span Discovered:**
  * **Earliest Invoice:** `INV-2` dated **24-02-2024**
  * **Most Recent Invoice:** `INV2627/442` dated **12-11-2026**
  * **Active Lifespan:** ~2 years and 9 months of continuous billing history in Swipe.
* **Pagination Constraints:**
  * Document and payment list endpoints paginate at a default page size of 10 (`page=1, 2, ...`).
  * Product and customer lists paginate at 25 items per page.
  * Bounded date-window querying (`start_date=DD-MM-YYYY&end_date=DD-MM-YYYY`) is mandatory for document and payment endpoints.
* **Rate Limits:** Documented limit of ~60 requests/minute. The audit tool uses exponential backoff to ensure zero throttling.

---

## 6. Data Field Inventory

### A. Products (`/v2/product/list`)
* **Available Fields:** `id`, `name`, `quantity` (stock), `unit_price`, `tax_rate`, `price_with_tax`, `discount_percent`, `description`, `hsn_code`, `item_type`, `unit`, `category`, `swipe_id`, `developer_note`.
* **Missing Fields:** Multi-level packaging breakdown (e.g. piece vs inner pack vs master carton), batch allocations (mfg/exp date not exposed in product list).

### B. Customers (`/v2/customer/list`)
* **Available Fields:** `customer_id`, `name`, `phone`, `email`, `gstin`, `swipe_id`, `developer_note`.
* **Document Customer Snapshot:** When retrieved inside an invoice, additional fields are present: `company_name`, `country_code`, `phone_number`.
* **Missing Fields:** Explicit state code (must be extracted from the first two digits of GSTIN or address).

### C. Invoices (`/v2/doc/list` & `/v2/doc/{hash_id}`)
* **Header Fields:** `serial_number`, `document_date`, `due_date`, `customer` / `party`, `net_amount`, `tax_amount`, `total_amount`, `amount_paid`, `amount_pending`, `payment_status`, `payments`, `notes`, `terms`, `hash_id`.
* **Line Item Detail (via `/v2/doc/{hash_id}`):** `id`, `name`, `quantity`, `unit_price`, `tax_rate`, `price_with_tax`, `net_amount`, `total_amount`, `discount_percent`, `discount_amount`, `hsn_code`, `unit`, `category`.

### D. Payments (`/v2/payment/list`)
* **Available Fields:** `total_amount`, `amount_remaining`, `bank_details` (account, ifsc, bank_name, branch), `customer`, `payment_date`, `payment_mode`, `payment_type`, `status`, `linked_docs`.

---

## 7. Observed Invoice and Document Series

From sampling historical records across 2024, 2025, and 2026, three distinct sequential patterns were identified:

```
+------------------+---------------------+-------------------+-------------------------------+
| Document Type    | Observed Period     | Numbering Pattern | Example Range                 |
+------------------+---------------------+-------------------+-------------------------------+
| Tax Invoice (V1) | 02-2024 to 03-2025  | INV-<Number>      | INV-2 ... INV-531             |
| Tax Invoice (V2) | FY 2025-26          | INV2526/<Number>  | INV2526/1 ... INV2526/134     |
| Tax Invoice (V3) | FY 2026-27 (Current)| INV2627/<Number>  | INV2627/1 ... INV2627/442     |
| Estimates        | Continuous          | EST-<Number>      | EST-1 ... EST-56              |
| Purchases        | 2024                | PINV-<Number>     | PINV-1 ... PINV-23            |
+------------------+---------------------+-------------------+-------------------------------+
```

### Series Findings & Behavioral Distinctions:
1. **Series Inferred from Data:** Invoices reset annually with the Indian Financial Year prefix (`INV2526/` for FY 2025-26, `INV2627/` for FY 2026-27).
2. **Hatikvah Care vs. Swipe Series Conflict:**
   * HaTikvah native series: `INV/2026-27/0001` (16 chars max, with forward slashes).
   * Swipe series: `INV2627/442` (compact financial year representation).
3. **Automatic Numbering:** Cannot be verified in read-only mode without executing a creation request. **Must be validated in a staging/sandbox test company before live production integration.**

---

## 8. Hatikvah Schema and Lifecycle Findings

* **Monetary Units:** HaTikvah Care strictly calculates and stores all monetary values in integer **paise** (`price`, `rate`, `amount`, `totals.total`). Swipe operates in decimal **rupees** (`10.75`). Data exchange must always apply exact integer scaling (`rate / 100` and `Math.round(rupees * 100)`).
* **GST Engine:** Handled by `apps/api/src/lib/gst.js`. Same-state places of supply generate CGST + SGST; inter-state supplies generate IGST. Swipe mirrors this logic based on customer state/GSTIN.
* **Packaging & Inventory:** HaTikvah tracks stock in discrete units with pack multipliers (`piece` -> `inner pack` -> `master carton` via `src/lib/units.js`). Swipe stores raw quantity (`quantity`). Line items passed to Swipe must declare ordered pieces or explicit pack rates.
* **Stock Deductions:** In HaTikvah, stock is consumed when an invoice is raised (`deductForInvoice`) or upon delivery challan dispatch (`dispatchOrder`). If an invoice originating in Swipe is synced back, care must be taken not to deduct stock twice.

---

## 9. Mapping Table & Comparison (Local Development vs. Swipe)

| Domain | Hatikvah Schema Field | Swipe API Field | Mapping Logic / Conversion |
| :--- | :--- | :--- | :--- |
| **Product ID** | `product.id` | `item.id` / `swipe_id` | Save `swipeId` on Hatikvah product record |
| **Product Price**| `product.price` (paise) | `item.unit_price` (rupees) | `price / 100` (Hatikvah -> Swipe) |
| **HSN Code** | `product.hsn` | `item.hsn_code` | Direct 1:1 match |
| **GST Rate** | `product.gstRate` (integer) | `item.tax_rate` (integer) | Direct 1:1 match |
| **Customer ID** | `customer.id` | `customer.customer_id` / `swipe_id` | Save `swipeCustomerId` on customer record |
| **Customer Phone**| `customer.phone` (10 digits)| `customer.phone` | Strip non-digits (`\D`), match last 10 digits |
| **Customer GSTIN**| `customer.gstin` | `customer.gstin` | Trim, uppercase match |
| **Invoice Number**| `invoice.number` | `serial_number` | Store `swipeSerialNumber` alongside Hatikvah number |
| **Document Hash**| `invoice.swipeHashId` (new)| `hash_id` | Used to retrieve PDF and verify status |
| **Payment Status**| `invoice.status` | `payment_status` | `unpaid` -> `UNPAID`, `paid` -> `PAID`, `partial` -> `PARTIALLY_PAID` |

* **Local Dev Comparison Summary:**
  * Local Dev Products: 153 (seeded demo catalog). Matches against Swipe production: 0 exact names, 1 HSN overlap.
  * Local Dev Customers: 18. Matches against Swipe production: 1 phone match, 1 GSTIN match.
  * **Conclusion:** The local environment holds demo seed data, while Swipe holds the client's actual production records (499 products, 178 customers, 1,261 invoices).

---

## 10. Risk Analysis & Mitigation

1. **Simultaneous Creation & Sequence Collision:**
   * *Risk:* If an invoice is generated in Hatikvah and simultaneously created by staff in the Swipe mobile/web app, manual serial number assignment will conflict.
   * *Mitigation:* Allow Swipe to automatically allocate the official serial number, and store both the Hatikvah internal order reference (`SO/2026-27/XXXX`) and Swipe invoice number (`INV2627/XXXX`).
2. **Duplicate Stock Deductions:**
   * *Risk:* Hatikvah deducts inventory in `deductForInvoice()`. If an invoice created directly in Swipe is synced into Hatikvah, it could double-decrement warehouse stock.
   * *Mitigation:* Flag inbound Swipe invoices with `origin: 'swipe'` and evaluate whether stock was already deducted in the physical warehouse.
3. **Rounding Drift on GST Fractions:**
   * *Risk:* Differences in per-line rounding vs. document-level rounding could result in a 1–2 paise discrepancy.
   * *Mitigation:* `apps/api/src/lib/gst.js` applies round-off tracking. Verify that Swipe's `net_amount + tax_amount` matches Hatikvah's `totals.total`.
4. **Webhook Sync Loops:**
   * *Risk:* Hatikvah creates invoice in Swipe -> Swipe emits `invoice.created` webhook -> Hatikvah processes webhook and re-posts invoice.
   * *Mitigation:* Use idempotency keys, store `swipeHashId`, and check existence before processing any webhook event.

---

## 11. Recommended Implementation Phases

```
+-----------------------------------------------------------------------------------+
| Phase 1: Test-Company Verification (Controlled Staging)                          |
| - Setup sandbox/test company in Swipe.                                            |
| - Test POST /v2/doc with empty serial_number to verify auto-sequence allocation.  |
| - Verify webhook payload signature and event schema.                              |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
| Phase 2: One-Way Outbound Sync (Hatikvah -> Swipe)                                |
| - Build `apps/api/src/services/swipe.js` service module.                         |
| - On Razorpay payment or Admin POS billing, asynchronously push invoice to Swipe. |
| - Save returned `hash_id` and serial number in Hatikvah database.                 |
| - Deliver Swipe invoice PDF link via existing WhatsApp notification outbox.       |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
| Phase 3: Historical Master Data Import (Staged Dry-Run)                           |
| - Import 499 products and 178 customers from Swipe with conflict preview.        |
| - Admin approval gate before applying updates to Hatikvah store.                  |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
| Phase 4: Inbound Webhooks & Full Bidirectional Reconciliation                    |
| - Webhook listener for invoices and payments created directly in Swipe.          |
| - Nightly reconciliation cron job to detect any out-of-sync documents.           |
+-----------------------------------------------------------------------------------+
```

---

## 12. Open Questions Requiring Business / Accountant Confirmation

1. **Primary Numbering Authority:** Should Hatikvah Care adopt Swipe's serial number (`INV2627/XXX`) as the master legal GST invoice number, or maintain two separate sequences? (Recommended: Swipe as the master legal GST series).
2. **Old Invoices (1,261 Records):** Does the client require historical invoices (2024–2026) to be imported into Hatikvah Care's database for analytics, or should only active customers and products be synced?
3. **Credit Notes Endpoint:** Why does `/v2/doc/list?document_type=credit_note` return HTTP 400? Need to confirm exact query parameter names with Swipe API support.
4. **Stock Authority:** Is Swipe or Hatikvah Care considered the single source of truth for warehouse inventory balances?

---

## 13. Audit Reproduction Commands

To safely re-run this read-only audit at any time without exposing credentials or mutating state:

```bash
# 1. Ensure SWIPE_API_TOKEN is set in your .env file
# 2. Run the automated audit tool
node --env-file=.env scripts/swipe-audit.js

# 3. Run the automated test suite
node --test apps/api/test/swipe-audit.test.js
```

