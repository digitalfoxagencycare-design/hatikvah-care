import { GSTIN_RE, stateName } from "../lib/gst.js";

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Retrieves a valid Sandbox.co.in access token using API Key and Secret.
 */
export async function getSandboxToken(cfg = {}, fetchImpl = fetch) {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  let apiKey = String(cfg.sandboxApiKey || "").split(/\s+/)[0].trim();
  let apiSecret = String(cfg.sandboxApiSecret || "").trim();

  const res = await fetchImpl("https://api.sandbox.co.in/authenticate", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "x-api-secret": apiSecret,
      "x-api-version": "1.0",
      "content-type": "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Sandbox authentication failed (${res.status}): ${txt}`);
  }

  const auth = await res.json();
  const token = auth.data?.access_token || auth.access_token;
  if (!token) {
    throw new Error("No access_token returned by Sandbox authenticate");
  }

  cachedToken = token;
  tokenExpiresAt = Date.now() + 20 * 60 * 60 * 1000; // 20 hours
  return token;
}

/**
 * Searches and fetches complete taxpayer details by GSTIN from Sandbox.co.in.
 */
export async function lookupGstinDetails(rawGstin, cfg = {}, fetchImpl = fetch) {
  const gstin = String(rawGstin || "").trim().toUpperCase();
  if (!gstin || !GSTIN_RE.test(gstin)) {
    return { ok: false, error: "INVALID_FORMAT", message: "Please enter a valid 15-character GSTIN" };
  }

  let apiKey = String(cfg.sandboxApiKey || "").split(/\s+/)[0].trim();
  const token = await getSandboxToken(cfg, fetchImpl);

  // 1. Try public search endpoint (gives full name, trade name, address, e-invoice status)
  try {
    const searchRes = await fetchImpl("https://api.sandbox.co.in/gst/compliance/public/gstin/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token,
        "x-api-key": apiKey,
        "x-api-version": "1.0",
      },
      body: JSON.stringify({ gstin }),
    });

    if (searchRes.ok) {
      const json = await searchRes.json();
      const d = json.data?.data || json.data || {};
      const addr = d.pradr?.addr || {};
      const addressParts = [
        addr.bno,
        addr.bnm,
        addr.st,
        addr.loc,
        addr.dst,
        addr.pncd ? `PIN: ${addr.pncd}` : "",
        addr.stcd || stateName(gstin.slice(0, 2)),
      ].filter(Boolean);

      return {
        ok: true,
        data: {
          gstin: d.gstin || gstin,
          name: d.tradeNam || d.lgnm || "",
          legalName: d.lgnm || "",
          tradeName: d.tradeNam || "",
          status: d.sts || "Active",
          taxpayerType: d.dty || "Regular",
          constitution: d.ctb || "",
          stateCode: gstin.slice(0, 2),
          stateName: addr.stcd || stateName(gstin.slice(0, 2)),
          city: addr.dst || addr.loc || "",
          pincode: addr.pncd || "",
          address: addressParts.join(", "),
          einvoiceStatus: d.einvoiceStatus || "No",
        },
      };
    }
  } catch (err) {
    console.warn("Sandbox GST search failed, falling back to verify:", err.message);
  }

  // 2. Fallback to verify endpoint if search had an issue
  try {
    const verifyRes = await fetchImpl("https://api.sandbox.co.in/gst/compliance/public/gstin/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token,
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ gstin }),
    });

    if (verifyRes.ok) {
      const json = await verifyRes.json();
      const d = json.data?.data || json.data || {};
      return {
        ok: true,
        data: {
          gstin: d.gstin || gstin,
          name: d.legalName || "",
          legalName: d.legalName || "",
          tradeName: "",
          status: d.status || "Active",
          taxpayerType: d.bussNature || "Regular",
          constitution: "",
          stateCode: d.stateCode || gstin.slice(0, 2),
          stateName: d.stateName || stateName(gstin.slice(0, 2)),
          city: "",
          pincode: "",
          address: d.stateName || "",
          einvoiceStatus: "Unknown",
        },
      };
    }

    const errJson = await verifyRes.json().catch(() => ({}));
    return {
      ok: false,
      error: "GSTIN_LOOKUP_FAILED",
      message: errJson.message || `No GST record found for ${gstin}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: "NETWORK_ERROR",
      message: `Failed to connect to GST server: ${err.message}`,
    };
  }
}

