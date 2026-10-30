# HaTikvah Care production code audit and rectification pack

Review date: 30 October 2026 (India). **Release decision: HOLD.** Tested fixes are supplied, but financial concurrency, accounting and integration gaps remain. This is not a production-clearance certificate or a claim that every possible defect has been eliminated.

## Reviewed revision and deliverables

- Repository: `digitalfoxagencycare-design/hatikvah-care`, commit `0fce8c2364ba0267f2a2e88a2291d490fee166dd` on `master`.
- All 303 tracked files in the isolated working copy matched this GitHub revision after CRLF/LF normalization, before changes.
- The review traced API sales/GST/stock/POS, buyer authentication and portal contracts, stores, notifications, provider webhooks, startup, backup, reporting, and selected frontend flows. Nova review was limited to the integration-key/OTP boundary and WhatsApp sender; **the whole Nova repository was not audited**.
- `C:\hatikvah-care` and `C:\nova-restaurant-platform` were read. Original repositories were not modified. Fixes are in the isolated working copy and this pack. Nothing was pushed, deployed, or sent to customers.
- `rectifications.patch`: applicable source/test changes. `replacements/`: complete replacement files, including the sanitized template-management script. `manifest.json`: normalized SHA-256 guards and base revision. `APPLY.ps1`: guarded installation with backups. `evidence/`: actual test/build/reproduction logs.
- The patch deliberately excludes the old credential-bearing script line. Install the complete sanitized replacement with the installer. Do not reconstruct the old line from git history into a patch.

## Verification and limits

| Check | Result |
|---|---|
| New production regression tests | 31 tests; latest result in `evidence/audit-green.log` |
| Focused existing store/config/WhatsApp tests | 8 passed, 1 MongoDB test skipped |
| Frontend production build | Passed; Vite output in `evidence/build.log` |
| Full existing baseline suite | 90 discovered: 9 passed, 17 failed, 63 cancelled, 1 skipped |
| Full suite after changes | tests 121, pass 40, fail 17, cancelled 63, skipped 1; localhost HTTP tests remain blocked |
| Four critical invariant reproducers | All four still reproduce; `evidence/known-gaps.log` |
| Patch applicability | `git apply --check` against original files; result in `evidence/patch-check.log` |
| Credential-pattern scan of patched tracked text | No matches for the scanned token/key patterns; not a git-history clearance |

The initial test attempt also hit an inaccessible OS temporary directory; setting TEMP/TMP to a workspace directory resolved that filesystem issue. Local HTTP connections still fail with `connect EACCES 127.0.0.1:<port>`. HTTP integration tests therefore could not be certified here. No MongoDB test database was supplied; there was no real Mongo/replica-set concurrency run. The supplied live Cloud Run URL was inaccessible through the read-only web check. No production database, Meta template-approval state, Razorpay account, Shadowfax account, or mobile/browser end-to-end flow was exercised.

Two old WhatsApp test assertions explicitly required unsafe behavior: free-form with an unknown window, and raw bot messages with a closed window. Those expectations were updated to the requested invariant. They cannot be preserved unchanged while enforcing the mission. The other original test files were left unchanged. The existing “89 passing” statement was not assumed: this checkout discovers 90 original tests, including its optional Mongo check.

Tests in `production-audit.test.js` exercise real functions and temporary FileStore data. Controller-specific checks invoke the actual route handler without network transport; they do not replace HTTP integration tests or prove all middleware behavior. `scripts/reproduce-production-gaps.mjs` uses temporary data and exits 1 while any of its four invariants fails; its assertions must not be weakened to get a green release gate.

## Findings with tested rectifications

The file references below point to the **original reviewed revision**, so line numbers remain stable. Exact applied code is in `rectifications.patch` and `replacements/`. “Fixed” below means fixed in the supplied copy, not deployed.

### F01 — [CRITICAL] Meta credential committed to source

