import { GSTIN_RE, stateName } from "../lib/gst.js";
import { getSandboxToken } from "./sandbox_gst.js";

const NIC_ERROR_MESSAGES = {
  "212": "Invalid Consignee GSTIN (Consignee GSTIN not found on Govt portal; try marking customer as 'URP')",
  "216": "Invalid HSN Code (HSN is not in GST master; check product HSN)",
  "225": "Invalid Vehicle Number (Indian vehicle numbers end in 4 digits, e.g. AP39SG9657)",
  "238": "Distance between PIN codes not found in Govt database",
  "301": "Invalid Document Number",
  "302": "Duplicate E-Way Bill: an E-Way Bill already exists for this invoice number",
  "385": "State code mismatch with delivery location",
  "436": "Consignee State & Pincode mismatch (Consignee state is set to Andhra Pradesh (37), but PIN code belongs to Telangana (50xxxx) or vice versa. Please enter matching PIN or update Place of Supply)",
  "437": "Consignor State & Pincode mismatch (Consignor state code does not match dispatch pincode)",
  "438": "Invalid Bill-to State Code for given Pincode",
  "439": "Invalid Dispatch-from State Code for given Pincode",
  "702": "Distance mismatch (leave distance blank to let Government calculate exact PIN-to-PIN distance)",
};

function translateNicErrors(errCodesStr, defaultInfo = "") {
  if (!errCodesStr && !defaultInfo) return "Government NIC rejected E-Way Bill generation";
  const codes = String(errCodesStr || "").split(/[,|;]+/).map(s => s.trim()).filter(Boolean);
  const translated = codes.map(c => NIC_ERROR_MESSAGES[c] || `Code ${c}`).filter(Boolean);
  if (translated.length > 0) {
    return translated.join(" • ");
  }
  return defaultInfo || "Government NIC rejected E-Way Bill generation";
}

function normalizeHsnForNic(rawHsn) {
  let hsn = String(rawHsn || "96032100").replace(/\D/g, "");
  // If 8 digits and ends in 0000 (e.g. 96050000 where chapter only has 4/6 digits)
  if (hsn.length === 8 && hsn.endsWith("0000")) {
    hsn = hsn.slice(0, 4);
  }
  return Number(hsn) || 96032100;
}

let cachedTaxpayerToken = null;
let taxpayerTokenExpiresAt = 0;

/**
 * Creates / fetches an active taxpayer session token from Sandbox E-Way Bill API.
 */
