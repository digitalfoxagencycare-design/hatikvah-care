import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEwbGovtJson, generateSandboxEwb } from "../src/services/ewaybill.js";

describe("E-Way Bill Generation & NIC Govt JSON Schema", () => {
  it("builds valid official NIC v1.0.03 JSON for intra-state invoice", () => {
    const mockInvoice = {
      number: "INV2627/005",
      date: "2026-11-13",
      status: "paid",
      placeOfSupply: "36",
      customer: {
        name: "Hyderabad Grand Hotel",
        gstin: "36AABCT1332L1ZF",
        shippingAddress: "Jubilee Hills, Hyderabad",
        city: "Hyderabad",
        deliveryPincode: "500033",
        stateCode: "36",
      },
      totals: {
        taxable: 6000000, // 60,000 Rs
        cgst: 540000,
        sgst: 540000,
        igst: 0,
        total: 7080000, // 70,800 Rs (> 50k threshold)
      },
      items: [
        { name: "Bamboo Toothbrush", hsn: "96032100", qty: 1000, rate: 6000, gstRate: 18, unit: "pcs" },
      ],
    };

    const mockSettings = {
      gstin: "36AAACH7409R1ZZ",
      name: "HaTikvah Care",
      stateCode: "36",
      pincode: "500084",
    };

    const transport = {
      vehicleNo: "TS09EA1234",
      transDistance: "25",
      transporterName: "Local Express",
    };

    const ewb = buildEwbGovtJson({ invoice: mockInvoice, settings: mockSettings, transport });

    assert.equal(ewb.version, "1.0.03");
    assert.equal(ewb.billLists.length, 1);
    const b = ewb.billLists[0];
    assert.equal(b.docNo, "INV2627/005");
    assert.equal(b.fromGstin, "36AAACH7409R1ZZ");
    assert.equal(b.toGstin, "36AABCT1332L1ZF");
    assert.equal(b.vehicleNo, "TS09EA1234");
    assert.equal(b.transDistance, "25");
    assert.equal(b.totalValue, 60000);
    assert.equal(b.cgstValue, 5400);
    assert.equal(b.sgstValue, 5400);
    assert.equal(b.igstValue, 0);
    assert.equal(b.totInvValue, 70800);
    assert.equal(b.itemList[0].hsnCode, 96032100);
  });

  it("generateSandboxEwb returns direct API success when Sandbox mock succeeds", async () => {
    const mockInvoice = {
      number: "INV2627/005",
      date: "2026-11-13",
      placeOfSupply: "36",
      customer: { name: "Buyer Co", gstin: "36AABCT1332L1ZF" },
      totals: { taxable: 1000000, cgst: 90000, sgst: 90000, total: 1180000 },
      items: [{ name: "Item", hsn: "1234", qty: 10, rate: 100000, gstRate: 18 }],
    };

    const mockFetch = async (url) => {
      if (url.includes("/authenticate") && !url.includes("tax-payer")) {
        return { ok: true, json: async () => ({ data: { access_token: "mock-sbox-token" } }) };
      }
      if (url.includes("/tax-payer/authenticate")) {
        return { ok: true, json: async () => ({ data: { Status: 1, access_token: "mock-tax-token" } }) };
      }
      if (url.includes("/consignor/bill")) {
        return {
          ok: true,
          json: async () => ({
            code: 200,
            data: { ewayBillNo: "181002345678", ewayBillDate: "13/11/2026 12:00:00 PM", validUpto: "14/11/2026 11:59:59 PM" },
          }),
        };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    };

    const res = await generateSandboxEwb({
      invoice: mockInvoice,
      settings: { gstin: "36ADDPC0083H1Z0" },
      transport: { vehicleNo: "TS09EA1234" },
      cfg: { sandboxApiKey: "test-key", sandboxApiSecret: "test-sec" },
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "sandbox_api");
    assert.equal(res.ewbNo, "181002345678");
  });

  it("generateSandboxEwb gracefully falls back to govt_json_ready if API fails", async () => {
    const mockInvoice = {
      number: "INV2627/006",
      date: "2026-11-13",
      customer: { name: "Buyer Co" },
      totals: { taxable: 1000000, total: 1180000 },
      items: [{ name: "Item", hsn: "1234", qty: 1, rate: 1000000 }],
    };

    const mockFetch = async () => ({ ok: false, status: 500, text: async () => "Internal Error" });

    const res = await generateSandboxEwb({
      invoice: mockInvoice,
      settings: {},
      transport: {},
      cfg: {},
      fetchImpl: mockFetch,
    });

    assert.equal(res.ok, false);
    assert.ok(res.error);
    assert.ok(res.govtJson);
  });
});

