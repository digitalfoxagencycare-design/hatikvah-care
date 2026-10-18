# Connecting email, WhatsApp, payments and the scheduler

Everything works without these: messages are prepared and listed in **Admin › Automation & messages** with a **Send by hand** button (opens WhatsApp or your email with the text filled in). Connect each service when ready by setting environment variables (Cloud Run: *Edit & deploy new revision › Variables & secrets*; keep keys in Secret Manager). Nothing is ever stored in the code or the database.

| Service | Variables | Where to get them |
|---|---|---|
| Email (Resend) | `RESEND_API_KEY`, `MAIL_FROM`, optional `MAIL_REPLY_TO` | resend.com › add and verify your domain (DNS records), create an API key. `MAIL_FROM` like `HaTikvah Care <orders@hatikvahcare.com>` |
| WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | Meta Business Manager › WhatsApp › API setup. Needs business verification and a phone number that is **not** used in the normal WhatsApp app. Create a *Utility* template whose body is just `{{1}}` (e.g. name `hc_update`) and wait for approval (usually 1–2 days). |
| Nova central engine (website login codes) | `NOVA_URL`, `NOVA_CLIENT_KEY`, optional `NOVA_TENANT_SLUG` | Nova console › platform staff issue a client key for the HaTikvah business (`POST /v2/platform/tenants/{id}/client-key`, shown once). Login codes then go out on Nova's connected WhatsApp number with its approved OTP template; Nova applies per-phone limits and never stores the code. Takes priority over the direct WhatsApp setting below for codes. Order messages and payments still use the direct WhatsApp / Razorpay keys until Nova offers client endpoints for them. |
| WhatsApp login codes (website sign-in) | `WHATSAPP_OTP_TEMPLATE` (plus the WhatsApp keys above) | Create an *Authentication* template with a copy-code button (Meta's standard OTP template) and put its name here. Codes are sent directly and never stored in the outbox. Without WhatsApp keys, production hides the sign-in and checkout falls back to a phone number; in development the code is shown on screen. |
| Online payments (Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard › API keys. Then Webhooks › add `https://YOUR-DOMAIN/api/webhooks/razorpay`, event `payment_link.paid`, and a secret. Payments then mark invoices paid by themselves. Website checkout uses the same webhook: when an online order is paid, its GST invoice is raised and marked paid. |
| Scheduler | `CRON_SECRET` (24+ random characters), `AUTOMATION_INTERVAL_MIN` | Cloud Run sleeps when idle, so add a Cloud Scheduler job: every 15 minutes, `POST https://YOUR-DOMAIN/api/internal/cron`, header `X-Cron-Secret: <CRON_SECRET>`. |
| Analytics | in Admin › Company & GST: GA4 ID, Meta Pixel ID | Enquiries are sent as `generate_lead` (GA4) and `Lead` (Meta) conversions. |

After setting variables, open **Automation & messages**: the tiles show which channels are on. Failed sends are retried 5 times and can be retried by hand.

## Accounting (Tally / Zoho Books)
Reports › *Downloads for your accountant* gives the GST sales register, HSN summary, payments and receivables as CSV. Tally Prime and Zoho Books import these through their Excel/CSV import templates. A direct Tally XML/Zoho API sync can be added later.

## E-invoicing / e-way bills
Needed only above ₹5 crore turnover (e-invoice) or for consignments over ₹50,000 moving by road (e-way bill). These go through a GSP (e.g. ClearTax, Masters India) API and can be added when required; invoice numbers already follow the 16-character GST rule.
