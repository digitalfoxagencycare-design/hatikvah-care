import crypto from "node:crypto";
import { GSTIN_RE, stateName } from "../lib/gst.js";
import { getSandboxToken } from "./sandbox_gst.js";
import { getTaxpayerToken } from "./ewaybill.js";

const toRs = (paise) => Number(((paise || 0) / 100).toFixed(2));

function toEinvoiceDate(ymd) {
  if (!ymd || typeof ymd !== "string") return "";
  const parts = ymd.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return ymd;
}

function normalizeHsn(rawHsn) {
  if (!rawHsn) {
    throw new Error("Mandatory HSN code is missing for E-Invoicing item.");
  }
  let hsn = String(rawHsn).replace(/\D/g, "");
  if (!hsn || hsn.length < 4) {
    throw new Error(`Invalid HSN code "${rawHsn}". E-Invoicing requires at least a 4-digit numeric HSN.`);
  }
  if (hsn.length === 8 && hsn.endsWith("0000")) hsn = hsn.slice(0, 4);
  return hsn.slice(0, 8);
}

/**
 * Computes official 64-character SHA-256 IRN hash:
 * Hash = SHA-256(SupplierGSTIN + FinYear + DocType + DocNo)
 */
export function computeIrnHash(supplierGstin, finYear, docType, docNo) {
  const raw = `${supplierGstin}${finYear}${docType}${docNo}`.toUpperCase();
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Builds standard Government E-Invoice JSON (schema v1.1 / v1.03)
 * Suitable for direct 1-click submission to IRP or offline portal upload on einvoice1.gst.gov.in
 */
export function buildEinvoiceGovtJson({ invoice, settings = {}, cfg = {} }) {
  const rawSellerGstin = (settings.gstin || cfg.einvoiceGstin || cfg.ewbGstin || "").trim().toUpperCase();
  if (!rawSellerGstin || !GSTIN_RE.test(rawSellerGstin)) {
    throw new Error("Valid 15-character Seller GSTIN is required for E-Invoicing. Configure GSTIN in Settings.");
  }
  const sellerGstin = rawSellerGstin;
  const sellerStateCode = String(settings.stateCode || sellerGstin.slice(0, 2) || "36").padStart(2, "0");

  const rawBuyerGstin = (invoice.customer?.gstin || "").trim().toUpperCase();
  if (!rawBuyerGstin || !GSTIN_RE.test(rawBuyerGstin) || rawBuyerGstin === "URP") {
    throw new Error("E-Invoicing is legally restricted to B2B supplies and requires a valid 15-character recipient GSTIN.");
  }
  const buyerGstin = rawBuyerGstin;
  const buyerStateCode = String(invoice.placeOfSupply || invoice.customer?.stateCode || sellerStateCode).padStart(2, "0");
  const isInterState = sellerStateCode !== buyerStateCode;

  const rawBuyerPin = String(invoice.customer?.deliveryPincode || invoice.customer?.pincode || "").replace(/\D/g, "");
  if (rawBuyerPin.length !== 6) {
    throw new Error("Valid 6-digit delivery/billing PIN code is required for E-Invoicing recipient.");
  }
  const buyerPin = Number(rawBuyerPin);

  const docNo = String(invoice.number || "INV01").replace(/[^A-Za-z0-9\/-]/g, "").slice(0, 16);
  const docDate = toEinvoiceDate(invoice.date);

  const cleanItems = (invoice.items || []).map((it, idx) => {
    const qty = Number(it.qty) || 1;
    const rateRs = toRs(it.rate);
    const grossAmtRs = toRs(it.amount ?? (it.rate * qty));
    const discountRs = toRs(it.discount || 0);
    // Correct rupee subtraction without double division by 100
    const taxableRs = Number(Math.max(0, grossAmtRs - discountRs).toFixed(2));
    // Preserve 0% GST (nil-rated / exempt)
    const gstRate = it.gstRate !== undefined && it.gstRate !== null ? Number(it.gstRate) : 18;

    const cgstAmtRs = isInterState ? 0 : Number(((taxableRs * (gstRate / 2)) / 100).toFixed(2));
    const sgstAmtRs = isInterState ? 0 : Number(((taxableRs * (gstRate / 2)) / 100).toFixed(2));
    const igstAmtRs = isInterState ? Number(((taxableRs * gstRate) / 100).toFixed(2)) : 0;
    const totItemValRs = Number((taxableRs + cgstAmtRs + sgstAmtRs + igstAmtRs).toFixed(2));

    return {
      SlNo: String(idx + 1),
      PrdDesc: String(it.name || "Hospitality Item").slice(0, 100),
      IsServc: "N",
      HsnCd: normalizeHsn(it.hsn),
      Qty: qty,
      Unit: (it.unit || it.uom || "NOS").toUpperCase().slice(0, 3) || "NOS",
      UnitPrice: rateRs,
      TotAmt: grossAmtRs,
      Discount: discountRs,
      AssAmt: taxableRs,
      GstRt: gstRate,
      CgstAmt: cgstAmtRs,
      SgstAmt: sgstAmtRs,
      IgstAmt: igstAmtRs,
      CesRt: 0,
      CesAmt: 0,
      TotItemVal: totItemValRs,
    };
  });

  const totals = invoice.totals || {};
  const totalTaxableRs = toRs(totals.taxable);
  const totalCgstRs = isInterState ? 0 : toRs(totals.cgst);
  const totalSgstRs = isInterState ? 0 : toRs(totals.sgst);
  const totalIgstRs = isInterState ? toRs(totals.igst) : 0;
  const grandTotalRs = toRs(totals.total);
  const roundOffRs = toRs(totals.roundOff || 0);

  const sellerAddr = (settings.address || "Kondapur, Hyderabad").replace(/[\r\n]+/g, ", ");
  const buyerAddr = (invoice.customer?.shippingAddress || invoice.customer?.billingAddress || "Hyderabad, Telangana").replace(/[\r\n]+/g, ", ");

  const payload = {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B",
      RegRev: "N",
      EcmGstin: null,
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: "INV",
      No: docNo,
      Dt: docDate,
    },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: String(settings.name || "HaTikvah Care").slice(0, 100),
      TrdNm: String(settings.name || "HaTikvah Care").slice(0, 100),
      Addr1: sellerAddr.slice(0, 100),
      Loc: String(settings.city || "Hyderabad").slice(0, 50),
      Pin: Number(settings.pincode || "500084"),
      Stcd: sellerStateCode,
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: String(invoice.customer?.name || "Customer").slice(0, 100),
      TrdNm: String(invoice.customer?.name || "Customer").slice(0, 100),
      Pos: buyerStateCode,
      Addr1: buyerAddr.slice(0, 100),
      Loc: String(invoice.customer?.city || "Hyderabad").slice(0, 50),
      Pin: buyerPin,
      Stcd: buyerStateCode,
    },
    ItemList: cleanItems,
    ValDtls: {
      AssVal: totalTaxableRs,
      CgstVal: totalCgstRs,
      SgstVal: totalSgstRs,
      IgstVal: totalIgstRs,
      CesVal: 0,
      RndOffAmt: roundOffRs,
      TotInvVal: grandTotalRs,
    },
  };

  return payload;
}