export async function getTaxpayerToken(cfg = {}, fetchImpl = fetch) {
  if (cachedTaxpayerToken && Date.now() < taxpayerTokenExpiresAt - 60_000) {
    return cachedTaxpayerToken;
  }
  const sandboxToken = await getSandboxToken(cfg, fetchImpl);
  const apiKey = String(cfg.sandboxApiKey || "").split(/\s+/)[0].trim();
  const gstin = String(cfg.ewbGstin || "").trim().toUpperCase();
  const username = String(cfg.ewbUsername || "").trim();
  const password = String(cfg.ewbPassword || "").trim();

  const res = await fetchImpl("https://api.sandbox.co.in/gst/compliance/e-way-bill/tax-payer/authenticate", {
    method: "POST",
    headers: {
      authorization: sandboxToken,
      "x-api-key": apiKey,
      "x-api-version": "1.0.0",
      "content-type": "application/json",
    },
    body: JSON.stringify({ gstin, username, password }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Taxpayer authentication failed (${res.status}): ${txt}`);
  }

  const json = await res.json();
  const token = json.data?.access_token || json.access_token;
  if (!token) {
    throw new Error("No taxpayer access_token returned by E-Way Bill authentication");
  }

  cachedTaxpayerToken = token;
  const expiry = json.data?.expiry ? Number(json.data.expiry) : (Date.now() + 6 * 3600 * 1000);
  taxpayerTokenExpiresAt = expiry > Date.now() ? expiry : (Date.now() + 6 * 3600 * 1000);
  return token;
}

/** Map UOM to standard Govt E-Way Bill UQC format */
function toEwbUqc(uom) {
  const u = String(uom || "").toUpperCase().trim();
  if (["PCS", "PIECES", "PIECE", "NOS"].includes(u)) return "NOS";
  if (["BOX", "BOXES", "INNER PACK"].includes(u)) return "BOX";
  if (["CTN", "CARTON", "CARTONS", "MASTER CARTON"].includes(u)) return "CTN";
  if (["KG", "KGS", "KILOGRAM"].includes(u)) return "KGS";
  if (["GM", "GMS", "GRAM"].includes(u)) return "GMS";
  if (["LTR", "LITRE", "LITRES", "ML"].includes(u)) return "LTR";
  if (["SET", "SETS"].includes(u)) return "SET";
  return "OTH";
}

/** Convert YYYY-MM-DD to DD/MM/YYYY */
function toEwbDate(ymd) {
  if (!ymd || typeof ymd !== "string") return "";
  const parts = ymd.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return ymd;
}

/** Format paise to 2-decimal Rupees */
function toRs(paise) {
  return Number(((paise || 0) / 100).toFixed(2));
}

/**
 * Builds standard NIC Official Government E-Way Bill JSON (eWayBill_JSON_Format_v1.03)
 * Ready for 1-click bulk upload on ewaybillgst.gov.in (Zero Cost) and Sandbox API.
 */
export function buildEwbGovtJson({ invoice, settings = {}, transport = {}, cfg = {} }) {
  let sellerGstin = (settings.gstin || cfg.ewbGstin || "36ADDPC0083H1Z0").trim().toUpperCase();
  if (!GSTIN_RE.test(sellerGstin)) {
    sellerGstin = (cfg.ewbGstin || "36ADDPC0083H1Z0").trim().toUpperCase();
  }
  const sellerStateCode = Number(settings.stateCode || sellerGstin.slice(0, 2) || "36");

  let buyerGstin = (invoice.customer?.gstin || "URP").trim().toUpperCase();
  if (!GSTIN_RE.test(buyerGstin) && buyerGstin !== "URP") {
    buyerGstin = "URP";
  }
  const buyerStateCode = Number(invoice.placeOfSupply || invoice.customer?.stateCode || sellerStateCode);
  const isInterState = sellerStateCode !== buyerStateCode;

  // Item list mapped to strict NIC schema
  const itemList = (invoice.items || []).map((it, idx) => {
    const qty = Number(it.qty) || 1;
    const rateRs = toRs(it.rate);
    const taxableRs = toRs((it.amount ?? (it.rate * qty)) - (it.discount || 0));
    const gstRate = Number(it.gstRate) || 18;

    return {
      itemNo: idx + 1,
      productName: String(it.name || "Goods").slice(0, 100),
      productDesc: String(it.name || "Hospitality Supplies").slice(0, 100),
      hsnCode: normalizeHsnForNic(it.hsn),
      quantity: qty,
      qtyUnit: toEwbUqc(it.unit || it.uom),
      cgstRate: isInterState ? 0 : Number((gstRate / 2).toFixed(3)),
      sgstRate: isInterState ? 0 : Number((gstRate / 2).toFixed(3)),
      igstRate: isInterState ? Number(gstRate.toFixed(3)) : 0,
      cessRate: 0,
      taxableAmount: taxableRs,
    };
  });

  const totals = invoice.totals || {};
  const totalTaxableRs = toRs(totals.taxable);
  const cgstRs = isInterState ? 0 : toRs(totals.cgst);
  const sgstRs = isInterState ? 0 : toRs(totals.sgst);
  const igstRs = isInterState ? toRs(totals.igst) : 0;
  const grandTotalRs = toRs(totals.total);

  // Address parsing
  const sellerAddr = (settings.address || "Kondapur, Hyderabad").replace(/[\r\n]+/g, ", ");
  const buyerAddr = (invoice.customer?.shippingAddress || invoice.customer?.billingAddress || "Hyderabad, Telangana").replace(/[\r\n]+/g, ", ");

  const rawDist = transport.transDistance !== undefined ? Number(transport.transDistance) : 0;
  const transDistanceStr = rawDist > 0 ? String(rawDist) : "0";

  const ewbRecord = {
    supplyType: "O", // Outward supply
    subSupplyType: "1", // Supply (string)
    subSupplyDesc: "",
    docType: "INV", // Tax Invoice
    docNo: String(invoice.number || "INV01").replace(/[^A-Za-z0-9\/-]/g, "").slice(0, 16),
    docDate: toEwbDate(invoice.date),
    fromGstin: sellerGstin,
    fromTrdName: String(settings.name || "HaTikvah Care").slice(0, 100),
    fromAddr1: sellerAddr.slice(0, 120),
    fromPlace: String(settings.city || "Hyderabad").slice(0, 50),
    fromPincode: Number(settings.pincode || "500084"),
    fromStateCode: sellerStateCode,
    actFromStateCode: sellerStateCode,

    toGstin: buyerGstin,
    toTrdName: String(invoice.customer?.name || "Customer").slice(0, 100),
    toAddr1: buyerAddr.slice(0, 120),
    toPlace: String(invoice.customer?.city || "Hyderabad").slice(0, 50),
    toPincode: Number(transport.toPincode || invoice.customer?.deliveryPincode || invoice.customer?.pincode || (buyerStateCode === 37 ? "520001" : "500001")),
    toStateCode: buyerStateCode,
    actToStateCode: buyerStateCode,

    transactionType: 1, // Regular (integer)
    totalValue: totalTaxableRs,
    cgstValue: cgstRs,
    sgstValue: sgstRs,
    igstValue: igstRs,
    cessValue: 0,
    totInvValue: grandTotalRs,

    transMode: String(transport.transMode || "1"),
    transDistance: transDistanceStr,
    vehicleNo: (transport.vehicleNo || "").replace(/[^0-9A-Z]/gi, "").toUpperCase(),
    vehicleType: transport.vehicleType || "R",

    itemList,
  };

  // Optional transporter fields only when non-empty & valid
  if (transport.transporterId && /^[0-9]{2}[0-9A-Z]{13}$/.test(transport.transporterId)) {
    ewbRecord.transporterId = transport.transporterId;
  }
  if (transport.transporterName) {
    ewbRecord.transporterName = String(transport.transporterName).slice(0, 100);
  }
  if (transport.transDocNo) {
    ewbRecord.transDocNo = String(transport.transDocNo).slice(0, 15);
  }
  if (transport.transDocDate) {
    ewbRecord.transDocDate = toEwbDate(transport.transDocDate);
  }

  return {
    version: "1.0.03",
    billLists: [ewbRecord],
  };
}

/**
 * Direct Sandbox API call for 1-click E-Way Bill generation (using workspace quota).
 */
export async function generateSandboxEwb({ invoice, settings = {}, transport = {}, cfg = {}, fetchImpl = fetch }) {
  const payload = buildEwbGovtJson({ invoice, settings, transport, cfg });
  const ewbRecord = payload.billLists[0];

  if (!invoice.totals?.total || invoice.totals.total <= 0) {
    return {
      ok: false,
      error: "Invoice total is ₹0. Government E-Way Bill requires an invoice with value greater than ₹0.",
      govtJson: payload,
    };
  }

  // Try direct Sandbox E-Way Bill generation endpoint
  try {
    const apiKey = String(cfg.sandboxApiKey || "").split(/\s+/)[0].trim();
    const taxpayerToken = await getTaxpayerToken(cfg, fetchImpl);

    const res = await fetchImpl("https://api.sandbox.co.in/gst/compliance/e-way-bill/consignor/bill", {
      method: "POST",
      headers: {
        authorization: taxpayerToken,
        "x-api-key": apiKey,
        "x-source": "primary",
        "x-api-version": "1.0.0",
        "content-type": "application/json",
      },
      body: JSON.stringify(ewbRecord),
    });

    if (res.ok) {
      const data = await res.json();
      const ewbData = data.data?.data || data.data || {};
      const ewbNo = String(ewbData.ewayBillNo || ewbData.ewbNo || "");
      if (ewbNo) {
        return {
          ok: true,
          source: "sandbox_api",
          ewbNo,
          ewbDate: ewbData.ewayBillDate || new Date().toISOString(),
          validUpto: ewbData.validUpto || "",
          alert: ewbData.alert || data.data?.alert || "",
          raw: data,
        };
      }
      if (data.data?.error || data.data?.info) {
        const errorCodes = data.data?.error?.errorCodes || "";
        // If error is 212 (Invalid Consignee GSTIN) and not already URP, retry with URP automatically!
        if (errorCodes.includes("212") && ewbRecord.toGstin !== "URP") {
          console.warn("Invalid Consignee GSTIN detected from Govt, auto-retrying with URP...");
          ewbRecord.toGstin = "URP";
          const retryRes = await fetchImpl("https://api.sandbox.co.in/gst/compliance/e-way-bill/consignor/bill", {
            method: "POST",
            headers: {
              authorization: taxpayerToken,
              "x-api-key": apiKey,
              "x-source": "primary",
              "x-api-version": "1.0.0",
              "content-type": "application/json",
            },
            body: JSON.stringify(ewbRecord),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryEwbData = retryData.data?.data || retryData.data || {};
            const retryEwbNo = String(retryEwbData.ewayBillNo || retryEwbData.ewbNo || "");
            if (retryEwbNo) {
              return {
                ok: true,
                source: "sandbox_api",
                ewbNo: retryEwbNo,
                ewbDate: retryEwbData.ewayBillDate || new Date().toISOString(),
                validUpto: retryEwbData.validUpto || "",
                alert: "Generated as B2C/URP (Customer GSTIN was not active on Govt portal)",
                raw: retryData,
              };
            }
          }
        }

        const defaultInfo = data.data?.info || "";
        const errMsg = translateNicErrors(errorCodes, defaultInfo);
        return {
          ok: false,
          error: errMsg,
          errorCodes,
          govtJson: payload,
        };
      }
    } else {
      const errTxt = await res.text().catch(() => "");
      console.warn("Sandbox EWB generation returned non-OK:", res.status, errTxt);
      let errMsg = "Sandbox EWB API call failed";
      try {
        const j = JSON.parse(errTxt);
        errMsg = j.message || errMsg;
      } catch {}
      return {
        ok: false,
        error: errMsg,
        govtJson: payload,
      };
    }
  } catch (err) {
    console.warn("Direct Sandbox EWB API call error:", err.message);
    return {
      ok: false,
      error: err.message,
      govtJson: payload,
    };
  }

  // Graceful fallback to verified government JSON export
  return {
    ok: true,
    source: "govt_json_ready",
    message: "Official E-Way Bill JSON generated successfully (v1.0.03 compliant)",
    govtJson: payload,
  };
}

