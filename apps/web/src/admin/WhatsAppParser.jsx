import { useState, useMemo } from "react";

// Common samples for easy demonstration
const SAMPLES = [
  {
    title: "Clinic Diagnostics Order",
    text: `Hi HaTikvah Care, please send quotation for:
1. Digital Blood Pressure Monitor - 4 pcs
2. Pulse Oximeter Fingertip - 6 nos
3. Nebulizer Machine Compressor - 2 units
4. Infrared Forehead Thermometer - 3 pcs
Customer: Apollo Clinic, 9849012345
Please provide best clinic rates. Thanks!`
  },
  {
    title: "Senior Living Hygiene Order",
    text: `Urgent requirement for elder care:
- Adult Diapers Large - 15 pkts
- Bed Underpads 60x90 - 20 packs
- Commode Chair with Wheels - 2 pcs
- Patient Examination Gloves (M) - 5 boxes
Rainbow Children's Medicare, Phone: 9848022338`
  },
  {
    title: "Rehab & Mobility Supplies",
    text: `Requirement for patient:
Wheelchair Foldable Deluxe 2
Walking Stick Quadripod 4
Air Mattress Anti-Decubitus with Pump 2
Customer: Dr. Ramesh Kumar Senior Living Home, 9876543210`
  }
];

function cleanNumber(str) {
  return str ? str.replace(/\D/g, "") : "";
}

