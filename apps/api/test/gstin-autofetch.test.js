import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupGstinDetails } from "../src/services/sandbox_gst.js";

describe("GSTIN Auto-Fetch Service (Sandbox Integration)", () => {
  it("rejects invalid GSTIN format early without API call", async () => {
    const res = await lookupGstinDetails("INVALID123");
    assert.equal(res.ok, false);
    assert.equal(res.error, "INVALID_FORMAT");
  });

  it("fetches and parses taxpayer details correctly for valid GSTIN", async () => {
    // Mock fetch to test parsing reliably without network dependency in test runs
    const mockFetch = async (url, opts) => {
      if (url.includes("/authenticate")) {
        return {
          ok: true,
          json: async () => ({ data: { access_token: "mock-token-xyz" } }),
        };
      }
      if (url.includes("/gstin/search")) {
        return {
          ok: true,
          json: async () => ({
            code: 200,
            data: {
              data: {
                gstin: "36AABCT1332L1ZF",
                lgnm: "TERA SOFTWARE LIMITED",
                tradeNam: "TERA SOFTWARE LIMITED",
                sts: "Active",
                dty: "Regular",
                ctb: "Public Limited Company",
                pradr: {
                  addr: {
                    bno: "8-2-293/82/A/1107",
                    st: "ROAD NO-55",
                    loc: "JUBILEE HILLS",
                    dst: "Hyderabad",
                    pncd: "500033",
                    stcd: "Telangana",
                  },
                },
                einvoiceStatus: "Yes",
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const res = await lookupGstinDetails("36AABCT1332L1ZF", {}, mockFetch);
    assert.equal(res.ok, true);
    assert.equal(res.data.name, "TERA SOFTWARE LIMITED");
    assert.equal(res.data.stateCode, "36");
    assert.equal(res.data.city, "Hyderabad");
    assert.equal(res.data.pincode, "500033");
    assert.ok(res.data.address.includes("JUBILEE HILLS"));
    assert.equal(res.data.status, "Active");
  });
});