**File:** [scripts/manage_meta_templates.mjs:L6](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/scripts/manage_meta_templates.mjs#L6)

**Root cause and failure:** The script falls back to a literal Meta access token. It is present in the latest GitHub commit. The listing request also puts the token in a query string, creating an additional URL/log exposure path. The script is not copied into the runtime Docker image, but the repository exposure itself is critical. Token validity and privileges were not tested.

**Reproduction:** Inspect the token declaration at the referenced revision. The report and patch do not repeat the value. A pattern-only scan locates the credential without printing its contents.

**Rectification:** Complete safe replacement reads only `process.env.WHATSAPP_TOKEN`, fails if missing, and uses `Authorization: Bearer` for listing. Source removal is supplied. **Revocation/rotation and historical cleanup remain open operational work.** Remove the old credential from reachable history/artifacts only through a coordinated history-rewrite procedure after rotation; do not treat deletion from HEAD as revocation.

**Hardening:** Enable secret scanning and push protection; use a scoped secret from Secret Manager. Do not import production `.env` into test or review artifacts.

### F02 — [CRITICAL] Production startup injects demo accounting records

**Files:** [apps/api/src/server.js:L10](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/server.js#L10), [apps/api/src/seedDemo.js:L8](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/seedDemo.js#L8)

**Root cause and failure:** Startup runs demo seeding unless `SEED_DEMO_DATA` equals `false`. The seeder refuses only `NODE_ENV=test` and uses record-count thresholds; it can create mock customers, quotations, invoices, payments and stock in a small live database.

**Reproduction:** Regression `demo seeding refuses production before touching the database` failed on original code. A sentinel store demonstrates that production execution reaches store methods before any production refusal.

**Rectification:** Startup now requires `!cfg.prod && SEED_DEMO_DATA === "true"`; `seedDemoData` independently throws in production before accessing the database. Exact changes are supplied.

**Hardening:** Reconcile existing production records with audit trails before removing any suspected demo entries. No live records were inspected or deleted in this review. Concurrent first-boot catalogue/admin seeding still needs coordination.

### F03 — [HIGH] GST multiplication loses decimal halves and accepts unsafe integers

**File:** [apps/api/src/lib/gst.js:L15](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/gst.js#L15)

**Root cause and failure:** `Math.round(qty * rate)` uses binary floating point. `1.005 * 100` rounds to 100 instead of the intended exact 101 paise. Allowed quantity/rate bounds can also produce values beyond `Number.MAX_SAFE_INTEGER`, losing paise before persistence.

**Reproduction:** `calcTotals([{qty:1.005,rate:100,gstRate:0}],false).lines[0].amount` and the regression using quantity 10,000,000 and rate 10,000,000,000.

**Rectification:** New `lib/money.js` performs decimal multiplication and half-up rounding with BigInt rational arithmetic, then validates safe-integer paise. GST line discounts, tax, split and document round-off use that boundary. Existing per-line rounding and rupee-total policy are retained.

**Hardening:** This is **not** an application-wide replacement of every floating-point currency path. Price-list discounts, CSV/form rupee parsing and some purchase/display calculations still need a shared exact money boundary. Oversized documents currently fail closed; map arithmetic-range errors to a clear 400 response before release.

### F04 — [MEDIUM] Sequential document identifiers can exceed 16 characters

**File:** [apps/api/src/lib/gst.js:L33](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/gst.js#L33)

**Root cause and failure:** `padStart(4)` sets a minimum width, not a maximum. `INV/2026-27/100000` exceeds the requested 16-character ceiling.

**Reproduction:** `nextNumber({nextSeq:async()=>100000},"INV",new Date("2026-10-30"))` returned an overlong identifier.

**Rectification:** Reject overlong identifiers before document insertion. Existing numbering format and per-financial-year counters remain intact. The counter may advance on rejection; gaps are not silently reused.

**Hardening:** Plan a controlled short-format numbering migration well before exhaustion. Do not reset live sequences or change already-issued numbers.

### F05 — [HIGH] WhatsApp service-window enforcement has bypasses

**File:** [apps/api/src/lib/notify.js:L35](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/notify.js#L35)

**Root cause and failure:** Unknown windows return free-form messages. Raw bot payloads bypass the window entirely, including old queued/retried replies. Future inbox timestamps also open an apparent window.

**Reproduction:** `buildWhatsAppMessage(cfg,row,null)` without templates; a text `payload` with `inWindow=false`; an inbox timestamp one day in the future. All failed the new invariant checks before the patch.

**Rectification:** Free-form and raw bot payloads require `inWindow === true`. Closed/unknown windows use configured templates or return a manual reason, producing `status:"logged"`. Future inbound timestamps cannot open the window. Unconfigured providers now leave a meaningful manual-send reason. The existing 30-minute safety margin remains.

**Hardening:** Recompute window eligibility immediately before an actual provider send, not just at the start of a potentially long 50-message flush. A configured name does not prove Meta approval; account-side approval/language checks remain required.

### F06 — [HIGH] Overlapping outbox flushes duplicate sends

**File:** [apps/api/src/lib/notify.js:L119](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/notify.js#L119)

**Root cause and failure:** Cron, webhook, and admin triggers independently read the same queued row before either marks it sent.

**Reproduction:** Queue one row, run `Promise.all([notifier.flush(),notifier.flush()])`, count actual injected provider calls. The original sent twice.

**Rectification:** A shared in-process in-flight promise coalesces overlapping flushes. Test now observes one send. **Cross-instance duplicates and the crash-after-provider-send ambiguity remain open.**

**Hardening:** Add durable conditional claims, lease expiry, exponential backoff, provider idempotency where supported, and reconciliation for ambiguous sends. An in-memory guard is not a Cloud Run distributed lock.

### F07 — [HIGH] OTP delivery falls back to an unsupported free-form send

**File:** [apps/api/src/lib/notify.js:L155](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/notify.js#L155)

**Root cause and failure:** A connected phone/token without `WHATSAPP_OTP_TEMPLATE` sends a text OTP without proving an open service window. Fresh login requests normally have no established inbound window.

**Reproduction:** Configure a phone and token, omit the OTP template, call `sendOtp`. Original code called the provider with a text payload.

**Rectification:** Direct sending now fails with a configuration error before making a provider call. Existing Nova sending remains separate. The approved authentication-template mapping was already correct: identical code in body and button `sub_type:"url", index:"0"`. A new regression preserves it. Do **not** substitute the marketing coupon-code button shape just because the approved authentication button is called COPY_CODE.

**Hardening:** Make shop feature availability reflect the missing direct authentication template so users see a service-unavailable state before requesting a code. Approved `hc_otp` and exact `en_US`/`en` language must be verified on the actual account.

### F08 — [MEDIUM] Unicode signature input can throw instead of returning false

**Files:** [apps/api/src/lib/razorpay.js:L22](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/razorpay.js#L22), [apps/api/src/routes/whatsapp.js:L19](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/whatsapp.js#L19)

**Root cause and failure:** The old code compares JavaScript character lengths before `timingSafeEqual` on UTF-8 buffers. Equal character counts need not mean equal byte lengths. The helper can throw on malformed Unicode input. This is not a demonstrated signature bypass; it is an input-validation/error-path defect.

**Reproduction:** Pass 64 `é` characters as a Razorpay signature, or `sha256=` followed by that value to Meta verification.

**Rectification:** Validate exact lowercase hexadecimal signature shapes before constant-time comparison. Valid signatures still use HMAC-SHA256 of the raw body and timing-safe comparison.

**Hardening:** Re-run raw-body HTTP verification tests in an unrestricted test environment and keep provider error bodies out of sensitive logs.

### F09 — [MEDIUM] Staff-session configuration permits arbitrarily long sessions

**File:** [apps/api/src/config.js:L45](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/config.js#L45)

**Root cause and failure:** `SESSION_HOURS` is converted to a number without enforcing the specified 12-hour rule. An accidental value of 720 creates a 30-day staff token/cookie.

**Reproduction:** `loadConfig({SESSION_HOURS:"720"})` succeeded.

**Rectification:** Configuration now requires exactly 12. Buyer sliding-session code remains separate: default 30 days and renewal after one day. Buyer TTL is still configurable from 1 to 90 days; if the business requires exactly 30 rather than a 30-day deployment setting, enforce that separately.

**Hardening:** Confirm deployed values and clocks. Renewal/session assertions were inspected, but their real HTTP cookie tests could not complete here.

### F10 — [HIGH] Concurrent first FileStore loads lose inserted rows

**File:** [apps/api/src/store/file.js:L13](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/store/file.js#L13)

**Root cause and failure:** Multiple first readers each load/create their own array before any cache entry exists. Concurrent inserts append into different arrays and later cache assignments overwrite earlier work.

**Reproduction:** Eight concurrent inserts into a fresh collection did not reliably leave eight rows. The regression now preserves all eight.

**Rectification:** Share one pending load promise per collection; populate the cache only from that load. The write promise chain also recovers after a rejected write instead of permanently preventing later writes.

**Hardening:** FileStore remains single-process development storage. This fix is not a multi-file transaction, process lock, or crash-recovery journal. Failed saves can still leave cache/disk divergence; do not use it on Cloud Run.

### F11 — [HIGH] Corrupt storage is silently treated as an empty database

**File:** [apps/api/src/store/file.js:L13](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/store/file.js#L13)

**Root cause and failure:** All JSON-read errors are swallowed, including corrupt JSON and filesystem failures. A later write or seed can replace data that was not actually empty. Counter parsing has the same dangerous fallback.

**Reproduction:** Write `{broken` into `invoices.json`, then call `store.invoices.all()`. Original code returned an empty array.

**Rectification:** Only `ENOENT` means new storage. Parsing/permission/I/O errors propagate; collections must decode to arrays. Corrupt counters also fail closed.

**Hardening:** Add verified backups, bounded recovery, and explicit counter-schema validation. Do not auto-delete corrupt files.

### F12 — [HIGH] Credit-note caller snapshots overwrite newer credit totals; price adjustments can restock

**File:** [apps/api/src/lib/sales.js:L225](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L225)

**Root cause and failure:** Reusing an invoice snapshot for a second sequential credit note writes stale `creditedAmount` and a stale `creditNotes` list. Separately, callers can explicitly set `restock:true` on a pricing adjustment and add physical stock without returning goods.

**Reproduction:** Invoice two items; call twice with the same original invoice object, crediting one item each. The notes total 20,000 paise but old code leaves `creditedAmount` at 10,000. A pricing-adjustment request with restocking is also accepted by the original helper.

**Rectification:** Reload the persisted invoice before validation and reject pricing-adjustment restocking. Both checks pass. **Concurrent credits are still unsafe; see F21.**

**Hardening:** Keep damaged goods in a non-sellable quarantine workflow. The current API still permits an explicit restock override on damaged goods; define and enforce whether that is ever allowed.

### F13 — [HIGH] Invoicing after delivery deducts stock twice; voiding can invent returned stock

**Files:** [apps/api/src/lib/sales.js:L103](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L103), [apps/api/src/routes/sales.js:L247](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/sales.js#L247)

**Root cause and failure:** Stock deduced at dispatch is recognized only while an order is exactly `dispatched`. Once it becomes `delivered`, a later invoice deducts again. The void handler likewise treats delivered goods as if they had not left the warehouse.

**Reproduction:** Create a delivered order with previously dispatched stock, then invoice it. Original `deductForInvoice` appends another stock-out.

**Rectification:** Both paths now recognize `dispatched` and `delivered`. The direct stock-deduction regression passes.

**Hardening:** Persist an explicit immutable stock-consumption/allocation reference rather than deriving physical movement from a mutable order status. Invoice/void/dispatch multi-write crash consistency remains open.

### F14 — [HIGH] Out-of-order courier callbacks regress tracking state

**File:** [apps/api/src/routes/logistics.js:L48](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/logistics.js#L48)

**Root cause and failure:** Callback deduplication checks whether a status already appeared, but does not enforce monotonic progression. A delayed transit callback can replace a delivered shipment. Unknown provider statuses normalize to `created` and can reset an active shipment.

**Reproduction:** Deliver first, then send an earlier transit event; or send an unknown status to an in-transit shipment. Original handler regresses current tracking.

**Rectification:** Guard progression ranks, preserve terminal states, permit delivered-to-returned, and ignore backward transitions. Canonical `picked` normalization was already idempotent and is covered by a passing check.

**Hardening:** Account-specific status/event semantics, RTO progression, AWB/client-order identity consistency, event ordering and distributed callback races still require provider-contract validation and conditional database updates. Current internal names remain `created`, `assigned`, `picked`, etc.; do not rename them without updating API/UI/automation consumers.

### F15 — [HIGH] Purchase receiving accepts cancelled orders, overreceipts and partial invalid requests

**File:** [apps/api/src/routes/stock.js:L140](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/stock.js#L140)

**Root cause and failure:** Receive-all lacks a state guard. Partial receiving validates batch fields first but validates product membership only while writing stock; a later invalid line fails after earlier stock has moved. Remaining quantity is not capped.

**Reproduction:** Receive-all on a cancelled PO; receive 3 against 2 remaining; or submit one valid line followed by a product not on the PO. Original code respectively receives cancelled stock, overreceives, or leaves partial stock effects after a 400.

**Rectification:** Validate permitted PO state, all product membership/existence, aggregate repeated line quantities and remaining caps before stock writes. Receive-all rejects outstanding batch-tracked goods without batch details. All three regression scenarios pass.

**Hardening:** These checks do not make multiple writes atomic. The separate `receiveNow` creation fast path and editing a draft with `receiveNow:true` remain problematic; see F29.

### F16 — [HIGH] Backup leaks a pending TOTP secret and omits accounting collections

**File:** [apps/api/src/routes/ops.js:L59](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/ops.js#L59)

**Root cause and failure:** Backup removes `totpSecret` but retains `totpPending`, which is authentication secret material. Ledger, credit notes and inbox are omitted, so the file is not the claimed business backup.

**Reproduction:** Insert an admin with `totpPending`, export backup, inspect that field and collection keys.

**Rectification:** Remove pending TOTP secrets and include `ledger`, `creditNotes`, `inbox`. Regression passes.

**Hardening:** Counters, media and restore verification are still absent. The export remains an owner data export, **not a complete disaster-recovery backup**. Restore must preserve identifiers, references, sequence high-water marks and journal consistency; never infer that a backup is restorable just because export succeeds.

### F17 — [HIGH] Rejected quotations can be invoiced; converted orders can be invoiced twice through quote path

**File:** [apps/api/src/routes/sales.js:L105](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/sales.js#L105)

**Root cause and failure:** Direct quote-to-invoice checks only `q.invoiceId`. It does not reject rejected/expired quotes, nor check an existing invoice on the quote's linked sales order.

**Reproduction:** Call the endpoint for a rejected quote, or invoice an order then call its original quote's direct-invoice endpoint. The rejected-quote scenario is covered by a regression.

**Rectification:** Check eligible quote state and the linked order's invoice reference. Concurrent double conversion remains open, see F24.

**Hardening:** Add an enforced transition table and transaction/idempotency keys across document creation paths rather than relying on route-specific prechecks.

### F18 — [HIGH] Activity routes bypass module RBAC

**File:** [apps/api/src/routes/crm.js:L56](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/crm.js#L56)

**Root cause and failure:** Any authenticated staff member can list activity records or post notes/follow-up mutations against modules outside their role. A warehouse user can read invoice/payment activity despite lacking invoice permission.

**Reproduction:** Invoke GET and POST activity routes as `warehouse_manager` for an invoice. Both original paths expose/accept the operation. Red/green evidence is retained; the POST regression explicitly selects the POST handler.

**Rectification:** Filter activity reads by entity-to-module permission and deny writes without the relevant permission. Regressions pass.

**Hardening:** This does not close all cross-module leaks. Customer detail aggregates and dashboard fields still need role-sensitive projection; see F30. Validate referenced entity existence on activity writes as well.

### F19 — [MEDIUM] A valid zero negotiated price is replaced with catalogue price

**File:** [apps/api/src/routes/sales.js:L30](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/sales.js#L30)

**Root cause and failure:** `rVal || p.price` treats a legitimate 0-paise customer price as missing. Packaging-rate selection has the same truthiness error.

**Reproduction:** Set a customer price-list override to 0 while catalogue price is 10,000. `/rates` previously returned 10,000.

**Rectification:** Use nullish fallback and explicit null checks. The zero-price regression passes.

**Hardening:** `null = price on request` must remain distinct from zero across every form, quote default, import and document path. `rateFor` still returns zero for a missing list price; staff must enter an agreed quote price rather than issue accidental free invoices.

### F20 — [HIGH] Payment links ignore credit notes

**File:** [apps/api/src/lib/razorpay.js:L5](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/razorpay.js#L5)

**Root cause and failure:** Amount is `total - amountPaid` rather than `total - amountPaid - creditedAmount`, even though the rest of the API's `balance()` subtracts credits. A displayed lower balance can produce a larger payment request.

**Reproduction:** Total 10,000, paid 1,000, credited 3,000; old provider payload requests 9,000 instead of 6,000.

**Rectification:** Subtract credited amount and reject void/non-positive/unsafe balances before provider calls. Payload regression passes.

**Hardening:** Existing live payment links are not cancelled by this change. Credit notes/payment edits must invalidate or reconcile outstanding links, with audit records. Webhook overpayments must not be silently clipped, see F23.

## Confirmed release blockers and remaining code gaps

The following are **not fixed by this patch**. Their remediation requires coordinated store/schema/workflow changes and real MongoDB/provider validation. The snippets below are implementation requirements or targeted changes, not a tested replacement for the missing transaction architecture. Supplying a small in-memory lock and calling these fixed would be incorrect for multiple Cloud Run instances.

### F21 — [CRITICAL] Concurrent credit notes break quantity and value caps

**File:** [apps/api/src/lib/sales.js:L225](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L225)

**Root cause:** Read prior notes, validate, insert note, add stock, update invoice and append ledger are independent operations. Two requests validate the same remaining quantity/value; an invoice reload does not serialize them. Failures can also leave half-applied notes.

**Reproduction:** Run `node scripts/reproduce-production-gaps.mjs`. Its first case uses a barrier so both calls read the same pre-commit credit-note list, then credits the same one-line invoice twice. Both notes are persisted beyond the invoice total.

**Required rectification:** One store-owned transaction must conditionally update the invoice revision/remaining quantities, insert the note, add exact return allocations and post balanced journal entries together. Add an idempotency key unique per credit-note request. Retry transaction conflicts by re-reading/revalidating, not by replaying side effects blindly. FileStore needs equivalent all-or-nothing semantics for its contract or an explicitly restricted development architecture.

**Hardening/test:** On a replica set, use two independent clients/processes to credit the last unit: one succeeds, one returns 409, stock moves once, journal balances, invoice credited amount equals the sum of notes. Inject failure after each write and prove rollback/retry behavior.

### F22 — [CRITICAL] Required double-entry accounting does not exist

**File:** [apps/api/src/lib/sales.js:L193](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L193)

**Root cause:** Ledger rows have one `account`, `kind`, and `amount`; there are no debit/credit journal lines or balancing constraint. Invoice creation does not post receivable/revenue/output-tax journal lines. Payment deletion deletes history. This is a cash/bank book, not the specified accounting engine.

**Reproduction:** Fourth case in `reproduce-production-gaps.mjs`: receive a payment and validate every posted ledger entry with `assertBalancedJournals`. It rejects missing lines, fractional/unsafe paise, invalid sides, unequal debit/credit sums and unsafe journal totals. It fails on the current cashbook schema. A regression also proves that an earlier valid entry cannot hide a later malformed journal. Inspect `createInvoice`, `postLedger`, and `removePaymentLedger`.

**Required rectification:** Introduce immutable journals with safe-integer `debit`/`credit` lines and `sum(debit) === sum(credit)` checked before insert, then atomically post them with each source transaction. For receipts: debit Cash/Bank/Razorpay clearing and credit Receivables. For invoices: debit Receivables and credit Revenue/output CGST/SGST/IGST, with a signed round-off line. Credit notes reverse the corresponding original amounts. Remove payments through compensating reversal journals, not deletion. Manual expenses require a chosen counter-account; do not silently label everything an expense or suspense.

**Hardening/test:** Account mappings and opening balances require business/accountant approval, migration and reconciliation. Do not fabricate historical journals or claim accounting compliance by adding an always-equal pair while omitting invoice/tax recognition.

### F23 — [CRITICAL] Payment races, incomplete webhook validation and discarded excess money

**Files:** [apps/api/src/routes/docs.js:L46](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/docs.js#L46), [apps/api/src/lib/sales.js:L184](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L184), [apps/api/src/routes/sales.js:L273](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/sales.js#L273)

**Root cause:** Manual payments precheck a stale balance; concurrent requests can both collect it. Webhook dedupe scans `payments.external` without a unique index/atomic event claim. A valid HMAC authenticates origin, but the code does not strictly bind link ID, currency, captured payment status, and expected amount to the stored payable. It records `Math.min(pay.amount,balance(inv))`, silently dropping any excess from accounting. A payment arriving after cancellation/voiding is not handled as a reconciliation/refund obligation.

**Reproduction:** Second case in the gap script submits two payments against the same last balance and observes overcollection. For clipping, deliver a signed `payment_link.paid` event with a payment greater than remaining balance; only the capped amount is stored. A signed USD or mismatched stored-link fixture is not explicitly rejected by the current handler. These latter cases were traced statically, not sent to live Razorpay.

**Required rectification:** Use a durable unique event/payment identity and transaction around receipt insertion, allocation, invoice aggregate and journal. Validate provider payload schema/status/INR/positive safe amount and the link-to-document relationship; use server-side reconciliation for ambiguous/stale links. Record the entire actual receipt and allocate only what is due; retain excess as an unapplied/refund liability. Never discard financial value or automatically issue more goods solely to absorb a payment.

**Hardening/test:** Replay one event concurrently from multiple workers; simulate credit note, cancellation and a second payment between link creation and webhook delivery; verify exactly one receipt, full money conservation and correct refund liability.

### F24 — [HIGH] Document conversion and stock reservation are not atomic

**Files:** [apps/api/src/lib/sales.js:L117](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L117), [apps/api/src/lib/sales.js:L148](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L148), [apps/api/src/routes/shop.js:L111](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/shop.js#L111)

**Root cause:** Quote/order conversion checks references before separate inserts/updates. Unique document numbers do not prevent two invoices for one order or two orders for one quote. Checkout calculates available stock from movements and open orders, then inserts a reservation separately. Pending online orders hold stock indefinitely with no demonstrated expiry.

**Reproduction:** Third gap-script case concurrently buys the last piece; resulting available stock is negative. Concurrently call quote-to-order or order-to-invoice against the same document to demonstrate duplicate semantic conversion; this conversion variant is a static-derived reproduction prescription, not a completed multi-instance test.

**Required rectification:** Add conditional document revisions, unique business-operation keys and transactional reservation counters/allocation records. Conditional stock reservation must succeed only when available quantity is sufficient. Expire unpaid reservations under a documented policy and reconcile late captured payments. Transactions must include state, stock and journal effects; provider calls must occur outside retryable database callbacks through a durable outbox.

**Hardening/test:** Concurrent last-stock checkouts across independent processes, webhook/admin invoice race, failure after every write, and expired reservation followed by late payment. One invoice per logical order, one stock consumption, and one accounting posting must remain true.

### F25 — [HIGH] Dual-store contract parity is incomplete

**Files:** [apps/api/src/store/mongo.js:L23](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/store/mongo.js#L23), [apps/api/src/store/file.js:L32](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/store/file.js#L32)

**Root cause:** File insert/replace preserves supplied `doc.id`; Mongo assigns an unrelated `_id` while retaining `doc.id`, and its projection lets that retained id override the canonical `_id`. `get(returned.id)` can therefore fail. Mongo enforces unique indexes that FileStore does not. FileStore sorts only the first sort key; neither contract supplies validated skip/cursor pagination. FileStore strict `findBy` equality is also not equivalent to Mongo query semantics for arbitrary operator-shaped values.

**Reproduction:** In a test database, `insert({id:"chosen",slug:"chosen"})`, then `get("chosen")`; compare stores. Insert duplicate product slugs; compare rejection. Query `all({sort:{group:1,n:-1}})` on ties. Existing optional Mongo tests do not cover these cases and were skipped here.

**Required rectification:** Canonicalize identity on every operation: destructure `id` and `_id`, choose one allowed string id, persist it as `_id`, and return only that as `id`. Define duplicate-key behavior, multi-key stable sorting, pagination bounds and allowed `findBy` scalar inputs in one shared contract. Do not expose Mongo query operators through generic equality helpers.

```js
// Target identity rule for Mongo insert; add type/uniqueness validation and the same contract to FileStore.
const { id = crypto.randomUUID(), _id: ignored, ...rest } = doc;
await c.insertOne({ _id: id, ...rest });
return { id, ...rest };
```

**Hardening/test:** Run the expanded contract against a real Mongo test database, including explicit ids, replaceAll, duplicate errors and pagination. Do not run destructive contract fixtures against `hatikvah_care` production.

### F26 — [HIGH] Batch return provenance and historical packaging are not preserved

**Files:** [apps/api/src/lib/sales.js:L79](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L79), [apps/api/src/lib/sales.js:L225](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/sales.js#L225), [apps/api/src/lib/units.js:L46](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/units.js#L46)

**Root cause:** Sales stock-outs usually do not store invoice-line-to-batch allocations; FEFO is reconstructed from movements. Returns accept a batch name without proving it was the batch sold. Changing current product packaging before invoicing an old order/paid quote causes `priced()->expandLines()` to recalculate `perUnit` from today's product rather than its accepted snapshot.

**Reproduction:** Sell batch A, return the same invoice line into arbitrary batch B. Or accept an order for a 10-piece box, change packaging to 20, then invoice/payment-webhook it: the saved stock unit can change. These paths were statically traced; a live historical-data migration was not attempted.

**Required rectification:** Persist immutable per-line unit/price/tax and FEFO allocation snapshots when goods are reserved/consumed. A return must reference sold allocation IDs and cap each allocation's remaining returned quantity. Preserve original mfg/expiry metadata; quarantine damaged/expired returns. Invoicing accepted documents must use a validated immutable snapshot, not mutable current packaging.

**Hardening/test:** Partial multi-batch sale/return, repeated return, packaging edit, deleted product and expired stock. Existing legacy invoices need an explicit reviewed allocation/reconciliation path; do not invent original batches.

### F27 — [HIGH] OTP attempt limits and one-time consumption race across workers

**File:** [apps/api/src/routes/shop.js:L68](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/shop.js#L68)

**Root cause:** Lookup, attempts increment and remove are independent operations. Simultaneous correct verifications can both pass before removal; wrong attempts can overwrite each other's increments. Request cooldown scans and process-local express rate limits are not a durable per-phone cross-instance limit.

**Reproduction:** On an isolated server, pause after OTP lookup, issue concurrent verify requests with the same correct code; then issue parallel wrong codes from different clients/instances. Observe multiple acceptances or lost attempt increments. This is a source-proven race pattern; real HTTP/multi-instance execution was blocked here.

**Required rectification:** Store-owned conditional OTP update/consume with expiry, attempts and unconsumed status in one atomic operation; one active challenge per normalized phone/purpose; shared per-phone/IP limits with TTL. Compare fixed-length decoded hashes safely and reject corrupt stored lengths before timingSafeEqual. Keep raw OTPs out of outbox/audit responses.

**Hardening/test:** One success across concurrent verification, exactly incremented failed attempts, limit enforced across two instances, daily buyer-cookie renewal, CSRF and other-customer 404 checks over real HTTP.

### F28 — [HIGH] Shutdown and external-provider calls can leave incomplete work

**Files:** [apps/api/src/server.js:L20](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/server.js#L20), [apps/api/src/lib/notify.js:L100](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/lib/notify.js#L100), [apps/api/src/services/delivery_shadowfax.js:L15](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/services/delivery_shadowfax.js#L15)

**Root cause:** `server.close()` is not awaited before closing the store and immediately exiting. Notification, payment-link, Nova-OTP and courier fetches lack explicit bounded request timeouts. A hung provider stalls requests/flushes, while shutdown can interrupt financial or outbox writes.

**Reproduction:** Hold a provider fetch open, trigger a mutation, then SIGTERM. Trace that shutdown closes storage/exits before draining completion. This requires a controlled process/integration environment; it was not executed against production.

**Required rectification:** Track shutdown, stop new work, await bounded request/job draining, then close storage; retain a deadline below platform termination grace. Use `signal: AbortSignal.timeout(timeoutMs)` on provider requests, classify timeout as ambiguous when a remote side effect may already exist, and reconcile before retrying booking/payment operations.

**Hardening/test:** SIGTERM during invoice/stock/credit-note/outbox work; provider accepts then times out; Cloud Run CPU/scheduler behavior. Cross-instance scheduled jobs need durable job claims, not only `running` in one server process.

### F29 — [HIGH] Purchase fast paths still bypass batch requirements and receipt semantics

**File:** [apps/api/src/routes/stock.js:L77](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/stock.js#L77)

**Root cause:** Purchase creation with `receiveNow:true` directly moves goods without requiring batch details. Editing a draft with that flag sets `items.received` even though the PUT handler does not move stock. Partial->received status transition can also mark completion without receiving the outstanding goods.

**Reproduction:** Create an inward purchase for a `batchTracked` product using `receiveNow:true`; no batch is supplied. Edit a draft using the same flag and compare received quantities with stock movements. Set a partial PO status to received while quantity remains outstanding.

**Required rectification:** One receipt command must own all receiving, with validated quantity/batch allocation and transaction semantics. Purchase editing must not change received quantities. Remove direct completion transitions unless the remaining goods are received or explicitly short-closed with an audited reason.

**Hardening/test:** Verify all UI fast paths call the same receipt service and cannot bypass it. The patch's receive-all/partial guards do not resolve this separate fast path.

### F30 — [HIGH] Customer detail and dashboard aggregate unauthorized module data

**Files:** [apps/api/src/routes/crm.js:L28](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/crm.js#L28), [apps/api/src/routes/admin.js:L108](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/admin.js#L108)

**Root cause:** A customer-detail caller authorized for customers or quotes receives invoices/payments regardless of invoice permissions. Dashboard base output contains recent enquiry details for every authenticated role, including warehouse roles without enquiries permission. Fixing standalone activity routes does not fix these aggregate projections.

**Reproduction:** Sign in as `sales_representative` and request customer detail containing invoice/payment data; sign in as `warehouse_manager` and request the dashboard. Compare returned fields with `permissions.js`.

**Required rectification:** Apply module-level output projections and field-specific permissions to aggregates before serializing; do not merely hide frontend panels. Split invoice/payment financial projections behind invoice/ledger permissions, and enquiries behind enquiries permission.

**Hardening/test:** Table-driven real HTTP tests for every role and aggregate endpoint, including denied fields in JSON, not just denied page navigation. The role set and document-sharing policy should be agreed before broadening access.

### F31 — [MEDIUM] Net GST/HSN reporting omits credit-note adjustments

**File:** [apps/api/src/routes/reports.js:L81](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/reports.js#L81)

**Root cause:** HSN and sales/dashboard totals aggregate non-void invoices without deducting relevant credit-note amounts/quantities. A separate credit-note register exists, but the totals are not clearly labeled gross or reconciled net output. Mixed packaging quantities can also be summed under one HSN/UQC.

**Reproduction:** Invoice one item, issue a full credit note in the report period, then compare invoice-only HSN/tax totals, the separate note register and expected net position. No automated reporting regression was executed here.

**Required rectification:** Explicitly expose gross invoices, credit adjustments and net totals with a documented period policy; preserve original tax-head reversals and UQC conversions. Keep a separate invoice register if needed, but do not label its gross totals as net liabilities.

**Hardening/test:** Same-period and later-period credit notes, full/partial returns, odd-paise tax rounding and different UOMs. Accountant sign-off is needed for export mappings; this review does not establish filing readiness.

### F32 — [MEDIUM] Frontend POS silently substitutes 18% for a supported 28% product

**File:** [apps/web/src/admin/POS.jsx:L6](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/web/src/admin/POS.jsx#L6)

**Root cause:** POS `RATES` omits 28 even though backend/catalogue schemas accept it. Adding a 28% product chooses the fallback 18% rate, which the server then accepts as an admin-entered line rate.

**Reproduction:** Create a product with `gstRate:28`, add it in POS, inspect the line and outgoing invoice payload. This is a static-derived UI reproduction, not a completed browser run.

**Exact targeted correction (not applied/tested in browser in this pack):**

```diff
-const RATES = [0, 5, 12, 18];
+const RATES = [0, 5, 12, 18, 28];
```

**Hardening/test:** Derive supported rates from one shared contract and verify the resulting saved invoice at 28%, including intra/inter-state splits. Backend policy should explicitly define when staff may override a product tax classification.

### F33 — [MEDIUM] Buyer/admin frontend recovery and request freshness gaps

**Files:** [apps/web/src/buyer/BuyerPortal.jsx:L44](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/web/src/buyer/BuyerPortal.jsx#L44), [apps/web/src/admin/hooks.jsx:L5](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/web/src/admin/hooks.jsx#L5), [apps/web/src/main.jsx:L2](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/web/src/main.jsx#L2)

**Root cause:** List hooks do not cancel/version responses, so an older request can overwrite newer route data. Suspense has loading fallbacks but no React error boundary for render/lazy-chunk failures. Buyer initial `/me` catches every network failure as signed-out; logout catches failure but clears only UI state while the server cookie may remain. Reorder has no immediate in-flight guard, allowing repeated clicks to add the same order repeatedly. Tracking is a rendered card/external link, not a verified live tracking modal or polling feed; Razorpay uses payment-link redirects, not an embedded Checkout SDK.

**Reproduction:** Delay request A, navigate to B, resolve B then A; simulate a failed lazy chunk/offline `/me`; double-click Reorder; fail logout. These require browser/network simulation and were not executed here.

**Required rectification:** Use AbortController/request generations, explicit offline/auth states and a recoverable error boundary. Disable/reject repeated actions while in flight and retain action identity through ambiguous network failures. Explain logout failure and avoid claiming server sign-out until acknowledged. Implement a live modal/polling contract only if that behavior is actually required.

**Hardening/test:** Mobile layouts/modal focus, keyboard access, retry/toast behavior, offline checkout, failed payment redirects and stale tab data. Production build passes; build success is not UI functional verification.

### F34 — [MEDIUM] Advertised CSV size and currency parsing do not match the API boundary

**Files:** [apps/api/src/app.js:L42](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/app.js#L42), [apps/api/src/routes/admin.js:L26](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/routes/admin.js#L26), [apps/api/src/csv.js:L21](https://github.com/digitalfoxagencycare-design/hatikvah-care/blob/0fce8c2364ba0267f2a2e88a2291d490fee166dd/apps/api/src/csv.js#L21)

**Root cause:** The global 100KB JSON parser runs before the import route's 2MB parser, so larger supported bulk requests are rejected first. `toPaise` uses `Number` and `Math.round(n*100)`, accepting formats such as hexadecimal/scientific notation and inheriting binary decimal rounding. Output CSV formula neutralization exists and is a positive control; imported price formulas are rejected by numeric conversion rather than executed. Do not misreport import as server-side formula execution.

**Reproduction:** Submit an import JSON body between 100KB and 2MB; compare 413 with the route's apparent allowance. Import `1.005`, `0x10`, or `1e3` as a rupee price and inspect conversion policy. Existing export formula tests could not run through HTTP here.

**Required rectification:** Apply a bounded parser at the intended import boundary before the smaller general parser, with auth/rate/size controls. Parse a documented decimal grammar into integer paise without Number multiplication, using a shared frontend/backend boundary. Reject overprecision or implement an explicit exact rounding policy. Retain/export-test formula neutralization for every user-controlled cell.

**Hardening/test:** Quoted multiline CSV, BOM, bad/duplicate headers/SKUs, formula-like values, leading whitespace/control characters, huge rows and dry-run/apply parity. Do not strip leading punctuation from legitimate data silently.

### F35 — [MEDIUM] Nova's non-OTP WhatsApp sender has free-form fallbacks without a window check

**File:** `C:\nova-restaurant-platform\backend\nova\services\whatsapp.py`, `MetaWhatsApp.send_alert` and `send_order_update`.

**Root cause:** On selected template errors, both functions fall back to `send_text` without proving a service window. This is outside HaTikvah's direct notifier and is not used by its current Nova OTP call, but it contradicts a platform-wide template-only fallback expectation.

**Reproduction:** In Nova tests, make `send_template` raise `WhatsAppError("132001",...)` and observe `send_text`. The sender was read; Nova's complete test suite was not run.

**Required rectification:** Remove unconditional free-text fallback or require a verified window. Persist failed template messages to an operational outbox/manual-send state rather than merely dropping them. Do not alter the correct Nova OTP URL-button mapping. HaTikvah's `X-Nova-Client-Key` plus optional `X-Tenant-Slug` contract matches `routes_integrations.py`; that endpoint binds the tenant to the key, checks active status and invokes its OTP guard.

**Hardening/test:** Run Nova's tenant isolation, OTP-quota and WhatsApp tests independently. Account numbers, template approvals and stored sender configuration were not read from production.

## Required production architecture and release gates

1. **Contain exposure:** revoke/rotate the committed token; inspect its accessible actions and audit logs. Source cleanup alone is insufficient. Disable automatic demo seeding in the deployed environment immediately, then reconcile any seeded records.
2. **Define the store unit of work:** MongoDB sessions/transactions owned by `store/*`, conditional revisions, business unique indexes, retry policy and idempotency records. Keep external provider requests outside retryable database callbacks. FileStore needs a deliberately equivalent contract or must be replaced for workflows whose contract it cannot satisfy.
3. **Implement immutable journals:** source transaction keys, balanced safe-integer lines, tax accounts and explicit reversal/refund liabilities; migrate/reconcile with financial review.
4. **Persist allocations and events:** reservation/FEFO allocations, durable webhook identities, outbox claims/leases, timeout reconciliation, retry backoff and transactional message intent. Exactly-once delivery cannot be asserted merely from a unique event number.
5. **Validate providers:** Razorpay full-amount/INR/link binding and reconciliation; approved Meta template names/languages/phone/WABA; account-specific Shadowfax request/response/status documentation and staging pickup/cancellation/RTO. Shadowfax's own source comment explicitly says its fields still need account confirmation.
6. **Run the gates:** all existing HTTP tests in a network-enabled environment; expanded store contract and rollback/race tests against a replica-set test database; browser/mobile/offline checks; staging end-to-end with provider sandboxes; then a controlled canary with reconciled accounting/stock/outbox metrics.

The requested Phone ID `1368252233043036` and WABA ID `2667221577035024` were treated as supplied requirements, **not independently verified account state**. No secrets or payment/courier credentials were read from local `.env` or used for live mutations.

## Applying and reviewing the supplied changes

Use a clean branch/checkpoint of the reviewed revision. Run the installer in preview mode first, then with `-Apply` after inspecting the diff. It validates all original normalized hashes before any mutation and saves backups. The original `C:\hatikvah-care` was not writable for this agent; the installer is supplied for execution in your normal development environment.

```powershell
.\APPLY.ps1 -Repository C:\hatikvah-care
.\APPLY.ps1 -Repository C:\hatikvah-care -Apply
Set-Location C:\hatikvah-care
npm test
npm run build
node scripts/reproduce-production-gaps.mjs
```

The last command is intentionally a **release blocker** until its four open invariants are implemented. A passed build and the supplied regression suite do not override those failures. Do not deploy this pack as a claim that the entire mission is complete. It is a reviewable first remediation set plus a concrete remaining-work specification.
