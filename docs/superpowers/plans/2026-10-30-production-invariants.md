# Production invariant rectification implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 35 audit remediations with explicit evidence and a truthful launch score.

**Architecture:** Store-owned atomic units of work use a shared database write fence and MongoDB sessions; FileStore serializes copy-on-write snapshots with one atomic snapshot commit. Nested units reuse the current context. Notifications and other remote effects run after commit. Financial journals are immutable, balanced safe-integer paise and reverse through compensating entries.

**Tech Stack:** Node ESM, Express, MongoDB driver 6, React/Vite, node:test.

**Spec:** User mission in this conversation and the delivered REPORT.md, revision 0fce8c2364ba0267f2a2e88a2291d490fee166dd.

## Global constraints

- Currency is safe-integer paise; null means price on request.
- Only store/* accesses databases; contracts match between stores.
- Staff sessions exactly 12h; buyers 30-day sliding sessions.
- Free-form WhatsApp only with a verified open window; no secrets in source.
- No provider side effects in retryable database callbacks; no deletion of financial history.

## Review focus

- Simultaneous last-unit credits/payments/checkouts: enforce one committed outcome.
- Failure between journal/stock/document writes: rollback all effects.
- Accepted document packaging edited later: preserve original unit allocation.
- Retry after an accepted provider operation: deduplicate or retain reconciliation state.
- Legacy financial rows: never invent missing counter-accounts or claim reconciled migration.

### Task 1: Transaction contract and test transport

Files: store/{file,mongo,transactions,contract}.js; test/{transactions,in-process-http,helpers}.js.
Interface: store.atomic(fn), store.inAtomic(), store.afterCommit(fn); collection compareAndUpdate(id, expected, patch).
- [ ] Add rollback, nested, concurrent writer and after-commit tests; observe failures.
- [ ] Implement store transactions, identity, uniqueness and pagination contract.
- [ ] Verify temporary FileStore tests and optional real Mongo replica-set contract.
- [ ] Add opt-in in-process Express transport to exercise existing integration tests when local sockets are blocked; keep real HTTP default.

### Task 2: Financial commands and immutable journals

Files: lib/{sales,accounting,money,gst}.js, routes/{sales,pos,docs}.js; test/financial-invariants.test.js.
Interfaces: postJournal(store, entry), reversePayment(store,id,by), store.atomic nested commands.
- [ ] Reproduce credit/payment/semantic conversion races and unbalanced journal rejection.
- [ ] Transactional commands, exact paise, immutable invoice/credit snapshots, source-idempotent tax journals and reversals.
- [ ] Require explicit contra-account for manual journals; keep ambiguous legacy rows flagged.
- [ ] Verify concurrent caps, rollback after injected failure, reversal idempotency and tax-head equality.

### Task 3: Inventory and purchasing

Files: routes/{shop,stock,sales}.js, lib/sales.js; test/inventory-invariants.test.js.
- [ ] Reproduce last-stock overselling, receiveNow bypass and packaging changes.
- [ ] Atomic reservations/receipts/dispatch, explicit FEFO allocations and constrained return provenance.
- [ ] Verify duplicate receipt, expired batch and returned/delivered stock handling.

### Task 4: Gateways, sessions and permissions

Files: lib/{notify,razorpay}.js, routes/{whatsapp,docs,shop,crm,admin,logistics}.js, config.js.
- [ ] Reproduce duplicate webhook/OTP consumption, unsupported window and aggregate data leaks.
- [ ] Durable claims, validated provider payloads, full receipt recording, timeouts, exact sessions and RBAC projections.
- [ ] Verify signature, other-customer access, quota, stale callback and after-commit send tests.

### Task 5: Frontend and operations

Files: web/src/{api.js,main.jsx,buyer/BuyerPortal.jsx,admin/{POS,Ledger,hooks,ui}.jsx}; server.js; reports.js; ops.js; scripts/*.
- [ ] Add regression cases for 28% POS, exact rupee conversion, net credit reporting and backup recovery metadata.
- [ ] Implement request freshness/error recovery, graceful shutdown and complete guarded operational exports.
- [ ] Verify build and recovery/error paths; separately record external provider/account checks that cannot run.

### Task 6: Review and delivery

- [ ] Run default npm API tests, opt-in in-process suite, build and all four unchanged invariant assertions.
- [ ] Independent code review; fix important introduced regressions.
- [ ] Produce all-35 before/after table, weighted score with evidence limits, safe patch/installer and branch if possible.
- [ ] Never call missing database/provider verification a non-blocking success or promise a 100% launch.
