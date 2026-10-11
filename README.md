# HaTikvah Care: website + admin dashboard

Public catalogue website and admin panel for **HaTikvah Care** (a brand of EXL Marketing, Hyderabad): hospitality supplies, guest amenities, F&B disposables, housekeeping and hotel/hospital linen.

* **Website:** home, catalogue (8 categories, 149 products from the 2026 catalogue), product pages, quote basket and enquiry form, SEO (titles, structured data, sitemap).
* **Admin dashboard** (`/admin`): products (inline price editing, photos, options, show/hide, featured), categories, enquiry inbox with status and notes, CSV export/import (fill prices from Excel), company details, price on/off switch, team accounts, activity log.
* One codebase, one container: React (Vite) front end + Express API + MongoDB.

> **Prices:** the PDF catalogue has no prices, so every product shows "Price on request" until the owner enters prices in the admin panel.

## Layout
```
apps/api      Express API, auth, stores (file for dev, MongoDB for production), tests
apps/web      React website and /admin dashboard
data/         catalog.json (products extracted from the PDF, loaded on first start)
scripts/      catalogue builder (PDF -> data/catalog.json + product photos)
docs/         DEPLOY.md (go live), ADMIN-GUIDE.md (for the client)
e2e/          browser smoke test
```

## Run locally
```bash
npm install
npm run build                      # builds the website into apps/web/dist
npm run create-admin -- --email you@example.com --name "Your Name"     # asks for a password; none is ever seeded
npm start                          # http://localhost:8080  (admin: /admin)
```
Without `MONGODB_URI` the API uses a local file store in `.data/` (development only). Production **requires** MongoDB and a strong `JWT_SECRET`; the server refuses to start otherwise.
For front-end work: `npm run dev:api` and `npm run dev:web` (Vite proxies `/api` to the API).

## Test
```bash
npm test          # 25 API tests: public API, enquiries, auth, CSRF, roles, CSV import, uploads, store contract
```
With `MONGODB_TEST_URI=mongodb://localhost:27017` the same store contract also runs against real MongoDB (CI does this).

## Rebuild the catalogue from the PDF (only if the PDF changes)
```bash
pip install pymupdf pillow
python scripts/catalog/build_catalog.py /path/to/Hotels-Catalog.pdf
```
Product names, packs and categories live in `scripts/catalog/catalog_table.py`. Re-running this rewrites `data/catalog.json` and the photos only; a live database is never touched (seeding happens once, on an empty database). Use the admin panel for day-to-day changes.

## Deploy
See [docs/DEPLOY.md](docs/DEPLOY.md).
