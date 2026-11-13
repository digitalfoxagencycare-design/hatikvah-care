import { useEffect, useMemo, useRef, useState } from "react";
import { rs } from "./ui.jsx";

const STORAGE_KEY = "hc_recent_product_ids";

function getRecentIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordRecentId(id) {
  if (!id) return;
  try {
    const existing = getRecentIds().filter((x) => x !== id);
    const updated = [id, ...existing].slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function InvoiceLinePicker({ rates = [], onAddLine, buttonLabel = "+ Add to Bill", placeholder = "🔍 Search by product name, SKU, or HSN code..." }) {
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [recentIds, setRecentIds] = useState(getRecentIds);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const cleanQ = query.trim().toLowerCase();

  // Search vs. Focused Recent/Frequent list
  const { displayedItems, hasSections } = useMemo(() => {
    if (cleanQ) {
      // User is searching
      const filtered = rates.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        const hsn = (p.hsn || "").toLowerCase();
        const cat = (p.category || "").toLowerCase();
        const pack = (p.pack || "").toLowerCase();
        return name.includes(cleanQ) || sku.includes(cleanQ) || hsn.includes(cleanQ) || cat.includes(cleanQ) || pack.includes(cleanQ);
      });

      // Sort: exact SKU first, then name startsWith, then others
      filtered.sort((a, b) => {
        const aSkuExact = a.sku?.toLowerCase() === cleanQ;
        const bSkuExact = b.sku?.toLowerCase() === cleanQ;
        if (aSkuExact && !bSkuExact) return -1;
        if (!aSkuExact && bSkuExact) return 1;

        const aNameStarts = a.name?.toLowerCase().startsWith(cleanQ);
        const bNameStarts = b.name?.toLowerCase().startsWith(cleanQ);
        if (aNameStarts && !bNameStarts) return -1;
        if (!aNameStarts && bNameStarts) return 1;

        return 0;
      });

      return { displayedItems: filtered.slice(0, 15), hasSections: false };
    }

    // Input is focused with NO text: show Recent and Frequently Used / Popular
    const recent = [];
    const recentSet = new Set();
    for (const id of recentIds) {
      const found = rates.find((p) => p.productId === id || p.id === id);
      if (found && !recentSet.has(found.productId)) {
        recent.push({ ...found, _section: "Recent" });
        recentSet.add(found.productId);
      }
    }

    const frequent = [];
    for (const p of rates) {
      if (!recentSet.has(p.productId) && p.active !== false) {
        frequent.push({ ...p, _section: recent.length > 0 ? "Frequently Used / Catalog" : "Catalog Products" });
      }
      if (frequent.length >= 10) break;
    }

    return { displayedItems: [...recent, ...frequent], hasSections: true };
  }, [rates, cleanQ, recentIds]);

  const addProduct = (product, selectedQty) => {
    if (!product) return;
    const q = Math.max(1, Number(selectedQty) || 1);
    recordRecentId(product.productId || product.id);
    setRecentIds(getRecentIds());

    onAddLine({
      productId: product.productId || product.id,
      sku: product.sku || "",
      name: product.name,
      image: product.image || (product.images?.[0] || ""),
      hsn: product.hsn || "",
      unit: product.unit || "pcs",
      qty: q,
      rate: product.rate || product.price || 0,
      discountPct: 0,
      gstRate: product.gstRate ?? 18,
      uom: "piece",
      perUnit: 1,
    });

    setQuery("");
    setQty(1);
    setOpen(false);
    setHighlightIdx(0);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1 < displayedItems.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev - 1 >= 0 ? prev - 1 : displayedItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If exact SKU barcode scan match
      const exactSku = rates.find((p) => p.sku && p.sku.toLowerCase() === cleanQ);
      if (exactSku) {
        addProduct(exactSku, qty);
      } else if (displayedItems.length > 0) {
        addProduct(displayedItems[highlightIdx] || displayedItems[0], qty);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="line-picker-container" ref={wrapRef} style={{ position: "relative", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-label="Search products"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlightIdx(0);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            style={{
              width: "100%",
              height: 42,
              padding: "8px 12px",
              border: "1px solid var(--border-subtle, #cbd5e1)",
              borderRadius: 6,
              fontSize: "0.95rem",
              background: "#fff",
            }}
          />
          {open && displayedItems.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 100,
                background: "#fff",
                border: "1px solid var(--border-strong, #cbd5e1)",
                borderRadius: 6,
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                maxHeight: 340,
                overflowY: "auto",
                marginTop: 4,
              }}
            >
              {displayedItems.map((item, idx) => {
                const isSelected = idx === highlightIdx;
                const avl = item.available ?? item.physical ?? 0;
                const showSectionHeader =
                  hasSections &&
                  (idx === 0 || displayedItems[idx - 1]?._section !== item._section);

                return (
                  <div key={item.productId || item.id || idx}>
                    {showSectionHeader && (
                      <div
                        style={{
                          padding: "6px 14px",
                          background: "#f8fafc",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          color: "#64748b",
                          letterSpacing: "0.05em",
                          borderBottom: "1px solid #f1f5f9",
                        }}
                      >
                        {item._section === "Recent" ? "🕒 Recently Selected" : "⭐ Frequently Used / Catalog"}
                      </div>
                    )}
                    <div
                      onClick={() => addProduct(item, qty)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      style={{
                        padding: "8px 14px",
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        background: isSelected ? "#f1f5f9" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        {item.image && item.image.startsWith("/catalog/") ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            style={{
                              width: 36,
                              height: 36,
                              objectFit: "contain",
                              borderRadius: 6,
                              border: "1px solid #e2e8f0",
                              background: "#ffffff",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 6,
                              background: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "13px",
                              color: "#94a3b8",
                              flexShrink: 0,
                            }}
                          >
                            📦
                          </div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.93rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.name}
                            {item.pack && <small style={{ marginLeft: 6, color: "#64748b", fontWeight: 400 }}>({item.pack})</small>}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)", display: "flex", gap: 12, marginTop: 2 }}>
                            <span style={{ color: avl > 0 ? "#047857" : "#b91c1c", fontWeight: 500 }}>
                              Avl: {avl.toLocaleString("en-IN")} {item.unit || "NOS"}
                            </span>
                            {item.hsn && <span>HSN: <strong>{item.hsn}</strong></span>}
                            {item.sku && <span>SKU: {item.sku}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <strong style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>{rs(item.rate || item.price || 0)}</strong>
                        <div style={{ fontSize: "0.75rem", color: "#b45309", fontWeight: 600 }}>
                          +{item.gstRate ?? 18}% GST
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ width: 90 }}>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (displayedItems.length > 0) addProduct(displayedItems[highlightIdx] || displayedItems[0], qty);
              }
            }}
            style={{
              width: "100%",
              height: 42,
              padding: "8px 10px",
              textAlign: "center",
              border: "1px solid var(--border-subtle, #cbd5e1)",
              borderRadius: 6,
              fontSize: "0.95rem",
              fontWeight: 600,
            }}
            title="Quantity to add"
          />
        </div>

        <button
          type="button"
          className="btn"
          onClick={() => {
            if (displayedItems.length > 0) addProduct(displayedItems[highlightIdx] || displayedItems[0], qty);
          }}
          disabled={displayedItems.length === 0}
          style={{ height: 42, display: "flex", alignItems: "center", gap: 6, padding: "0 18px", whiteSpace: "nowrap" }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

export default InvoiceLinePicker;
