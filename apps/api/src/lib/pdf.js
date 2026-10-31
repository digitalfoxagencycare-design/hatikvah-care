import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { amountInWords, stateName } from "./gst.js";

const TITLES = {
  quote: "QUOTATION",
  invoice: "TAX INVOICE",
  challan: "DELIVERY CHALLAN",
  packing: "PACKING SLIP",
  gatepass: "GATE PASS",
  label: "SHIPPING LABEL",
  creditnote: "CREDIT NOTE"
};

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(p) {
  if (p == null) return "0.00";
  return (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate a clean, tax-compliant A4 PDF Buffer for quotes, invoices, and challans.
 */
export async function generateDocumentPdf({ kind, doc, company }) {
  return new Promise(async (resolve, reject) => {
    try {
      const pdf = new PDFDocument({ size: "A4", margin: 36, info: { Title: `${TITLES[kind] || "Document"} ${doc.number || doc.challanNumber || ""}`, Author: company.legalName || company.name || "HaTikvah Care" } });
      const chunks = [];
      pdf.on("data", (c) => chunks.push(c));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);

      const title = TITLES[kind] || "TAX INVOICE";
      const totalPaise = doc.totals?.total ?? doc.total ?? 0;
      const isChallan = kind === "challan";
      const isQuote = kind === "quote";
      const isInvoice = kind === "invoice";

      // 1. Header Bar: Document Title & Recipient Badge
      pdf.rect(36, 36, 523, 24).fill("#0F172A");
      pdf.fillColor("#FFFFFF").fontSize(12).font("Helvetica-Bold").text(title, 46, 43, { width: 300 });
      pdf.fontSize(8).font("Helvetica").text("ORIGINAL FOR RECIPIENT", 380, 44, { width: 170, align: "right" });

      // 2. Company Details Section
      let y = 68;
      pdf.fillColor("#0F172A").fontSize(13).font("Helvetica-Bold").text(company.legalName || "M/s. EXL MARKETING", 36, y);
      y += 16;
      pdf.fontSize(9).font("Helvetica-Bold").fillColor("#0284C7").text(`GSTIN ${company.gstin || "36ADDPC0083H1Z0"}`, 36, y);
      y += 12;
      pdf.fontSize(8).font("Helvetica").fillColor("#475569").text(company.address || company.billingAddress || "", 36, y, { width: 340 });
      y += 24;
      pdf.text(`Mobile: ${company.phone || "+91 79954 44434"}   Email: ${company.email || "hatvikcare@gmail.com"}`, 36, y);

      // Document Number & Date Box (Right aligned)
      const metaBoxX = 380;
      let metaY = 68;
      pdf.rect(metaBoxX, metaY, 179, 72).lineWidth(0.5).strokeColor("#CBD5E1").stroke();
      pdf.fillColor("#0F172A").fontSize(8).font("Helvetica");
      
      const numLabel = isChallan ? "Challan #:" : isQuote ? "Quotation #:" : "Invoice #:";
      const numVal = isChallan ? doc.challanNumber : doc.number;
      pdf.text(numLabel, metaBoxX + 8, metaY + 8).font("Helvetica-Bold").text(numVal || "—", metaBoxX + 70, metaY + 8);
      
      const dateLabel = isChallan ? "Dispatch Date:" : isQuote ? "Quote Date:" : "Invoice Date:";
      const dateVal = fmtDate(isChallan ? doc.dispatch?.date : doc.date || doc.createdAt);
      pdf.font("Helvetica").text(dateLabel, metaBoxX + 8, metaY + 24).font("Helvetica-Bold").text(dateVal, metaBoxX + 70, metaY + 24);
      
      const validLabel = isQuote ? "Validity:" : "Due Date:";
      const validVal = fmtDate(isQuote ? doc.validUntil : doc.dueDate);
      pdf.font("Helvetica").text(validLabel, metaBoxX + 8, metaY + 40).font("Helvetica-Bold").text(validVal, metaBoxX + 70, metaY + 40);
      
      const placeState = doc.placeOfSupply ? stateName(doc.placeOfSupply) : (company.state || "Telangana");
      pdf.font("Helvetica").text("Place of Supply:", metaBoxX + 8, metaY + 56).font("Helvetica-Bold").text(placeState, metaBoxX + 70, metaY + 56);

      // 3. Customer Info Section
      y = 150;
      pdf.rect(36, y, 523, 44).fill("#F8FAFC");
      pdf.rect(36, y, 523, 44).lineWidth(0.5).strokeColor("#CBD5E1").stroke();
      
      pdf.fillColor("#0F172A").fontSize(8).font("Helvetica-Bold").text("CUSTOMER DETAILS:", 44, y + 6);
      pdf.font("Helvetica").fontSize(8).fillColor("#334155");
      const cust = doc.customer || {};
      pdf.text(`Name: ${cust.name || doc.customerId || "Walk-in Customer"}`, 44, y + 18);
      pdf.text(`Phone: ${cust.phone || "—"}`, 44, y + 29);

      pdf.font("Helvetica-Bold").fillColor("#0F172A").text("BILLING / SHIPPING ADDRESS:", 300, y + 6);
      pdf.font("Helvetica").fontSize(8).fillColor("#334155");
      pdf.text(cust.shippingAddress || cust.billingAddress || "—", 300, y + 18, { width: 250 });

      // 4. Line Items Table Header
      y = 202;
      pdf.rect(36, y, 523, 18).fill("#0F172A");
      pdf.fillColor("#FFFFFF").fontSize(7.5).font("Helvetica-Bold");
      pdf.text("#", 40, y + 5, { width: 16 });
      pdf.text("ITEM DESCRIPTION & HSN", 60, y + 5, { width: 210 });
      pdf.text("RATE", 275, y + 5, { width: 45, align: "right" });
      pdf.text("QTY", 325, y + 5, { width: 35, align: "right" });
      pdf.text("TAXABLE", 365, y + 5, { width: 55, align: "right" });
      pdf.text("GST", 425, y + 5, { width: 40, align: "right" });
      pdf.text("AMOUNT", 470, y + 5, { width: 80, align: "right" });

      // 5. Line Items Rows
      y += 18;
      pdf.font("Helvetica").fontSize(8).fillColor("#0F172A");
      const items = doc.items || [];
      items.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
        pdf.rect(36, y, 523, 20).fill(rowBg);
        pdf.rect(36, y, 523, 20).lineWidth(0.5).strokeColor("#E2E8F0").stroke();

        pdf.fillColor("#0F172A");
        pdf.text(String(idx + 1), 40, y + 5, { width: 16 });
        const nameAndHsn = `${item.name || item.sku || "Product"}${item.hsn ? ` (HSN: ${item.hsn})` : ""}`;
        pdf.text(nameAndHsn, 60, y + 5, { width: 210 });
        pdf.text(`₹${fmtMoney(item.rate)}`, 275, y + 5, { width: 45, align: "right" });
        pdf.text(`${item.qty} ${item.unit || "NOS"}`, 325, y + 5, { width: 35, align: "right" });
        pdf.text(`₹${fmtMoney(item.amount)}`, 365, y + 5, { width: 55, align: "right" });
        pdf.text(`${item.gstRate ?? 18}%`, 425, y + 5, { width: 40, align: "right" });
        pdf.text(`₹${fmtMoney(item.total)}`, 470, y + 5, { width: 80, align: "right" });
        y += 20;
      });

      // 6. Totals Box & Words
      y += 6;
      const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      const words = amountInWords(totalPaise);

      pdf.rect(36, y, 523, 50).fill("#F8FAFC");
      pdf.rect(36, y, 523, 50).lineWidth(0.5).strokeColor("#CBD5E1").stroke();

      pdf.fillColor("#0F172A").fontSize(8).font("Helvetica");
      pdf.text(`Total Items / Qty: ${items.length} / ${totalQty}`, 44, y + 8);
      pdf.text(`Amount in Words: INR ${words || "Zero"} Only.`, 44, y + 22, { width: 300 });

      // Breakdown on right
      const sumX = 380;
      pdf.text("Taxable Value:", sumX, y + 6).text(`₹${fmtMoney(doc.totals?.taxable)}`, 470, y + 6, { width: 80, align: "right" });
      if (doc.interState) {
        pdf.text("IGST:", sumX, y + 18).text(`₹${fmtMoney(doc.totals?.igst)}`, 470, y + 18, { width: 80, align: "right" });
      } else {
        pdf.text("CGST (9%) + SGST (9%):", sumX, y + 18).text(`₹${fmtMoney(doc.totals?.tax)}`, 470, y + 18, { width: 80, align: "right" });
      }
      pdf.font("Helvetica-Bold").text("Total Amount (incl. GST):", sumX, y + 32).text(`₹${fmtMoney(totalPaise)}`, 470, y + 32, { width: 80, align: "right" });

      // 7. UPI QR Code & Bank Details & Stamp Section
      y += 60;
      if (!isChallan) {
        // UPI QR
        const upiUrl = `upi://pay?pa=${company.upiId || "42157988420@sbi"}&pn=${encodeURIComponent(company.legalName || company.name || "EXL MARKETING")}&am=${(totalPaise / 100).toFixed(2)}&cu=INR`;
        const qrBuffer = await QRCode.toBuffer(upiUrl, { width: 90, margin: 1, errorCorrectionLevel: "M" });
        pdf.image(qrBuffer, 44, y, { width: 70 });
        pdf.fontSize(7).font("Helvetica-Bold").fillColor("#0F172A").text("Scan UPI to Pay", 44, y + 74, { width: 70, align: "center" });

        // Bank Details
        pdf.fontSize(8).font("Helvetica-Bold").text("Bank Details:", 130, y);
        pdf.font("Helvetica").fontSize(7.5).fillColor("#334155");
        pdf.text("Bank: State Bank of India", 130, y + 12);
        pdf.text("Account #: 42157988420", 130, y + 23);
        pdf.text("IFSC Code: SBIN0020308", 130, y + 34);
        pdf.text("Branch: SANJEEVA REDDY NGR", 130, y + 45);

        // Signatory Stamp
        pdf.fontSize(8).font("Helvetica-Bold").fillColor("#0F172A").text(`For ${company.legalName || "M/s. EXL MARKETING"}`, 400, y);
        pdf.rect(410, y + 16, 120, 40).lineWidth(0.5).strokeColor("#CBD5E1").stroke();
        pdf.fontSize(7.5).font("Helvetica-Oblique").fillColor("#64748B").text("Authorized Signatory\n(Digitally generated document)", 415, y + 26, { width: 110, align: "center" });
      }

      // 8. Terms & Conditions
      y += 90;
      pdf.fontSize(7).font("Helvetica-Bold").fillColor("#475569").text("Terms and Conditions:", 36, y);
      pdf.font("Helvetica").fontSize(6.5).fillColor("#64748B").text(doc.terms || "1. Prices are exclusive of freight unless stated. 2. Delivery within 7-10 working days of order confirmation. 3. We declare that this document shows the actual price of the goods described and that all particulars are true and correct.", 36, y + 10, { width: 523 });

      // Footer
      pdf.fontSize(6.5).font("Helvetica").text(`Page 1 of 1 · ${doc.number || doc.challanNumber || ""} · Powered by NovaSaaS Hospitality Engine`, 36, 792, { align: "center", width: 523 });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}
