import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPORT_DIVISIONS, computeReportData } from "../src/lib/reports_engine.js";

describe("Swipe 1:1 Reports Engine (Phase 3)", () => {
  it("defines all 10 standard divisions with sub-views", () => {
    assert.equal(REPORT_DIVISIONS.length, 10);
    const keys = REPORT_DIVISIONS.map((d) => d.key);
    assert.ok(keys.includes("taxes"));
    assert.ok(keys.includes("transactions"));
    assert.ok(keys.includes("bill_items"));
    assert.ok(keys.includes("items"));
    assert.ok(keys.includes("party"));
    assert.ok(keys.includes("warehouse"));
    assert.ok(keys.includes("pl"));
    assert.ok(keys.includes("payments"));
    assert.ok(keys.includes("summary"));
    assert.ok(keys.includes("eway"));
  });

  it("computes rate-wise tax summary correctly", async () => {
    const mockStore = {
      invoices: {
        all: async () => [
          {
            number: "INV01",
            date: "2026-11-10",
            placeOfSupply: "36",
            totals: { taxable: 100000, tax: 18000, total: 118000 },
            items: [{ name: "Kit", amount: 100000, gstRate: 18, tax: 18000 }],
          },
        ],
      },
      creditNotes: { all: async () => [] },
      purchases: { all: async () => [] },
      products: { all: async () => [] },
      customers: { all: async () => [] },
      suppliers: { all: async () => [] },
      payments: { all: async () => [] },
      ledger: { all: async () => [] },
      stockMoves: { all: async () => [] },
      audit: { all: async () => [] },
    };

    const res = await computeReportData({
      division: "taxes",
      view: "tax_summary",
      store: mockStore,
    });

    assert.ok(res.columns.length >= 6);
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].col1, "18%");
  });

  it("calculates bill-wise gross profit and margins", async () => {
    const mockStore = {
      invoices: {
        all: async () => [
          {
            number: "INV02",
            date: "2026-11-12",
            customer: { name: "Grand Hotel" },
            totals: { taxable: 100000 },
            items: [{ productId: "p1", rate: 10000, qty: 10 }],
          },
        ],
      },
      creditNotes: { all: async () => [] },
      purchases: { all: async () => [] },
      products: { all: async () => [{ id: "p1", name: "Towel", costPrice: 6000 }] },
      customers: { all: async () => [] },
      suppliers: { all: async () => [] },
      payments: { all: async () => [] },
      ledger: { all: async () => [] },
      stockMoves: { all: async () => [] },
      audit: { all: async () => [] },
    };

    const res = await computeReportData({
      division: "bill_items",
      view: "bill_profit_loss",
      store: mockStore,
    });

    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].col1, "INV02");
    assert.equal(res.rows[0].status, "profit");
    assert.ok(res.totals.margin);
  });

  it("strictly excludes draft invoices from sales and tax reports (H2)", async () => {
    const mockStore = {
      invoices: {
        all: async () => [
          { number: "INV01", date: "2026-11-10", status: "issued", totals: { taxable: 100000, tax: 18000, total: 118000 } },
          { number: "DRAFT01", date: "2026-11-11", status: "draft", totals: { taxable: 500000, tax: 90000, total: 590000 } },
          { number: "VOID01", date: "2026-11-12", status: "void", totals: { taxable: 200000, tax: 36000, total: 236000 } },
        ],
      },
      creditNotes: { all: async () => [] },
      purchases: { all: async () => [] },
      products: { all: async () => [] },
      customers: { all: async () => [] },
      suppliers: { all: async () => [] },
      payments: { all: async () => [] },
      ledger: { all: async () => [] },
      stockMoves: { all: async () => [] },
      audit: { all: async () => [] },
    };

    const res = await computeReportData({
      division: "taxes",
      view: "gstr1",
      store: mockStore,
    });

    // Only 1 invoice should be counted (DRAFT01 and VOID01 strictly excluded)
    assert.equal(res.totals.count, 1);
  });

  it("preserves exact odd paise split invariant cgst + sgst === tax (H4)", async () => {
    const mockStore = {
      invoices: {
        all: async () => [
          {
            number: "INV03",
            date: "2026-11-10",
            placeOfSupply: "36",
            totals: { taxable: 100, tax: 1, total: 101 },
            items: [{ name: "Small Item", amount: 100, gstRate: 18, tax: 1 }],
          },
        ],
      },
      creditNotes: { all: async () => [] },
      purchases: { all: async () => [] },
      products: { all: async () => [] },
      customers: { all: async () => [] },
      suppliers: { all: async () => [] },
      payments: { all: async () => [] },
      ledger: { all: async () => [] },
      stockMoves: { all: async () => [] },
      audit: { all: async () => [] },
    };

    const res = await computeReportData({
      division: "taxes",
      view: "tax_summary",
      store: mockStore,
    });

    assert.equal(res.rows.length, 1);
    // For 1 paise tax: cgst = 0.00, sgst = 0.01, total = 0.01
    assert.equal(res.rows[0].col7, "0.01");
  });

  it("calculates distinct net profit statement with operating expenses (H3)", async () => {
    const mockStore = {
      invoices: {
        all: async () => [
          { number: "INV04", date: "2026-11-10", status: "issued", totals: { taxable: 100000 }, items: [{ productId: "p1", qty: 2 }] },
        ],
      },
      creditNotes: { all: async () => [] },
      purchases: { all: async () => [] },
      products: { all: async () => [{ id: "p1", costPrice: 20000 }] }, // COGS = 40,000
      customers: { all: async () => [] },
      suppliers: { all: async () => [] },
      payments: { all: async () => [] },
      ledger: {
        all: async () => [
          { account: "operating_expenses", amount: 15000, date: "2026-11-10" },
        ],
      },
      stockMoves: { all: async () => [] },
      audit: { all: async () => [] },
    };

    const res = await computeReportData({
      division: "pl",
      view: "net_profit",
      store: mockStore,
    });

    assert.equal(res.rows.length, 6);
    // Net profit = 1,00,000 - 40,000 - 15,000 = 45,000 paise (450.00 Rs)
    assert.equal(res.totals.profit, "450.00");
  });
});

