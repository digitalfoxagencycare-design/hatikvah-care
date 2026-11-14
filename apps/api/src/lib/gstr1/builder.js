import { stateName } from "../gst.js";

/** Convert YYYY-MM-DD to DD-MM-YYYY */
function toGstDate(ymd) {
  if (!ymd || typeof ymd !== "string") return "";
  const parts = ymd.split("-");
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return ymd;
}

/** Format paise integer to 2 decimal rupees number */
function toRs(paise) {
  return Number(((paise || 0) / 100).toFixed(2));
}

/** Check if string is a valid 15-char GSTIN */
export function isValidGstin(gstin) {
  return typeof gstin === "string" && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin.trim());
}

/** Map application UOM/unit to standard GST UQC */
export function mapToUqc(unit) {
  const u = String(unit || "").toUpperCase().trim();
  if (["PCS", "PIECES", "PIECE", "NOS", "NUMBERS", "COUNT"].includes(u)) return "NOS";
  if (["BOX", "BOXES", "INNER PACK"].includes(u)) return "BOX";
  if (["CTN", "CARTON", "CARTONS", "MASTER CARTON"].includes(u)) return "CTN";
  if (["KG", "KGS", "KILOGRAM"].includes(u)) return "KGS";
  if (["GM", "GMS", "GRAM"].includes(u)) return "GMS";
  if (["LTR", "LITRE", "LITRES", "ML"].includes(u)) return "LTR";
  if (["SET", "SETS"].includes(u)) return "SET";
  if (["PKT", "PACK", "PACKET", "PACKETS"].includes(u)) return "PAC";
  return "OTH";
}

/**
 * Builds standard official GSTR-1 structure and UI preview.
 */