/**
 * Generates an IRP E-Invoice through Sandbox.co.in or official Government JSON export.
 * NEVER returns a fabricated IRN hash or fake acknowledgement number as active.
 */
export async function generateSandboxEinvoice({ invoice, settings = {}, cfg = {}, fetchImpl = fetch }) {
  const buyerGstin = (invoice.customer?.gstin || "").trim().toUpperCase();
  const isB2B = GSTIN_RE.test(buyerGstin);

  if (!isB2B) {
    return {
      ok: false,
      error: "E-Invoice is only mandatory and valid for B2B supplies with registered GSTIN.",
      isB2B: false,
    };
  }

  let govtJson;
  try {
    govtJson = buildEinvoiceGovtJson({ invoice, settings, cfg });
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }

  const hasCredentials = Boolean(
    (cfg.sandboxApiKey || process.env.SANDBOX_API_KEY) &&
    (cfg.ewbGstin || process.env.EWB_GSTIN || settings.gstin)
  );

  if (!hasCredentials) {
    // Return verified official JSON for manual upload without claiming fake active IRN
    return {
      ok: true,
      source: "govt_json_ready",
      status: "prepared",
      irn: null,
      ackNo: null,
      ackDate: null,
      signedQrCode: null,
      message: "Official Government E-Invoice JSON (schema v1.1) generated. Ready for manual upload on einvoice1.gst.gov.in",
      govtJson,
    };
  }

  try {
    const apiKey = String(cfg.sandboxApiKey || process.env.SANDBOX_API_KEY || "").split(/\s+/)[0].trim();
    const taxpayerToken = await getTaxpayerToken(cfg, fetchImpl);

    const res = await fetchImpl("https://api.sandbox.co.in/gst/compliance/e-invoice/invoice", {
      method: "POST",
      headers: {
        authorization: taxpayerToken,
        "x-api-key": apiKey,
        "x-source": "primary",
        "x-api-version": "1.0.0",
        "content-type": "application/json",
      },
      body: JSON.stringify(govtJson),
    });

    if (res.ok) {
      const data = await res.json();
      const einvData = data.data?.data || data.data || {};
      const irn = String(einvData.Irn || einvData.irn || "").trim();

      if (irn) {
        const ackNo = String(einvData.AckNo || einvData.ackNo || "").trim();
        const ackDate = String(einvData.AckDt || einvData.ackDate || "").trim();
        const signedInvoice = String(einvData.SignedInvoice || einvData.signedInvoice || "").trim();
        const signedQrCode = String(einvData.SignedQRCode || einvData.signedQrCode || "").trim();

        // Fail-closed verification: active status strictly requires verified response containing signed QR, signed invoice, and IRP ack
        const isVerifiedActive = Boolean(irn && irn.length === 64 && ackNo && ackDate && signedInvoice && signedQrCode);

        if (!isVerifiedActive) {
          return {
            ok: false,
            source: "sandbox_irp_api",
            error: "IRP response is incomplete: missing AckNo, AckDt, SignedInvoice, or SignedQRCode. Cannot mark IRN as verified active.",
            status: "unverified",
            irn,
            ackNo: ackNo || null,
            ackDate: ackDate || null,
            signedInvoice: signedInvoice || null,
            signedQrCode: signedQrCode || null,
            govtJson,
          };
        }

        return {
          ok: true,
          source: "sandbox_irp_api",
          irn,
          ackNo,
          ackDate,
          signedInvoice,
          signedQrCode,
          ewbNo: String(einvData.EwbNo || "").trim(),
          status: "active",
          isVerified: true,
          govtJson,
        };
      }

      if (data.data?.error || data.data?.info) {
        const errMsg = data.data?.error?.message || data.data?.info || "IRP rejected E-Invoice";
        return { ok: false, error: errMsg, govtJson };
      }
    } else {
      const txt = await res.text().catch(() => "");
      console.warn("Sandbox IRP API returned non-OK:", res.status, txt);
      return {
        ok: false,
        error: `Sandbox IRP returned status ${res.status}: ${txt.slice(0, 150)}`,
        govtJson,
      };
    }
  } catch (err) {
    console.warn("IRP API call exception:", err.message);
    return {
      ok: false,
      source: "error",
      error: `IRP registration failed: ${err.message}`,
      govtJson,
    };
  }

  return {
    ok: true,
    source: "govt_json_ready",
    status: "prepared",
    irn: null,
    ackNo: null,
    ackDate: null,
    signedQrCode: null,
    govtJson,
  };
}

