import { askText } from "./toast.jsx";

export function whatsAppQuote(q) {
  if (!q) return null;
  const rawPhone = q.customer?.phone || "";
  const clean = rawPhone.replace(/\D/g, "");
  const waPhone = clean.length === 10 ? `91${clean}` : clean;
  const quoteUrl = `${window.location.origin}/doc/quote/${q.token}`;
  const total = ((q.totals?.total ?? q.total ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = `Hello ${q.customer?.name || "Customer"},\n\nPlease find your Quotation ${q.number} from HaTikvah Care.\nTotal Amount: ₹${total}\n\nYou can review, print, and approve your quotation online here:\n${quoteUrl}\n\nThank you,\nHaTikvah Care`;
  return { waPhone, text, url: waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}` : null };
}

/** Opens WhatsApp with the quote filled in, asking for a number if the customer has none. */
export async function openWhatsAppQuote(q) {
  const wa = whatsAppQuote(q);
  if (wa?.url) { window.open(wa.url, "_blank", "noopener,noreferrer"); return; }
  const num = await askText("Customer's WhatsApp number", { value: q?.customer?.phone || "", placeholder: "10 digits", confirmLabel: "Open WhatsApp" });
  if (!num) return;
  const clean = num.replace(/\D/g, "");
  window.open(`https://wa.me/${clean.length === 10 ? `91${clean}` : clean}?text=${encodeURIComponent(wa.text)}`, "_blank", "noopener,noreferrer");
}
