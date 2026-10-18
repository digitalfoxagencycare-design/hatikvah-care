# Deployment prompt for an AI agent (Antigravity / any coding agent)

Copy everything below the line into the agent.

---

You are deploying the **HaTikvah Care** web app (public storefront + admin business suite + API, one Docker image) to **Google Cloud Run**. The service is already running in production; this is an update. Work carefully, ask me before anything destructive, and never print or commit secret values.

## What to deploy
- Repository: `https://github.com/digitalfoxagencycare-design/hatikvah-care`
- Branch: `master`, commit `e4ec727` or newer (merge of PR #2: new storefront, cart/checkout, WhatsApp OTP sign-in, Razorpay, Nova OTP).
- Stack: Node 22, Express API (`apps/api`) serving the built React/Vite site (`apps/web/dist`). `Dockerfile` at the repo root builds everything; port 8080.
- Database: MongoDB Atlas (production). Secrets come only from the environment / Secret Manager.

## Step 1: Check the existing service (read only)
1. `gcloud config list` and `gcloud run services list`. Find the HaTikvah service. It is expected to be **`hatikvah-care`** in **`asia-south1`**, but use what actually exists. If you find no service or more than one candidate, stop and ask me.
2. `gcloud run services describe <SERVICE> --region <REGION> --format=yaml`. Note the env vars and secret references it already has (expected: `NODE_ENV=production`, `MONGODB_DB=hatikvah_care`, `PUBLIC_URL`, and secrets `JWT_SECRET`, `MONGODB_URI`, `CRON_SECRET`). Do not print secret values. Record the current revision name for rollback.
3. Note the current service URL and any domain mapping.

## Step 2: Verify the code before deploying
```bash
git clone https://github.com/digitalfoxagencycare-design/hatikvah-care.git && cd hatikvah-care
git checkout master && git log --oneline -1
npm ci && npm test && npm run build
```
All tests must pass (52 at the time of writing) and the build must succeed. If not, stop and report.

## Step 3: Deploy (keep the existing config)
```bash
gcloud run deploy <SERVICE> --source . --region <REGION>
```
- Do **not** use `--set-env-vars` or `--set-secrets`: they REPLACE the whole list and would wipe the database and secret settings. A plain `--source` deploy keeps the existing configuration.
- To add a variable later, use `--update-env-vars` / `--update-secrets` only.
- Do **not** run `npm run seed-demo` (it refuses production anyway) and do not touch the MongoDB data. On start, the app seeds the catalogue only into an EMPTY database, so live data is safe.
- If `PUBLIC_URL` is missing, tell me. It should be the public site address (for example `https://www.hatikvahcare.com` or the Cloud Run URL); payment-return links and message links use it. Add it with `--update-env-vars PUBLIC_URL=...` only after I confirm the value.

## Step 4: Optional integrations (only if I give you the values; never invent them)
Add these as Secret Manager secrets plus `--update-secrets`, or as `--update-env-vars` for non-secret values. Each one is off until set; the site works without them.

| Feature | Variables |
|---|---|
| Website login codes via the **Nova** central engine | `NOVA_URL` (https, e.g. `https://api.novasaas.net`), `NOVA_CLIENT_KEY` (secret, `nck_...` from the Nova console), optional `NOVA_TENANT_SLUG`. Set **both** URL and key, or neither: the server refuses to start with only one. |
| Direct WhatsApp Cloud API (order messages) | `WHATSAPP_TOKEN` (secret), `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_OTP_TEMPLATE` |
| Razorpay online payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (secret), `RAZORPAY_WEBHOOK_SECRET` (secret). Then add the webhook in the Razorpay dashboard: `https://<SITE>/api/webhooks/razorpay`, event `payment_link.paid`. |
| Email | `RESEND_API_KEY` (secret), `MAIL_FROM` |

## Step 5: Verify the live site
Open, or `curl` where it fits, on the service URL (and on the custom domain if mapped):
1. `GET /api/health` returns `{"ok":true,"store":"mongo"}`. If it says `"file"`, the database connection failed: stop and roll back.
2. `/` loads: green header (Home, Categories dropdown, Shop, About Us, Contact Us, search, account and cart icons) and a full-width hero.
3. `/shop` lists products; searching (for example "towel") works.
4. A product page `/product/<slug>` shows the new layout (brand card, price or "Price on request", option buttons, quantity, Add to cart / Add to quote, Description / Additional Information tabs).
5. `/cart`, `/about`, `/contact` and `/account` load without errors.
6. `/admin` sign-in works (I will sign in myself). In **Company & GST › Online shop** there are four switches: Cart & checkout, Online payment, Pay later, WhatsApp sign-in.
7. `GET /sitemap.xml` lists product URLs.
8. Check `gcloud run services logs read <SERVICE> --region <REGION> --limit 50` for startup errors (for example "Unsafe configuration").

## Step 6: Report back
Tell me:
- the deployed revision name and the commit
- the service URL and custom domain
- the result of each check in step 5
- which optional integrations are on or off

## Rollback (if anything in step 5 fails)
```bash
gcloud run services update-traffic <SERVICE> --region <REGION> --to-revisions <PREVIOUS_REVISION>=100
```
Then report what failed, with the log lines.

## Notes for the presentation
- No product has a price yet, so cart and checkout stay hidden ("Price on request"). For a demo, sign in to `/admin` › Products and, on 3–4 products, set:
  - a price
  - "Sold in packs of"
  - a bulk price
  - brand and manufacturer
  - options (for example 20ml / 30ml)
- Without Nova or WhatsApp keys, production hides the WhatsApp sign-in and checkout asks for a phone number. Without Razorpay keys, only "Pay later" is offered.
