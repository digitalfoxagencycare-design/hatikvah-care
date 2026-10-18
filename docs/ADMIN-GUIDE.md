# Admin guide (for the HaTikvah Care team)

Sign in at `/admin`. What you see in the menu depends on your role.

## Daily flow: enquiry → quote → order → invoice → payment
1. **Enquiries**: every website quote request or contact message lands here. It is assigned automatically (in turn) to team members marked *Gets leads*, and the customer gets a thank-you message. Set status, a follow-up date, and log calls (*Activity*). Click **Create customer**, then **Make quotation**.
2. **Quotations**: prices come from the catalogue (or the customer's price list). GST is worked out automatically: same state as the company = CGST + SGST, other state = IGST. **Send to customer** sends a link where they can view, download (PDF) and **accept** the quote. Unanswered quotes get reminders; expired quotes are marked automatically.
3. **Sales orders**: created automatically when the customer accepts online (or click *Create sales order*). **Dispatch** records the transporter, prints a delivery challan, reduces stock and tells the customer.
4. **Invoices & payments**: *Create GST invoice* from the order. Invoice numbers (INV/2026-27/0001) restart each financial year. **Record payment** for bank/UPI/cash; with Razorpay connected, online payments are recorded by themselves. Overdue invoices get reminders at +1, +7 and +15 days. Invoices cannot be edited (GST rule): void and issue a new one.

## Catalogue and prices
* **Products**: type prices into the table, or Export CSV → fill `price_rupees` → Import CSV. Set HSN code, GST rate and unit on each product (used on quotes and invoices).
* **Price lists**: special rates for some customers (a % discount and/or fixed prices). Choose the price list on the customer.

## Stock
* Tick **Track** for products you keep in the warehouse, set the reorder level and quantity, cost price and supplier.
* **Draft POs for low stock** creates purchase orders per supplier. When goods arrive, open the PO and click **Receive**.

## Website
* **Website content**: hero text and image, announcement banner, numbers, why-us, clients, testimonials, FAQ.
* **Company & GST** (owner): company details, GSTIN and state, bank details/UPI (printed on invoices), standard terms, brochure PDF, Google Analytics and Meta Pixel IDs, show/hide prices.

## Online shop (cart, checkout, WhatsApp sign-in)
* **Company & GST › Online shop** has four switches: *Cart & checkout*, *Online payment (Razorpay)*, *Pay later*, *Sign in with WhatsApp code*. Untick any of them if the client does not want it; the website then falls back to quote requests / guest checkout. Online payment and WhatsApp sign-in also need their keys on the server (see INTEGRATIONS.md).
* Only products with a price can be bought online (and only while *Show prices* is on); the rest stay "Price on request" and go through the quote list.
* On each product, **Online shop** fields drive the product page: brand and manufacturer (brand card), short description, *sold in packs of* (quantity steps, e.g. 288), minimum quantity, bulk prices (e.g. 576+ at ₹7.35), dispatch note, non-returnable, and the *Additional information* table. Tick **Track** stock to show In stock / Out of stock.
* Website orders appear in **Sales orders** marked *Website*. Online payment: the GST invoice is raised automatically when Razorpay confirms the money; do not dispatch while it says *awaiting payment*. Pay later: click *Create GST invoice* as usual and the customer gets the invoice with bank / UPI details.
* Buyers see their orders, invoices and challans at **/account** after signing in with a WhatsApp code.

## Automation & messages
Switch each automation on or off, set who gets team alerts, and see every message sent. Until email/WhatsApp are connected, use **Send by hand** on each message.

## Reports
Sales by month, funnel, lead sources, top customers/products, money owed by age, team performance; CSV downloads for the accountant (GST sales register, HSN summary, payments, receivables, stock).

## Team and security
Roles: **owner** (everything), **manager** (all except company settings, team, activity log), **sales** (enquiries, customers, quotes, orders), **accounts** (customers, invoices, payments, reports), **warehouse** (products, orders, stock), **staff** (catalogue, enquiries, customers, quotes). Turn on **two-step sign-in** in *My account*. The owner can download a full backup from the API (`/api/admin/backup`) and sees every change in the *Activity log*.
