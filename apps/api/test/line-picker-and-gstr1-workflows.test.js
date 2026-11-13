import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGstr1 } from "../src/lib/gstr1/builder.js";
import { parseGstr1Period } from "../src/lib/gstr1/period.js";
import { calcTotals } from "../src/lib/gst.js";

describe("Workflow Acceptance Tests: Product Picker, Invoicing, Quotes & GSTR-1", () => {
  it("calculates intra-state and inter-state GST invariants correctly", () => {
    // Intra-state 18% item: 1000 rupees (100000 paise)
    const items = [
      { productId: "p1", name: "Dental Kit", hsn: "96050000", qty: 2, rate: 5000, discountPct: 0, gstRate: 18 },
    ];
    // Intra-state (Telangana to Telangana)
    const intra = calcTotals(items, false);
    assert.equal(intra.totals.taxable, 10000);
    assert.equal(intra.totals.cgst, 900);
    assert.equal(intra.totals.sgst, 900);
    assert.equal(intra.totals.igst, 0);
    assert.equal(intra.totals.total, 11800);

    // Inter-state (Telangana to Karnataka)
    const inter = calcTotals(items, true);
    assert.equal(inter.totals.taxable, 10000);
    assert.equal(inter.totals.cgst, 0);
    assert.equal(inter.totals.sgst, 0);
    assert.equal(inter.totals.igst, 1800);
    assert.equal(inter.totals.total, 11800);
  });

  it("GSTR-1 period parser handles FY format accurately", () => {
    const p1 = parseGstr1Period("FY 26-27");
    assert.equal(p1.from, "2026-04-01");
    assert.equal(p1.to, "2027-03-31");
    assert.equal(p1.fp, "032027");

    const p2 = parseGstr1Period("FY 23-24");
    assert.equal(p2.from, "2023-04-01");
    assert.equal(p2.to, "2024-03-31");
    assert.equal(p2.fp, "032024");
  });

  it("GSTR-1 JSON builder strictly categorizes B2B with GSTIN and B2CS for retail", () => {
    const mockInvoices = [
      {
        id: "inv-1",
        number: "INV2627/001",
        date: "2026-11-01",
        status: "paid",
        placeOfSupply: "36",
        customer: {
          name: "OASIS Party Hall",
          gstin: "36AAAAA0000A1Z5",
          stateCode: "36",
        },
        totals: {
          taxable: 100000,
          cgst: 9000,
          sgst: 9000,
          igst: 0,
          total: 118000,
        },
        items: [
          { name: "Anchor Toothpaste", hsn: "33061020", qty: 20, rate: 5000, gstRate: 18, uom: "piece" },
        ],
      },
      {
        id: "inv-2",
        number: "INV2627/002",
        date: "2026-11-05",
        status: "unpaid",
        placeOfSupply: "36",
        customer: {
          name: "Walk-in Retail Buyer",
          gstin: "",
          stateCode: "36",
        },
        totals: {
          taxable: 50000,
          cgst: 4500,
          sgst: 4500,
          igst: 0,
          total: 59000,
        },
        items: [
          { name: "Hotel Comb", hsn: "96151100", qty: 50, rate: 1000, gstRate: 18, uom: "piece" },
        ],
      },
    ];

    const mockCompany = {
      gstin: "36AAACH7409R1ZZ",
      name: "HaTikvah Care",
      stateCode: "36",
    };

    const period = { from: "2026-04-01", to: "2027-03-31", fp: "032027", fy: "2026-27" };
    const { gstJson, preview } = buildGstr1({ invoices: mockInvoices, creditNotes: [], settings: mockCompany, period });

    // Verify official B2B JSON and Preview
    assert.equal(gstJson.b2b.length, 1);
    assert.equal(gstJson.b2b[0].ctin, "36AAAAA0000A1Z5");
    assert.equal(gstJson.b2b[0].inv[0].inum, "INV2627/001");
    assert.equal(gstJson.b2b[0].inv[0].val, 1180.0);
    assert.equal(preview.b2b.length, 1);
    assert.equal(preview.b2b[0].customerName, "OASIS Party Hall");

    // Verify B2CS
    assert.equal(gstJson.b2cs.length, 1);
    assert.equal(gstJson.b2cs[0].txval, 500.0);
    assert.equal(preview.b2cs.length, 1);

    // Verify HSN Summary
    assert.ok(gstJson.hsn.data.length >= 2);
    const hsnCodes = gstJson.hsn.data.map((x) => x.hsn_sc);
    assert.ok(hsnCodes.includes("33061020"));
    assert.ok(hsnCodes.includes("96151100"));
  });
});