function parseWhatsAppText(rawText, catalog = [], customers = []) {
  if (!rawText || !rawText.trim()) {
    return { detectedCustomer: null, items: [] };
  }

  // 1. Detect Phone Number & Customer
  let detectedCustomer = null;
  const phoneMatch = rawText.match(/(?:\+?91[\-\s]?)?([6-9]\d{9})/);
  if (phoneMatch) {
    const matchedDigits = phoneMatch[1];
    detectedCustomer = customers.find((c) => {
      const p = cleanNumber(c.phone);
      return p.includes(matchedDigits) || matchedDigits.includes(p);
    }) || null;
  }

  // If phone didn't match directly, try matching customer names in text
  if (!detectedCustomer) {
    const lower = rawText.toLowerCase();
    detectedCustomer = customers.find((c) => c.name && lower.includes(c.name.toLowerCase())) || null;
  }

  // 2. Parse Lines for Products & Quantities
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsedItems = [];

  const ignoreRegex = /^(hi|hello|dear|please|kindly|thanks|thank you|regards|from|to|requirement|quote|quotation|urgently|urgent|need|best price|discount|customer:|phone:)/i;

  for (const rawLine of lines) {
    // Skip greeting/closing lines or standalone phone/customer lines
    if (rawLine.length < 3) continue;
    if (ignoreRegex.test(rawLine) && !/\d+/.test(rawLine)) continue;
    if (/^(customer|phone|mobile|contact|gstin)[\s:]+/i.test(rawLine)) continue;

    // Clean leading bullets, numbers (e.g., "1.", "1)", "-", "*")
    let line = rawLine.replace(/^[\d\.\)\-\*\•\>\:\s]+/, "").trim();
    if (!line) continue;

    // Extract quantity and unit
    let qty = 1;
    let unit = "pcs";
    let query = line;

    // Pattern A: "Product Name - 5 pkts" or "Product Name: 5 nos" or "Product Name x 5"
    const trailingQtyMatch = line.match(/(?:[-:x,]|\s+for|\s+qty:?)\s*(\d+(?:\.\d+)?)\s*(pcs|nos|pkts|pkt|packs|pack|boxes|box|rolls|roll|units|btl|bottles|pairs)?\b/i);
    // Pattern B: "5 boxes Product Name" or "10 pcs Product Name"
    const leadingQtyMatch = line.match(/^(\d+(?:\.\d+)?)\s*(pcs|nos|pkts|pkt|packs|pack|boxes|box|rolls|roll|units|btl|bottles|pairs)?\s+(.+)$/i);
    // Pattern C: "Product Name 5"
    const endNumberMatch = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);

    if (trailingQtyMatch) {
      qty = Number(trailingQtyMatch[1]);
      if (trailingQtyMatch[2]) unit = trailingQtyMatch[2].toLowerCase();
      query = line.replace(trailingQtyMatch[0], "").trim();
    } else if (leadingQtyMatch) {
      qty = Number(leadingQtyMatch[1]);
      if (leadingQtyMatch[2]) unit = leadingQtyMatch[2].toLowerCase();
      query = leadingQtyMatch[3].trim();
    } else if (endNumberMatch) {
      qty = Number(endNumberMatch[2]);
      query = endNumberMatch[1].trim();
    }

    if (!query) continue;

    // Clean query punctuation
    query = query.replace(/[,\-\:\(\)]+$/, "").trim();

    // 3. Match against Catalog
    let bestMatch = null;
    let bestScore = 0;
    const qLower = query.toLowerCase();
    const qTokens = qLower.split(/[\s\-_,\/]+/).filter((t) => t.length > 2);

    for (const prod of catalog) {
      const pName = (prod.name || "").toLowerCase();
      const pSku = (prod.sku || "").toLowerCase();
      const pPack = (prod.pack || "").toLowerCase();

      // Exact or direct substring match
      if (pName === qLower || pSku === qLower) {
        bestMatch = prod;
        bestScore = 100;
        break;
      }
      if (pName.includes(qLower) || qLower.includes(pName)) {
        const score = 80;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = prod;
        }
      }

      // Token overlap score
      if (qTokens.length > 0) {
        let matchCount = 0;
        for (const token of qTokens) {
          if (pName.includes(token) || pSku.includes(token) || pPack.includes(token)) {
            matchCount++;
          }
        }
        const tokenScore = (matchCount / qTokens.length) * 70;
        if (tokenScore > bestScore && matchCount >= 1) {
          bestScore = tokenScore;
          bestMatch = prod;
        }
      }
    }

    if (bestMatch && bestScore >= 30) {
      parsedItems.push({
        matched: true,
        productId: bestMatch.productId || bestMatch.id,
        sku: bestMatch.sku,
        name: bestMatch.name,
        hsn: bestMatch.hsn || "",
        unit: bestMatch.unit || unit || "pcs",
        qty: qty || 1,
        rate: bestMatch.rate || bestMatch.price || 0,
        discountPct: 0,
        gstRate: bestMatch.gstRate ?? 18,
        originalQuery: query,
      });
    } else {
      // Custom / unlisted item from client message
      parsedItems.push({
        matched: false,
        productId: "",
        sku: "",
        name: query,
        hsn: "",
        unit: unit || "pcs",
        qty: qty || 1,
        rate: 0,
        discountPct: 0,
        gstRate: 18,
        originalQuery: query,
      });
    }
  }

  return { detectedCustomer, items: parsedItems };
}

