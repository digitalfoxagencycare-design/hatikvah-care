import { Router } from "express";
import { z } from "zod";
import { requirePerm } from "../lib/permissions.js";
import { channels } from "../lib/notify.js";
import { todayIST } from "../lib/gst.js";
import { balance, now } from "../lib/sales.js";
import { wrap } from "./public.js";
import { parse } from "./shared.js";

const digits10 = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);
const LIVE = (o) => !!o.shipment && !["cancelled", "returned"].includes(o.shipment.status);
const walletInput = z.object({ provider: z.enum(["shadowfax", "porter"]), balance: z.number().int().min(0).max(100_000_000_00), lowAt: z.number().int().min(0).max(100_000_000_00) }).strict();

/** What became of each WhatsApp message. A read message was also delivered and sent, so the numbers narrow from left to right. */
export function whatsappStats(rows) {
  const out = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const m of rows) {
    if (m.status === "failed" || m.deliveryStatus === "failed") { out.failed++; continue; }
    if (m.status !== "sent") continue; // queued, or waiting to be sent by hand
    out.sent++;
    if (["delivered", "read"].includes(m.deliveryStatus)) out.delivered++;
    if (m.deliveryStatus === "read") out.read++;
  }
  return out;
}

/** Today's and this month's money in. Payments are dated in IST, like the rest of the books. */
export function collection(payments, invoices, today) {
  const sum = (test) => payments.filter(test).reduce((n, p) => n + p.amount, 0);
  const owed = invoices.filter((i) => ["unpaid", "partial"].includes(i.status));
  return { today: sum((p) => p.date === today), month: sum((p) => p.date.startsWith(today.slice(0, 7))), activeLinks: owed.filter((i) => i.payLink?.url && i.payLink.amount === balance(i)).length };
}

/** Orders waiting to go out: not yet dispatched, or dispatched with no live courier booking. */
export const dispatchQueue = (orders) => orders.filter((o) => ["confirmed", "packed"].includes(o.status) || (o.status === "dispatched" && !LIVE(o)));

/** Read-only views behind the three channel hubs. Each number comes from this app's own records; provider dashboards stay the source for anything they alone hold. */
export function hubRoutes({ cfg, store, audit }) {
  const r = Router();

  const images = async () => Object.fromEntries((await store.products.all()).map((p) => [p.id, p.images?.[0] || ""]));
  r.get("/thumbs", wrap(async (_req, res) => res.json(await images())));

  r.get("/hubs/whatsapp", requirePerm("enquiries", "automation"), wrap(async (_req, res) => {
    const rows = (await store.outbox.all({ sort: { createdAt: -1 } })).filter((m) => m.channel === "whatsapp");
    const names = Object.fromEntries((await store.customers.all()).filter((c) => c.phone).map((c) => [digits10(c.phone), c.name]));
    res.json({ stats: whatsappStats(rows), feed: rows.slice(0, 40).map((m) => ({ id: m.id, to: m.to, name: names[digits10(m.to)] || "", event: m.event, ref: m.ref, preview: String(m.body || "").slice(0, 160), at: m.sentAt || m.createdAt, status: m.deliveryStatus || m.status, error: m.error || "" })) });
  }));

  r.get("/hubs/payments", requirePerm("invoices"), wrap(async (_req, res) => {
    const [payments, invoices] = await Promise.all([store.payments.all({ sort: { createdAt: -1 } }), store.invoices.all({ sort: { createdAt: -1 } })]);
    const open = invoices.filter((i) => ["unpaid", "partial"].includes(i.status));
    res.json({ ...collection(payments, invoices, todayIST()),
      transactions: payments.slice(0, 50).map((p) => ({ id: p.id, date: p.date, customerName: p.customerName, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber, amount: p.amount, mode: p.mode, reference: p.reference || "", razorpay: p.mode === "razorpay" })),
      open: open.slice(0, 12).map((i) => ({ id: i.id, number: i.number, customer: i.customer.name, balance: balance(i), payLink: i.payLink || null })) });
  }));

  const walletRow = () => store.settings.findBy("key", "courierWallet");
  r.get("/hubs/logistics", requirePerm("orders"), wrap(async (_req, res) => {
    const [orders, thumbs, saved] = await Promise.all([store.orders.all({ sort: { createdAt: -1 } }), images(), walletRow()]);
    const card = (o) => ({ id: o.id, number: o.number, token: o.token, customer: o.customer.name, address: o.customer.shippingAddress || o.customer.billingAddress || "", status: o.status, challanNumber: o.challanNumber || "",
      weightKg: o.shipment?.weightKg ?? null, items: o.items.slice(0, 4).map((i) => ({ name: i.name, qty: i.qty, image: thumbs[i.productId] || "" })), more: Math.max(0, o.items.length - 4), shipment: o.shipment || null });
    res.json({ couriers: channels(cfg).couriers, wallets: saved?.wallets || {}, queue: dispatchQueue(orders).map(card), moving: orders.filter((o) => LIVE(o) && o.shipment.status !== "delivered").slice(0, 20).map(card) });
  }));

  /** No courier integration reports a wallet balance, so staff type in what the courier's portal shows and the hub warns when it runs low. */
  r.put("/hubs/logistics/wallet", requirePerm("orders"), wrap(async (req, res) => {
    const d = parse(walletInput, req.body, res); if (!d) return;
    const saved = await walletRow();
    const wallets = { ...(saved?.wallets || {}), [d.provider]: { balance: d.balance, lowAt: d.lowAt, updatedAt: now(), updatedBy: req.admin.email } };
    if (saved) await store.settings.update(saved.id, { wallets }); else await store.settings.insert({ key: "courierWallet", wallets });
    await audit(req, "courier.wallet", d.provider, { balance: d.balance });
    res.json(wallets);
  }));
  return r;
}
