# HaTikvah Care: notes for future work

* Stack: React + Vite (`apps/web`), Express (`apps/api`), MongoDB (production) / JSON files (dev), Cloud Run. Plain JavaScript (ESM).
* Money is stored as integer **paise** (`price`), `null` = "price on request".
* Public API returns only live products; prices hidden when `settings.showPrices` is false. Admin mutations require the session cookie AND the `X-Requested-With: hc-admin` header (CSRF).
* Only `apps/api/src/store/*` may touch the database. Keep the file and Mongo stores behaviour-identical (`test/store.test.js` is the contract).
* Seeding runs only on an empty database (`src/seed.js`). Never overwrite live data from `data/catalog.json`.
* Secrets only via environment (`JWT_SECRET`, `MONGODB_URI`). The server refuses unsafe production config (`src/config.js`).
* Before pushing: `npm test` and `npm run build`.
* Known gaps: no email/WhatsApp alert for new enquiries; no orders/checkout (this is a quote-based B2B catalogue); product images shown from the PDF are the supplier's catalogue photos.