export function WhatsAppMessageParser({ catalog = [], customers = [], onApply, onClose }) {
  const [text, setText] = useState("");
  const [detectedCustId, setDetectedCustId] = useState("");

  const parsed = useMemo(() => parseWhatsAppText(text, catalog, customers), [text, catalog, customers]);

  // Keep detected customer synced when parser finds one
  useState(() => {
    if (parsed.detectedCustomer?.id && !detectedCustId) {
      setDetectedCustId(parsed.detectedCustomer.id);
    }
  });

  const [items, setItems] = useState([]);
  useMemo(() => {
    setItems(parsed.items);
    if (parsed.detectedCustomer?.id) {
      setDetectedCustId(parsed.detectedCustomer.id);
    }
  }, [parsed]);

  const updateItem = (index, field, val) => {
    setItems((curr) => curr.map((it, i) => (i === index ? { ...it, [field]: val } : it)));
  };

  const removeItem = (index) => {
    setItems((curr) => curr.filter((_, i) => i !== index));
  };

  const loadSample = (sampleText) => {
    setText(sampleText);
  };

  const handleApply = () => {
    onApply({
      customerId: detectedCustId || parsed.detectedCustomer?.id || "",
      items: items.map((it) => ({
        productId: it.productId || "",
        sku: it.sku || "",
        name: it.name,
        hsn: it.hsn || "",
        unit: it.unit || "pcs",
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        discountPct: Number(it.discountPct) || 0,
        gstRate: Number(it.gstRate) || 18,
      })),
    });
  };

  return (
    <div className="wa-parser-modal">
      <div className="wa-parser-card">
        <div className="row-between">
          <div className="wa-header-row">
            <span className="wa-icon-badge">📱</span>
            <div>
              <h3>Paste Customer WhatsApp Message</h3>
              <p className="muted small-print">
                Paste raw WhatsApp text below. Products, quantities, and customer details will be auto-extracted.
              </p>
            </div>
          </div>
          <button type="button" className="link" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="wa-samples-row">
          <span className="small-print muted">Quick Samples:</span>
          {SAMPLES.map((s, idx) => (
            <button
              key={idx}
              type="button"
              className="btn btn-xs ghost"
              onClick={() => loadSample(s.text)}
            >
              📋 {s.title}
            </button>
          ))}
        </div>

        <textarea
          className="wa-textarea"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste WhatsApp enquiry or order message here... (e.g. 5 boxes Adult Diapers, 2 Wheelchairs, Customer: Apollo Clinic 9849012345)"
        />

        {text.trim() && (
          <div className="wa-preview-area">
            {/* Customer Detection Alert */}
            <div className="wa-customer-box">
              <strong>Customer: </strong>
              <select
                value={detectedCustId || parsed.detectedCustomer?.id || ""}
                onChange={(e) => setDetectedCustId(e.target.value)}
                className="w-md"
              >
                <option value="">(Select or keep current quote customer)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
              {parsed.detectedCustomer ? (
                <span className="badge badge-success">✓ Matched from WhatsApp Phone/Name</span>
              ) : (
                <span className="muted small-print">No customer detected in text. Choose one above if needed.</span>
              )}
            </div>

            {/* Extracted Items Table */}
            <div className="tbl-wrap">
              <table className="tbl wa-items-tbl">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Product / Item Name</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Rate ₹</th>
                    <th>Tax %</th>
                    <th>Total ₹</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const rowAmt = (it.qty || 1) * ((it.rate || 0) / 100);
                    return (
                      <tr key={i} className={it.matched ? "matched-row" : "custom-row"}>
                        <td>
                          {it.matched ? (
                            <span className="badge badge-success">Catalog ✓</span>
                          ) : (
                            <span className="badge badge-warning">Custom Item</span>
                          )}
                        </td>
                        <td>
                          <input
                            className="wide"
                            value={it.name}
                            onChange={(e) => updateItem(i, "name", e.target.value)}
                          />
                          {it.originalQuery && it.originalQuery !== it.name && (
                            <small className="muted d-block">From: "{it.originalQuery}"</small>
                          )}
                        </td>
                        <td><small>{it.sku || "—"}</small></td>
                        <td>
                          <input
                            className="w-xs"
                            type="number"
                            min="1"
                            step="any"
                            value={it.qty}
                            onChange={(e) => updateItem(i, "qty", Number(e.target.value))}
                          />
                        </td>
                        <td>
                          <input
                            className="w-xs"
                            value={it.unit}
                            onChange={(e) => updateItem(i, "unit", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="w-xs"
                            type="number"
                            step="any"
                            value={it.rate ? it.rate / 100 : ""}
                            placeholder="0"
                            onChange={(e) => updateItem(i, "rate", Math.round(Number(e.target.value) * 100))}
                          />
                        </td>
                        <td>{it.gstRate}%</td>
                        <td className="num">₹{rowAmt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>
                          <button
                            type="button"
                            className="link danger"
                            onClick={() => removeItem(i)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted text-center py-4">
                        Could not detect any product lines. Please paste the items or click one of the quick samples above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="btn-row justify-end mt-4">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={items.length === 0}
            onClick={handleApply}
          >
            ✓ Apply {items.length} {items.length === 1 ? "Item" : "Items"} to Quotation
          </button>
        </div>
      </div>
    </div>
  );
}
