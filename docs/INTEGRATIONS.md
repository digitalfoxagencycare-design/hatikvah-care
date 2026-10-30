# Connecting email, WhatsApp, payments and the scheduler

Everything works without these: messages are prepared and listed in **Admin › Automation & messages** with a **Send by hand** button (opens WhatsApp or your email with the text filled in). Connect each service when ready by setting environment variables (Cloud Run: *Edit & deploy new revision › Variables & secrets*; keep keys in Secret Manager). Nothing is ever stored in the code or the database.

| Service | Variables | Where to get them |
|---|---|---|
| Email (Resend) | `RESEND_API_KEY`, `MAIL_FROM`, optional `MAIL_REPLY_TO` | resend.com › add and verify your domain (DNS records), create an API key. `MAIL_FROM` like `HaTikvah Care <orders@hatikvahcare.com>` |
| WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | Meta Business Manager › WhatsApp › API setup. Needs business verification and a phone number that is **not** used in the normal WhatsApp app. Create a *Utility* template whose body is just `{{1}}` (e.g. name `hc_update`) and wait for approval (usually 1–2 days). |
| WhatsApp inbound (webhook + bot) | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (16+ chars), `WHATSAPP_APP_SECRET`, optional `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` | Meta app › WhatsApp › Configuration: Callback URL `https://YOUR-DOMAIN/api/webhooks/whatsapp`, the same verify token, then subscribe to **messages**. App secret: App settings › Basic (it signs every webhook call; production refuses to start without it once the verify token is set). For the Hatikvah Care number **+91 63047 29825** use `WHATSAPP_PHONE_ID=1368252233043036`; WABA ID `2667221577035024`. Customer messages appear in **Admin › WhatsApp inbox**, unknown numbers become customer leads, and the bot sends a quick menu (Request a quote / Hotel amenities / Clinic supplies). WhatsApp catalogue orders are matched by **SKU = content ID** of the Meta catalogue item. Delivery ticks (sent / delivered / read) are kept on each outbox message. Rule “Customer messages on WhatsApp” in Automation switches the bot off. |
| Nova central engine (website login codes) | `NOVA_URL`, `NOVA_CLIENT_KEY`, optional `NOVA_TENANT_SLUG` | Nova console › platform staff issue a client key for the HaTikvah business (`POST /v2/platform/tenants/{id}/client-key`, shown once). Login codes then go out on Nova's connected WhatsApp number with its approved OTP template; Nova applies per-phone limits and never stores the code. Takes priority over the direct WhatsApp setting below for codes. Order messages and payments still use the direct WhatsApp / Razorpay keys until Nova offers client endpoints for them. |
| WhatsApp login codes (website sign-in) | `WHATSAPP_OTP_TEMPLATE` (plus the WhatsApp keys above) | Create an *Authentication* template with a copy-code button (Meta's standard OTP template) and put its name here. Codes are sent directly and never stored in the outbox. Without WhatsApp keys, production hides the sign-in and checkout falls back to a phone number; in development the code is shown on screen. |
| Online payments (Razorpay) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard › API keys. Then Webhooks › add `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment_link.paid` and `qr_code.credited`, and a secret. **Counter UPI QR:** the `upi_qr` type is an on-demand feature, so ask Razorpay support to enable it on the account. Payments then mark invoices paid by themselves. Quotes also get a **Razorpay payment link** button: paying it accepts the quote, raises the sales order and GST invoice, takes the stock out and records the payment. Every payment (any mode) posts a receipt in **Cash & bank book**. Website checkout uses the same webhook: when an online order is paid, its GST invoice is raised and marked paid. |
| Shadowfax (courier pickups, live rider tracking) | `SHADOWFAX_API_TOKEN`, `SHADOWFAX_BASE_URL`, `SHADOWFAX_WEBHOOK_TOKEN` (24+ chars), `SHADOWFAX_PICKUP_PINCODE`, optional `SHADOWFAX_TRACKING_URL` (with `{awb}`) | From your Shadowfax account manager. Ask them to send status callbacks to `https://YOUR-DOMAIN/api/webhooks/shadowfax` with header `X-Shadowfax-Token: <SHADOWFAX_WEBHOOK_TOKEN>`. Tick **Book Shadowfax pickup** when dispatching an order: the AWB and tracking link are saved on the order and the customer gets the tracking link on WhatsApp when the rider picks up. **Check first:** the request/response field names in `apps/api/src/services/delivery_shadowfax.js` follow Shadowfax's client order API but must be confirmed against the API document for your account (test on their staging URL), including `pickup_slot`. |
| Porter (same-city two-wheeler pickups) | `PORTER_API_KEY`, `PORTER_BASE_URL`, `PORTER_WEBHOOK_TOKEN` (24+ chars), `PORTER_PICKUP_LAT`, `PORTER_PICKUP_LNG` | From Porter's partner onboarding. Ask them to send status callbacks to `https://YOUR-DOMAIN/api/webhooks/porter` with header `X-Porter-Token: <PORTER_WEBHOOK_TOKEN>`. Bookings need the delivery latitude and longitude, typed in the Book Courier Pickup modal. **Check first:** Porter's API document is not public, so every field name and webhook word in `apps/api/src/services/delivery_porter.js`, the base URL, and how the webhook proves itself must be confirmed before going live. The pickup slot is sent as a free-text comment. |
| Scheduler | `CRON_SECRET` (24+ random characters), `AUTOMATION_INTERVAL_MIN` | Cloud Run sleeps when idle, so add a Cloud Scheduler job: every 15 minutes, `POST https://YOUR-DOMAIN/api/internal/cron`, header `X-Cron-Secret: <CRON_SECRET>`. |
| Analytics | in Admin › Company & GST: GA4 ID, Meta Pixel ID | Enquiries are sent as `generate_lead` (GA4) and `Lead` (Meta) conversions. |

### WhatsApp templates (messages outside the 24-hour window)
WhatsApp delivers free-form messages only within 24 hours of the customer's last message to you. With the inbound webhook connected, the app knows each customer's window (from the WhatsApp inbox) and chooses per message:

1. **Window open** → free-form text with a tap-to-open link button.
2. **Window closed** → the approved template for that kind of message (below), else the general `WHATSAPP_TEMPLATE` (body `{{1}}` = the whole message on one line).
3. **No template covers it** → not sent (WhatsApp would reject it); it stays in **Automation & messages** as *send by hand* with the reason.

Without the inbound webhook the window is unknown, so the app uses a template when one is set and free-form text otherwise (as before).

Create these in WhatsApp Manager › Message templates as category **Utility**, language as in `WHATSAPP_TEMPLATE_LANG` (default `en`), with one **Visit website** button of type *Dynamic* whose URL ends in `{{1}}`. The app fills the variables in this order, and the button suffix is the document's secret token. Put each approved template's name in its variable:

| Variable | Used for | Approved Template | Body / Button URL |
|---|---|---|---|
| `WHATSAPP_OTP_TEMPLATE` | Website buyer login, staff/owner auth & OTP verification | `hc_otp` (APPROVED) | `*{{1}}* is your verification code.` (Copy Code button) |
| `WHATSAPP_TEMPLATE_QUOTE` | Quotation sent, quotation reminders | `hc_quote` (APPROVED) | `Dear {{1}}, our quotation {{2}} for {{3}} (incl. GST) is ready.` → `/doc/quote/{{1}}` |
| `WHATSAPP_TEMPLATE_DISPATCH` | Order dispatched, courier & Shadowfax updates | `hc_dispatch` (APPROVED) | `Dear {{1}}, your order {{2}} is on its way. {{3}}` → `/doc/challan/{{1}}` |
| `WHATSAPP_TEMPLATE_INVOICE` | Invoice sent, overdue reminders | `hc_invoice` (APPROVED) | `Dear {{1}}, invoice {{2}} for {{3}} is due on {{4}}` → `/doc/invoice/{{1}}` |
| `WHATSAPP_TEMPLATE` | General updates, payment receipts, order notifications | `hc_update` (APPROVED) | `Dear customer, {{1}}. - HaTikvah Care` |
| Not set yet | Order confirmations (the inbox shows it as not approved; until then they use `hc_update`) | `hc_order_confirm` (NOT CREATED) | Proposed: `Dear {{1}}, your order {{2}} for {{3}} is confirmed. Thank you for choosing HaTikvah Care.` |

Template language code is configured as `WHATSAPP_TEMPLATE_LANG=en_US`. All templates are approved on WABA ID `2667221577035024`.
Template names are lowercase letters, numbers and `_` (the server refuses anything else at start-up). Each sent message records which route it took (`template hc_quote`, `link`, `text`) in the outbox.

After setting variables, open **Automation & messages**: the tiles show which channels are on. Failed sends are retried 5 times and can be retried by hand.

## Accounting (Tally / Zoho Books)
Reports › *Downloads for your accountant* gives the GST sales register, HSN summary, payments and receivables as CSV. Tally Prime and Zoho Books import these through their Excel/CSV import templates. A direct Tally XML/Zoho API sync can be added later.

## E-invoicing / e-way bills
Needed only above ₹5 crore turnover (e-invoice) or for consignments over ₹50,000 moving by road (e-way bill). These go through a GSP (e.g. ClearTax, Masters India) API and can be added when required; invoice numbers already follow the 16-character GST rule.
