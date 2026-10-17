# Deploying HaTikvah Care

You need three things: a **MongoDB Atlas** database, a place to run the container (**Google Cloud Run** below), and a **domain** pointing at it.
Approximate monthly cost for one client site: Atlas M10 about ₹4,500–6,000 (a free M0 cluster is fine for a demo only: it has no backups), Cloud Run ₹0–1,500 at this traffic, domain about ₹800–1,200 per year. Check current prices before buying.

## 1. Database (MongoDB Atlas)
1. Create a project and a cluster in the Mumbai region (M10 for the live site).
2. Database Access: create a user with a long random password (read/write on `hatikvah_care`).
3. Network Access: allow Cloud Run (simplest: `0.0.0.0/0` together with the strong user password; tighter: a static egress IP / VPC peering).
4. Copy the connection string (`mongodb+srv://...`). Keep it secret.

## 2. Secrets
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"    # JWT_SECRET
```
Store `JWT_SECRET` and `MONGODB_URI` in Google Secret Manager (never in the repo or in chat).

## 3. Deploy to Cloud Run (from the repo root)
```bash
gcloud run deploy hatikvah-care --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,MONGODB_DB=hatikvah_care,PUBLIC_URL=https://www.hatikvahcare.com \
  --set-secrets JWT_SECRET=hc-jwt-secret:latest,MONGODB_URI=hc-mongo-uri:latest,CRON_SECRET=hc-cron-secret:latest
```
The first start loads the 149 catalogue products into an empty database. Roll back at any time from the Cloud Run "Revisions" tab (send 100% traffic to the previous revision).

## 4. First owner account
Run once, with the same environment (Cloud Shell or a Cloud Run job):
```bash
MONGODB_URI='...' JWT_SECRET='...' NODE_ENV=production npm run create-admin -- --email owner@yourdomain.com --name "Owner Name"
```
It asks for a password. Then sign in at `https://YOUR-DOMAIN/admin`, add team members, and fill in prices (Products page, or Export CSV, fill `price_rupees`, Import CSV).

## 5. Domain and checks
Map the domain in Cloud Run (Domain mappings) and add the DNS records it shows. Then verify: `/api/health` returns `{"ok":true,"store":"mongo"}`, `/sitemap.xml` lists products, the admin login works, a test enquiry shows up in Enquiries.

## Operations
* **Backups:** M10+ has continuous backups; confirm they are on. Enquiries and prices live only in the database.
* **Uploads:** photos uploaded in the admin are stored in MongoDB (max 2 MB each).
* **Automations and messages:** set `CRON_SECRET` and add a Cloud Scheduler job (every 15 min, `POST /api/internal/cron` with header `X-Cron-Secret`). Email, WhatsApp and Razorpay are switched on with environment variables: see [INTEGRATIONS.md](INTEGRATIONS.md).
* **Backups of business data:** quotes, invoices and payments live in MongoDB; keep Atlas backups on. The owner can also download a JSON export at `/api/admin/backup`.
* **Rotate the JWT secret:** change the secret and redeploy; everyone has to sign in again.