export function buildGstr1({ invoices = [], creditNotes = [], settings = {}, period }) {
  const sellerGstin = (settings.gstin || "36ADDPC0083H1Z0").trim().toUpperCase();
  if (!isValidGstin(sellerGstin)) {
    throw new Error("Valid 15-character Seller GSTIN is required to generate statutory GSTR-1. Configure GSTIN in Settings.");
  }
  const sellerState = settings.stateCode || (sellerGstin.length >= 2 ? sellerGstin.slice(0, 2) : "36");

  const from = period.from;
  const to = period.to;
  const inRange = (d) => d && d >= from && d <= to;

  // Filter valid period transactions
  const validInvoices = invoices.filter((i) => i.status !== "void" && i.status !== "draft" && inRange(i.date));
  const voidInvoices = invoices.filter((i) => i.status === "void" && inRange(i.date));
  const validCredits = creditNotes.filter((c) => inRange(c.date));

  // --- 1. B2B, B2CL, B2CS Classification ---
  const b2bMap = new Map(); // ctin -> { ctin, inv: [] }
  const b2clMap = new Map(); // pos -> { pos, inv: [] }
  const b2csMap = new Map(); // `${sply_ty}|${pos}|${rt}` -> { sply_ty, pos, typ: "OE", rt, txval, camt, samt, iamt, csamt }

  for (const inv of validInvoices) {
    const custGstin = (inv.customer?.gstin || "").trim().toUpperCase();
    const isB2B = isValidGstin(custGstin);
    const pos = String(inv.placeOfSupply || inv.customer?.stateCode || sellerState).padStart(2, "0");
    const isInter = pos !== sellerState;
    const invTotalRs = toRs(inv.totals.total);

    // Rate-wise line grouping for this invoice
    const rateGroups = new Map();
    for (const item of inv.items || []) {
      const rt = Number(item.gstRate ?? 18);
      const rg = rateGroups.get(rt) || { txval: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 };
      const itemTaxable = item.amount ?? Math.round((Number(item.rate) || 0) * (Number(item.qty) || 0));
      const itemTax = item.tax ?? Math.round((itemTaxable * rt) / 100);
      rg.txval += itemTaxable;
      rg.tax += itemTax;
      if (isInter) {
        rg.igst += itemTax;
      } else {
        const c = Math.round(itemTax / 2);
        rg.cgst += c;
        rg.sgst += itemTax - c;
      }
      rateGroups.set(rt, rg);
    }

    if (isB2B) {
      // B2B Section
      const ctinEntry = b2bMap.get(custGstin) || { ctin: custGstin, cnm: inv.customer?.name || "", inv: [] };
      const itemsList = Array.from(rateGroups.entries()).map(([rt, vals], idx) => ({
        num: idx + 1,
        itm_det: {
          txval: toRs(vals.txval),
          rt,
          camt: toRs(vals.cgst),
          samt: toRs(vals.sgst),
          iamt: toRs(vals.igst),
          csamt: 0,
        },
      }));

      ctinEntry.inv.push({
        inum: inv.number,
        idt: toGstDate(inv.date),
        val: invTotalRs,
        pos,
        rchrg: "N",
        inv_typ: "R",
        itms: itemsList,
        customerName: inv.customer?.name || "",
      });
      b2bMap.set(custGstin, ctinEntry);
    } else if (isInter && inv.totals.total > 10000000) {
      // B2CL: Inter-state unregistered > ₹1.0 Lakh (GST Notification 04/2024 amending Rule 59)
      const posEntry = b2clMap.get(pos) || { pos, inv: [] };
      const itemsList = Array.from(rateGroups.entries()).map(([rt, vals], idx) => ({
        num: idx + 1,
        itm_det: {
          txval: toRs(vals.txval),
          rt,
          iamt: toRs(vals.igst),
          csamt: 0,
        },
      }));
      posEntry.inv.push({
        inum: inv.number,
        idt: toGstDate(inv.date),
        val: invTotalRs,
        itms: itemsList,
        customerName: inv.customer?.name || "",
      });
      b2clMap.set(pos, posEntry);
    } else {
      // B2CS: Retail unregistered intra-state or inter-state <= ₹2.5L
      const sply_ty = isInter ? "INTER" : "INTRA";
      for (const [rt, vals] of rateGroups.entries()) {
        const key = `${sply_ty}|${pos}|${rt}`;
        const existing = b2csMap.get(key) || {
          sply_ty,
          pos,
          typ: "OE",
          rt,
          txval: 0,
          camt: 0,
          samt: 0,
          iamt: 0,
          csamt: 0,
        };
        existing.txval += vals.txval;
        existing.camt += vals.cgst;
        existing.samt += vals.sgst;
        existing.iamt += vals.igst;
        b2csMap.set(key, existing);
      }
    }
  }

  // --- 2. CDNR & CDNUR (Credit Notes) ---
  const cdnrMap = new Map();
  const cdnurList = [];

  for (const cn of validCredits) {
    const custGstin = (cn.customer?.gstin || "").trim().toUpperCase();
    const isB2B = isValidGstin(custGstin);
    const pos = String(cn.placeOfSupply || sellerState).padStart(2, "0");
    const isInter = pos !== sellerState;
    const cnTotalRs = toRs(cn.totals.total);

    const rateGroups = new Map();
    for (const item of cn.items || []) {
      const rt = Number(item.gstRate ?? 18);
      const rg = rateGroups.get(rt) || { txval: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 };
      const itemTaxable = item.amount ?? Math.round((Number(item.rate) || 0) * (Number(item.qty) || 0));
      const itemTax = item.tax ?? Math.round((itemTaxable * rt) / 100);
      rg.txval += itemTaxable;
      rg.tax += itemTax;
      if (isInter) {
        rg.igst += itemTax;
      } else {
        const c = Math.round(itemTax / 2);
        rg.cgst += c;
        rg.sgst += itemTax - c;
      }
      rateGroups.set(rt, rg);
    }

    const itemsList = Array.from(rateGroups.entries()).map(([rt, vals], idx) => ({
      num: idx + 1,
      itm_det: {
        txval: toRs(vals.txval),
        rt,
        camt: toRs(vals.cgst),
        samt: toRs(vals.sgst),
        iamt: toRs(vals.igst),
        csamt: 0,
      },
    }));

    const notePayload = {
      nt_num: cn.number,
      nt_dt: toGstDate(cn.date),
      ntty: "C",
      p_gst: "N",
      inum: cn.invoiceNumber || "",
      idt: toGstDate(cn.invoiceDate || cn.date),
      val: cnTotalRs,
      itms: itemsList,
      customerName: cn.customer?.name || "",
    };

    if (isB2B) {
      const ctinEntry = cdnrMap.get(custGstin) || { ctin: custGstin, cnm: cn.customer?.name || "", nt: [] };
      ctinEntry.nt.push(notePayload);
      cdnrMap.set(custGstin, ctinEntry);
    } else {
      cdnurList.push({
        typ: isInter && cn.totals.total > 25000000 ? "B2CL" : "B2CS",
        nt_num: cn.number,
        nt_dt: toGstDate(cn.date),
        ntty: "C",
        inum: cn.invoiceNumber || "",
        idt: toGstDate(cn.invoiceDate || cn.date),
        val: cnTotalRs,
        itms: itemsList,
        customerName: cn.customer?.name || "",
      });
    }
  }

  // --- 3. HSN Summary ---
  const hsnMap = new Map();
  for (const inv of validInvoices) {
    for (const item of inv.items || []) {
      const hsnCode = (item.hsn || "9999").trim();
      const uqc = mapToUqc(item.unit);
      const rt = Number(item.gstRate ?? 18);
      const key = `${hsnCode}|${uqc}|${rt}`;

      const itemTaxable = item.amount ?? Math.round((Number(item.rate) || 0) * (Number(item.qty) || 0));
      const itemTax = item.tax ?? Math.round((itemTaxable * rt) / 100);
      const itemTot = itemTaxable + itemTax;
      const isInter = String(inv.placeOfSupply || sellerState) !== sellerState;

      const entry = hsnMap.get(key) || {
        hsn_sc: hsnCode,
        desc: item.name || "Goods",
        uqc,
        qty: 0,
        val: 0,
        txval: 0,
        camt: 0,
        samt: 0,
        iamt: 0,
        csamt: 0,
      };

      entry.qty += Number(item.qty) || 0;
      entry.val += itemTot;
      entry.txval += itemTaxable;
      if (isInter) {
        entry.iamt += itemTax;
      } else {
        const c = Math.round(itemTax / 2);
        entry.camt += c;
        entry.samt += itemTax - c;
      }
      hsnMap.set(key, entry);
    }
  }

  const hsnData = Array.from(hsnMap.values()).map((h, idx) => ({
    num: idx + 1,
    hsn_sc: h.hsn_sc,
    desc: h.desc,
    uqc: h.uqc,
    qty: Math.round(h.qty),
    val: toRs(h.val),
    txval: toRs(h.txval),
    camt: toRs(h.camt),
    samt: toRs(h.samt),
    iamt: toRs(h.iamt),
    csamt: 0,
  }));

  // --- 4. Document Issued Summary (doc_issue) ---
  const allPeriodInvoices = invoices.filter((i) => i.status !== "draft" && inRange(i.date)).sort((a, b) => (a.number < b.number ? -1 : 1));
  const allPeriodCredits = creditNotes.filter((c) => inRange(c.date)).sort((a, b) => (a.number < b.number ? -1 : 1));

  const docSections = [];
  if (allPeriodInvoices.length > 0) {
    docSections.push({
      doc_num: 1,
      doc_typ: "Invoices for outward supply",
      docs: [
        {
          num: 1,
          from: allPeriodInvoices[0]?.number || "",
          to: allPeriodInvoices[allPeriodInvoices.length - 1]?.number || "",
          totnum: allPeriodInvoices.length,
          canc: voidInvoices.length,
          net_issue: validInvoices.length,
        },
      ],
    });
  }
  if (allPeriodCredits.length > 0) {
    docSections.push({
      doc_num: 2,
      doc_typ: "Credit Note",
      docs: [
        {
          num: 1,
          from: allPeriodCredits[0]?.number || "",
          to: allPeriodCredits[allPeriodCredits.length - 1]?.number || "",
          totnum: allPeriodCredits.length,
          canc: 0,
          net_issue: validCredits.length,
        },
      ],
    });
  }

  // --- Official GST JSON Format ---
  const b2bList = Array.from(b2bMap.values()).map(({ cnm, ...entry }) => entry);
  const b2clList = Array.from(b2clMap.values()).map((entry) => ({
    pos: entry.pos,
    inv: entry.inv.map(({ customerName, ...inv }) => inv),
  }));
  const b2csList = Array.from(b2csMap.values()).map((entry) => ({
    sply_ty: entry.sply_ty,
    pos: entry.pos,
    typ: entry.typ,
    rt: entry.rt,
    txval: toRs(entry.txval),
    camt: toRs(entry.camt),
    samt: toRs(entry.samt),
    iamt: toRs(entry.iamt),
    csamt: 0,
  }));
  const cdnrList = Array.from(cdnrMap.values()).map(({ cnm, ...entry }) => entry);

  const gstJson = {
    gstin: sellerGstin,
    fp: period.fp,
    gt: 0,
    cur_gt: 0,
    ...(b2bList.length ? { b2b: b2bList } : {}),
    ...(b2clList.length ? { b2cl: b2clList } : {}),
    ...(b2csList.length ? { b2cs: b2csList } : {}),
    ...(cdnrList.length ? { cdnr: cdnrList } : {}),
    ...(cdnurList.length ? { cdnur: cdnurList.map(({ customerName, ...c }) => c) } : {}),
    ...(hsnData.length ? { hsn: { data: hsnData } } : {}),
    ...(docSections.length ? { doc_issue: { doc_det: docSections } } : {}),
  };

  // Preview Data for UI matching Swipe Screenshots 3 & 4
  const preview = {
    period,
    gstin: sellerGstin,
    b2b: Array.from(b2bMap.values()).flatMap((c) =>
      c.inv.map((i) => ({
        gstin: c.ctin,
        customerName: c.cnm,
        invoiceNumber: i.inum,
        date: i.idt,
        value: i.val,
        placeOfSupply: `${i.pos}-${stateName(i.pos)}`,
        itemsCount: i.itms.length,
      }))
    ),
    b2cl: Array.from(b2clMap.values()).flatMap((p) =>
      p.inv.map((i) => ({
        customerName: i.customerName,
        invoiceNumber: i.inum,
        date: i.idt,
        value: i.val,
        placeOfSupply: `${p.pos}-${stateName(p.pos)}`,
      }))
    ),
    b2cs: b2csList.map((b) => ({
      supplyType: b.sply_ty,
      placeOfSupply: `${b.pos}-${stateName(b.pos)}`,
      rate: b.rt,
      taxable: b.txval,
      cgst: b.camt,
      sgst: b.samt,
      igst: b.iamt,
      totalTax: Number((b.camt + b.samt + b.iamt).toFixed(2)),
    })),
    cdnr: Array.from(cdnrMap.values()).flatMap((c) =>
      c.nt.map((n) => ({
        gstin: c.ctin,
        customerName: c.cnm,
        noteNumber: n.nt_num,
        date: n.nt_dt,
        originalInvoice: n.inum,
        value: n.val,
      }))
    ),
    cdnur: cdnurList,
    hsn: hsnData,
    docIssue: docSections,
    summary: {
      b2bCount: validInvoices.filter((i) => isValidGstin(i.customer?.gstin)).length,
      b2bValue: toRs(validInvoices.filter((i) => isValidGstin(i.customer?.gstin)).reduce((n, i) => n + i.totals.total, 0)),
      b2csValue: b2csList.reduce((n, b) => n + b.txval + b.camt + b.samt + b.iamt, 0),
      creditNotesCount: validCredits.length,
      creditNotesValue: toRs(validCredits.reduce((n, c) => n + c.totals.total, 0)),
      totalTaxable: toRs(validInvoices.reduce((n, i) => n + i.totals.taxable, 0) - validCredits.reduce((n, c) => n + c.totals.taxable, 0)),
      totalTax: toRs(validInvoices.reduce((n, i) => n + i.totals.tax, 0) - validCredits.reduce((n, c) => n + c.totals.tax, 0)),
    },
  };

  return { gstJson, preview };
}

