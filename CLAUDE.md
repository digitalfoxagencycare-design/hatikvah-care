# HaTikvah Care: notes for future work

* Stack: React + Vite (`apps/web`), Express (`apps/api`), MongoDB (production) / JSON files (dev), Cloud Run. Plain JavaScript (ESM).
* Money is stored as integer **paise** (`price`), `null` = "price on request".
* Public API returns only live products; prices hidden when `settings.showPrices` is false. Admin mutations require the session cookie AND the `X-Requested-With: hc-admin` header (CSRF).
* Only `apps/api/src/store/*` may touch the database. Keep the file and Mongo stores behaviour-identical (`test/store.test.js` is the contract).
* Seeding runs only on an empty database (`src/seed.js`). Never overwrite live data from `data/catalog.json`.
* Secrets only via environment (`JWT_SECRET`, `MONGODB_URI`). The server refuses unsafe production config (`src/config.js`).
* Before pushing: `npm test` and `npm run build`.
* Business flow: enquiry → customer → quote (`/doc/quote/:token`, accepted online) → sales order → dispatch (challan) → GST invoice → payments. GST maths lives only in `src/lib/gst.js` (the web editor mirrors it for display; the server's totals are saved). Document numbers come from `store.nextSeq` per financial year.
* Permissions: `src/lib/permissions.js` (roles → modules); guard new admin routes with `requirePerm`.
* All outgoing messages go through `src/lib/notify.js` (outbox). Rules and scheduled jobs: `src/lib/automation.js`. Integrations are env-only and optional (docs/INTEGRATIONS.md).
* Online shop: `src/routes/shop.js` (WhatsApp OTP sign-in, checkout, my orders). Switches live in settings and are limited by which keys exist (`shopFlags` in `src/lib/notify.js`). Bulk tier pricing is `tierPrice` in `src/lib/sales.js` (the web `ProductCard.jsx` mirrors it). Paid online orders get their GST invoice from the Razorpay webhook, never at checkout.
* `npm run seed-demo` fills a dev database with sample data for previews (refuses production).
* Known gaps: no credit notes, no e-invoice/e-way bill, no direct Tally/Zoho sync; product images are the supplier's catalogue photos.
