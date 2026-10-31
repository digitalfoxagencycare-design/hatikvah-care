import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDocumentPdf } from "../src/lib/pdf.js";

describe("document PDF generation", () => {
  it("generates a valid A4 PDF buffer with %PDF header and UPI QR code", async () => {
    const doc = {
      number: "Q/2026-27/0010",
      date: "2026-10-31",
      validUntil: "2026-11-15",
      placeOfSupply: "36",
      customer: { name: "Lokesh", phone: "+91 9701463241", shippingAddress: "Hyderabad, Telangana" },
      items: [{ name: "BIO Red Grapefruit Shampoo 380ml", hsn: "3401", rate: 23000, qty: 1, amount: 23000, gstRate: 18, total: 27140 }],
      totals: { taxable: 23000, cgst: 2070, sgst: 2070, tax: 4140, total: 27100, roundOff: -40 }
    };
    const company = { legalName: "M/s. EXL MARKETING", name: "HaTikvah Care", gstin: "36ADDPC0083H1Z0", upiId: "42157988420@sbi" };
    const pdfBuf = await generateDocumentPdf({ kind: "quote", doc, company });

    assert.ok(Buffer.isBuffer(pdfBuf));
    assert.ok(pdfBuf.length > 2000, `PDF size was ${pdfBuf.length}`);
    assert.equal(pdfBuf.slice(0, 4).toString(), "%PDF", "Must start with %PDF magic bytes");
  });
});
