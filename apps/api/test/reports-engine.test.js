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
});
