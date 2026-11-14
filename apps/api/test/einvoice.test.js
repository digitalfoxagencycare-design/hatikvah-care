import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEinvoiceGovtJson, computeIrnHash, generateSandboxEinvoice } from "../src/services/einvoice.js";

describe("Government IRP E-Invoice System (Phase 4)", () => {
  it("computes standard 64-character SHA-256 IRN hash", () => {
    const irn = computeIrnHash("36ADDPC0083H1Z0", "2026", "INV", "INV26270025");
    assert.equal(irn.length, 64);
    assert.match(irn, /^[a-f0-9]{64}$/);
  });

  it("builds valid official Government e-Invoice JSON schema v1.1 for B2B supplies", () => {
    const mockInvoice = {
      number: "INV/2026-27/0025",
      date: "2026-11-13",
      placeOfSupply: "36",
      customer: {
        name: "Care & Cure Multispeciality Clinic",
        gstin: "36AAACC9012C1Z8",
        shippingAddress: "Gachibowli Main Road, Hyderabad",
        city: "Hyderabad",
        pincode: "500032",
        stateCode: "36",
      },
      totals: {
        taxable: 10000000, // 1,00,000 Rs
        cgst: 900000,
        sgst: 900000,
        igst: 0,
        total: 11800000,
      },
      items: [
        { name: "Hotel Dental Kit", hsn: "96032100", qty: 1000, rate: 10000, gstRate: 18, unit: "pcs" },
      ],
    };

    const mockSettings = {
      name: "HaTikvah Care",
      gstin: "36ADDPC0083H1Z0",
      stateCode: "36",
      pincode: "500084",
    };

    const govtJson = buildEinvoiceGovtJson({ invoice: mockInvoice, settings: mockSettings });

    assert.equal(govtJson.Version, "1.1");
    assert.equal(govtJson.TranDtls.TaxSch, "GST");
    assert.equal(govtJson.TranDtls.SupTyp, "B2B");
    assert.equal(govtJson.DocDtls.Typ, "INV");
    assert.equal(govtJson.DocDtls.Dt, "13/11/2026");
    assert.equal(govtJson.SellerDtls.Gstin, "36ADDPC0083H1Z0");
    assert.equal(govtJson.BuyerDtls.Gstin, "36AAACC9012C1Z8");
    assert.equal(govtJson.ValDtls.AssVal, 100000);
    assert.equal(govtJson.ValDtls.CgstVal, 9000);
    assert.equal(govtJson.ValDtls.SgstVal, 9000);
    assert.equal(govtJson.ValDtls.TotInvVal, 118000);
    assert.equal(govtJson.ItemList.length, 1);
    assert.equal(govtJson.ItemList[0].HsnCd, "96032100");
  });

  it("generateSandboxEinvoice successfully calls Sandbox IRP or generates offline compliant IRN", async () => {
    const mockInvoice = {
      number: "INV/2026-27/0025",
      date: "2026-11-13",
      customer: {
        name: "Care & Cure Clinic",
        gstin: "36AAACC9012C1Z8",
      },
      totals: { taxable: 10000000, total: 11800000 },
      items: [{ name: "Kit", hsn: "96032100", qty: 1000, rate: 10000 }],
    };

    const mockFetch = async (url) => {
      if (url.includes("/authenticate") && !url.includes("tax-payer")) {
        return { ok: true, json: async () => ({ data: { access_token: "mock-sbox-token" } }) };
      }
      if (url.includes("/tax-payer/authenticate")) {
        return { ok: true, json: async () => ({ data: { Status: 1, access_token: "mock-tax-token" } }) };
      }
      if (url.includes("/e-invoice/invoice")) {
        return {
          ok: true,
          json: async () => ({
            code: 200,
            data: {
              Irn: computeIrnHash("36ADDPC0083H1Z0", "2026", "INV", "0025"),
              AckNo: "123456789012",
              AckDt: "2026-11-13 10:00:00",
              SignedInvoice: "mock.jwt.signed.invoice",
              SignedQRCode: "mock.jwt.signed.qr",
              Status: "ACT",
            },
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    };

    const res = await generateSandboxEinvoice({
      invoice: mockInvoice,
      settings: { gstin: "36ADDPC0083H1Z0" },
      cfg: { sandboxApiKey: "test-key" },
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.irn.length, 64);
    assert.equal(res.status, "active");
    assert.ok(res.govtJson);
  });

  it("refuses E-Invoice generation for B2C retail customers without valid GSTIN", async () => {
    const b2cInvoice = {
      number: "INV/2026-27/0027",
      date: "2026-11-14",
      customer: { name: "Retail Walkin", gstin: "URP" },
      totals: { taxable: 500000, total: 590000 },
      items: [{ name: "Item", rate: 5000, qty: 1 }],
    };

    const res = await generateSandboxEinvoice({
      invoice: b2cInvoice,
      settings: {},
    });

    assert.equal(res.ok, false);
    assert.match(res.error, /B2B supplies with registered GSTIN/i);
  });
});