/**
 * Cancels an E-Invoice on IRP (Allowed within 24 hours of generation)
 */
export async function cancelSandboxEinvoice({ irn, reason = "1", remarks = "Cancelled by admin", cfg = {}, fetchImpl = fetch }) {
  if (!irn || irn.length !== 64) {
    return { ok: false, error: "Valid 64-character IRN is required for cancellation" };
  }

  try {
    const apiKey = String(cfg.sandboxApiKey || process.env.SANDBOX_API_KEY || "").split(/\s+/)[0].trim();
    const taxpayerToken = await getTaxpayerToken(cfg, fetchImpl);

    const res = await fetchImpl("https://api.sandbox.co.in/gst/compliance/e-invoice/invoice/cancel", {
      method: "POST",
      headers: {
        authorization: taxpayerToken,
        "x-api-key": apiKey,
        "x-source": "primary",
        "x-api-version": "1.0.0",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        Irn: irn,
        CnlRsn: String(reason || "1"),
        CnlRem: String(remarks || "Order Cancelled").slice(0, 100),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.status === "FAILED" || data.error) {
        return { ok: false, error: data.error?.message || data.message || "IRP rejected cancellation request" };
      }
      const cancelData = data.data?.data || data.data || {};
      const cancelDate = cancelData.CancelDate || cancelData.cancelDate;
      if (!cancelDate) {
        return { ok: false, error: "IRP cancellation response did not contain an authoritative CancelDate" };
      }
      return { ok: true, data: cancelData, cancelDate };
    }
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `IRP cancellation returned ${res.status}: ${txt.slice(0, 150)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

