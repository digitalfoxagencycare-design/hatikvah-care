# Roadmap status

| Phase | Scope | Status |
|---|---|---|
| 0. Stabilise | No built-in admin password; production requires MongoDB (no silent fallback to a temporary store); CI/Render on `master`; collision-free numbering | Done |
| 1. Website + content | Editable home page (hero, banner, numbers, why-us, clients, testimonials, FAQ), brochure download, floating WhatsApp, GA4 + Meta Pixel, lead source (UTM/referrer) on every enquiry | Done |
| 2. Leads / CRM | Customers, enquiry → customer, round-robin assignment, follow-up dates, activity timeline, price lists | Done |
| 3. Quotations | GST quotes (CGST/SGST vs IGST by place of supply, HSN), versions, printable/PDF, customer views and accepts online → sales order | Done |
| 4. Orders, invoices, payments | Sales orders, dispatch + delivery challan, GST tax invoices (per financial year), payments, Razorpay links + webhook, receivables, accountant CSVs | Done (Razorpay needs keys) |
| 5. Stock & purchasing | Stock ledger, reorder levels, low-stock alerts, suppliers, purchase orders, goods received | Done |
| 6. Reports & access | Sales, funnel, sources, top customers/products/categories, ageing, team performance; roles (owner, manager, sales, accounts, warehouse, staff); two-step sign-in; owner backup | Done |
| Automations | 16 rules, see Admin › Automation & messages | Done (email/WhatsApp need keys) |

**Waiting on the client / integrations:** Resend domain, WhatsApp Business API number + template, Razorpay keys, Cloud Scheduler job, GSTIN/bank details in settings, real product photos, prices, HSN codes. See [INTEGRATIONS.md](INTEGRATIONS.md).

**Possible next steps:** credit notes, e-invoice/e-way bill via GSP, direct Tally/Zoho sync, customer self-service portal (order history, re-order), multi-warehouse stock, variant-level stock.
