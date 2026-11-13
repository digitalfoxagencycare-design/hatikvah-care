import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader, useLoad } from "./hooks.jsx";
import { Bars, rs, today } from "./ui.jsx";

const fyStart = () => {
  const t = today(), y = Number(t.slice(0, 4));
  return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};

const FY_OPTIONS = ["FY 23-24", "FY 24-25", "FY 25-26", "FY 26-27"];

export default function Reports() {
  const [activeTab, setActiveTab] = useState("gstr1"); // "overview" | "gstr1"
  const [rg, setRg] = useState({ from: fyStart(), to: today() });
  const [selectedFy, setSelectedFy] = useState("FY 26-27");
  const [gstrTab, setGstrTab] = useState("B2B"); // "B2B" | "B2CL" | "B2CS" | "CDNR" | "CDNUR" | "HSN" | "DOC"

  const q = `from=${rg.from}&to=${rg.to}`;
  const s = useLoad(`/api/admin/reports?${q}`);
  const gstr = useLoad(`/api/admin/reports/gstr-1/preview?fy=${encodeURIComponent(selectedFy)}`);

  const d = s.data;
  const gd = gstr.data;
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

  return (
    <>
      <div className="row-between" style={{ alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tax & Financial Reports</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Real-time sales register, GST filings, and GSTR-1 government JSON exports.
          </p>
        </div>
        <div className="status-chips" style={{ margin: 0 }}>
          <button
            type="button"
            aria-pressed={activeTab === "gstr1"}
            onClick={() => setActiveTab("gstr1")}
            style={{ fontWeight: 600 }}
          >
            🏛️ GSTR-1 Tax Hub
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            style={{ fontWeight: 600 }}
          >
            📊 Analytics & Sales Overview
          </button>
        </div>
      </div>

      {activeTab === "gstr1" ? (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Top Info Banner matching Swipe */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong style={{ fontSize: "1.05rem", color: "#1e3a8a" }}>
                File your GSTR-1 Directly or Download Official JSON for your CA
              </strong>
              <div style={{ fontSize: "0.85rem", color: "#3b82f6", marginTop: 2 }}>
                Upload the JSON file directly to the GST Portal (gst.gov.in) offline utility. No manual entry needed.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <a
                className="btn ghost"
                href={`/api/admin/reports/gstr-1/b2b.csv?fy=${encodeURIComponent(selectedFy)}`}
                style={{ background: "#fff", display: "flex", alignItems: "center", gap: 6 }}
              >
                📄 Download CSV
              </a>
              <a
                className="btn"
                href={`/api/admin/reports/gstr-1.json?fy=${encodeURIComponent(selectedFy)}`}
                download
                style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}
              >
                ⬇️ Download Official JSON
              </a>
            </div>
          </div>

          {/* GSTR-1 Header & Controls */}
          <div className="panel" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1.3rem" }}>GSTR - 1</h2>
                <div style={{ display: "flex", gap: 6 }}>
                  {FY_OPTIONS.map((fy) => (
                    <button
                      key={fy}
                      type="button"
                      className={`btn small ${selectedFy === fy ? "" : "ghost"}`}
                      onClick={() => setSelectedFy(fy)}
                      style={{ padding: "4px 10px", fontSize: "0.82rem" }}
                    >
                      {fy}
                    </button>
                  ))}
                </div>
              </div>

              {gd?.summary && (
                <div style={{ display: "flex", gap: 20, fontSize: "0.88rem" }}>
                  <div>
                    <span className="muted">B2B Total: </span>
                    <strong>₹{gd.summary.b2bValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>
                  </div>
                  <div>
                    <span className="muted">Total Tax: </span>
                    <strong style={{ color: "#047857" }}>
                      ₹{gd.summary.totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* Sub-Tabs matching Swipe Screenshot 3 */}
            <div className="status-chips" style={{ marginTop: 16, marginBottom: 12 }}>
              {[
                ["B2B", `B2B (${gd?.b2b?.length || 0})`],
                ["B2CL", `B2CL (${gd?.b2cl?.length || 0})`],
                ["B2CS", `B2CS (${gd?.b2cs?.length || 0})`],
                ["CDNR", `CDNR (${gd?.cdnr?.length || 0})`],
                ["CDNUR", `CDNUR (${gd?.cdnur?.length || 0})`],
                ["HSN", `HSN B2B (${gd?.hsn?.length || 0})`],
                ["DOC", "DOC ISSUE"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={gstrTab === key}
                  onClick={() => setGstrTab(key)}
                  style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tables based on selected sub-tab */}
            <Loader s={gstr}>
              {gd && (
                <div className="tbl-wrap" style={{ borderRadius: 6, border: "1px solid #e2e8f0", marginTop: 8 }}>
                  {gstrTab === "B2B" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>GSTIN/UIN of Recipient</th>
                          <th>Receiver Name</th>
                          <th>Invoice Number</th>
                          <th>Invoice Date</th>
                          <th className="num">Invoice Value (₹)</th>
                          <th>Place Of Supply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.b2b.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No B2B invoices in this financial period.
                            </td>
                          </tr>
                        ) : (
                          gd.b2b.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <code>{row.gstin}</code>
                              </td>
                              <td>{row.customerName}</td>
                              <td>
                                <strong>{row.invoiceNumber}</strong>
                              </td>
                              <td>{row.date}</td>
                              <td className="num font-bold">
                                {Number(row.value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td>{row.placeOfSupply}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "B2CL" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Receiver Name</th>
                          <th>Invoice Number</th>
                          <th>Invoice Date</th>
                          <th className="num">Invoice Value (₹)</th>
                          <th>Place Of Supply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.b2cl.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No B2C Large invoices (&gt; ₹2.5L inter-state) in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.b2cl.map((row, idx) => (
                            <tr key={idx}>
                              <td>{row.customerName}</td>
                              <td>
                                <strong>{row.invoiceNumber}</strong>
                              </td>
                              <td>{row.date}</td>
                              <td className="num">{Number(row.value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td>{row.placeOfSupply}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "B2CS" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Supply Type</th>
                          <th>Place Of Supply</th>
                          <th className="num">GST Rate</th>
                          <th className="num">Taxable Value (₹)</th>
                          <th className="num">CGST (₹)</th>
                          <th className="num">SGST (₹)</th>
                          <th className="num">IGST (₹)</th>
                          <th className="num">Total Tax (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.b2cs.length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No B2C Small transactions in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.b2cs.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <span className="pill">{row.supplyType}</span>
                              </td>
                              <td>{row.placeOfSupply}</td>
                              <td className="num">{row.rate}%</td>
                              <td className="num font-bold">
                                {Number(row.taxable).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="num">{Number(row.cgst).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num">{Number(row.sgst).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num">{Number(row.igst).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num font-bold" style={{ color: "#047857" }}>
                                {Number(row.totalTax).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "CDNR" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Recipient GSTIN</th>
                          <th>Receiver Name</th>
                          <th>Credit Note #</th>
                          <th>Note Date</th>
                          <th>Original Invoice #</th>
                          <th className="num">Note Value (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.cdnr.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No registered credit notes in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.cdnr.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <code>{row.gstin}</code>
                              </td>
                              <td>{row.customerName}</td>
                              <td>
                                <strong>{row.noteNumber}</strong>
                              </td>
                              <td>{row.date}</td>
                              <td>{row.originalInvoice}</td>
                              <td className="num font-bold">
                                {Number(row.value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "CDNUR" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Credit Note #</th>
                          <th>Date</th>
                          <th>Original Invoice</th>
                          <th className="num">Value (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.cdnur.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No unregistered credit notes in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.cdnur.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <strong>{row.nt_num}</strong>
                              </td>
                              <td>{row.nt_dt}</td>
                              <td>{row.inum}</td>
                              <td className="num font-bold">
                                {Number(row.val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "HSN" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>HSN/SAC</th>
                          <th>Description</th>
                          <th>UQC</th>
                          <th className="num">Total Qty</th>
                          <th className="num">Total Value (₹)</th>
                          <th className="num">Taxable Value (₹)</th>
                          <th className="num">CGST (₹)</th>
                          <th className="num">SGST (₹)</th>
                          <th className="num">IGST (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.hsn.length === 0 ? (
                          <tr>
                            <td colSpan={9} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No HSN items recorded in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.hsn.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <code>{row.hsn_sc}</code>
                              </td>
                              <td>{row.desc}</td>
                              <td>{row.uqc}</td>
                              <td className="num font-bold">{row.qty.toLocaleString("en-IN")}</td>
                              <td className="num">{Number(row.val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num font-bold">
                                {Number(row.txval).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="num">{Number(row.camt).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num">{Number(row.samt).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                              <td className="num">{Number(row.iamt).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  )}

                  {gstrTab === "DOC" && (
                    <table className="tbl" style={{ width: "100%", fontSize: "0.88rem" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Nature of Document</th>
                          <th>From</th>
                          <th>To</th>
                          <th className="num">Total Number</th>
                          <th className="num">Cancelled</th>
                          <th className="num">Net Issued</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gd.docIssue.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", padding: 24 }} className="muted">
                              No documents issued in this period.
                            </td>
                          </tr>
                        ) : (
                          gd.docIssue.flatMap((sec) =>
                            sec.docs.map((doc, idx) => (
                              <tr key={`${sec.doc_num}-${idx}`}>
                                <td>
                                  <strong>{sec.doc_typ}</strong>
                                </td>
                                <td>{doc.from}</td>
                                <td>{doc.to}</td>
                                <td className="num">{doc.totnum}</td>
                                <td className="num" style={{ color: doc.canc > 0 ? "#b91c1c" : "inherit" }}>
                                  {doc.canc}
                                </td>
                                <td className="num font-bold" style={{ color: "#047857" }}>
                                  {doc.net_issue}
                                </td>
                              </tr>
                            ))
                          )
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Loader>
          </div>
        </div>
      ) : (
        /* Analytics & Sales Overview Tab */
        <>
          <div className="toolbar">
            <label className="check-inline">
              From <input type="date" value={rg.from} onChange={(e) => setRg({ ...rg, from: e.target.value })} />
            </label>
            <label className="check-inline">
              To <input type="date" value={rg.to} onChange={(e) => setRg({ ...rg, to: e.target.value })} />
            </label>
            <button className="btn ghost small" onClick={() => setRg({ from: today().slice(0, 8) + "01", to: today() })}>
              This month
            </button>
            <button className="btn ghost small" onClick={() => setRg({ from: fyStart(), to: today() })}>
              This financial year
            </button>
          </div>

          <Loader s={s}>
            {d && (
              <>
                <div className="tiles">
                  <div className="tile">
                    <strong>{rs(d.totals.invoiced)}</strong>
                    <span>Invoiced (incl. GST)</span>
                    <small>
                      {d.totals.invoices} invoices · avg {rs(d.totals.avgInvoice)}
                    </small>
                  </div>
                  <div className="tile">
                    <strong>{rs(d.totals.taxable)}</strong>
                    <span>Sales before tax</span>
                    <small>GST {rs(d.totals.tax)}</small>
                  </div>
                  <div className="tile">
                    <strong>{rs(d.totals.received)}</strong>
                    <span>Received</span>
                  </div>
                  <div className="tile warn">
                    <strong>{rs(d.totals.outstanding)}</strong>
                    <span>Outstanding today</span>
                    <small>
                      <Link to="/admin/invoices?status=overdue">overdue invoices →</Link>
                    </small>
                  </div>
                </div>

                <div className="grid2 top">
                  <div className="panel">
                    <h2>Sales by month</h2>
                    {d.months.length ? (
                      <Bars rows={d.months} value={(m) => m.invoiced} label={(m) => m.month} />
                    ) : (
                      <p className="muted">No invoices in this period.</p>
                    )}
                    {d.months.length > 0 && (
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th className="num">Invoiced</th>
                            <th className="num">Received</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.months.map((m) => (
                            <tr key={m.month}>
                              <td>{m.month}</td>
                              <td className="num">{rs(m.invoiced)}</td>
                              <td className="num">{rs(m.received)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="panel">
                    <h2>Sales funnel</h2>
                    <table className="tbl">
                      <tbody>
                        <tr>
                          <td>Enquiries</td>
                          <td className="num">{d.funnel.enquiries}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>Quotations made</td>
                          <td className="num">{d.funnel.quotes}</td>
                          <td className="muted">{pct(d.funnel.quotes, d.funnel.enquiries)} of enquiries</td>
                        </tr>
                        <tr>
                          <td>Quotations accepted</td>
                          <td className="num">{d.funnel.accepted}</td>
                          <td className="muted">{pct(d.funnel.accepted, d.funnel.quotesSent)} of sent</td>
                        </tr>
                        <tr>
                          <td>Orders</td>
                          <td className="num">{d.funnel.orders}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>Invoices</td>
                          <td className="num">{d.funnel.invoices}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                    <h3>Where enquiries come from</h3>
                    {d.sources.length ? (
                      <Bars rows={d.sources} value={(x) => x.count} label={(x) => x.source} fmt={(n) => n} />
                    ) : (
                      <p className="muted">No enquiries in this period.</p>
                    )}
                  </div>

                  <div className="panel">
                    <h2>Top customers</h2>
                    {d.topCustomers.length ? (
                      <Bars
                        rows={d.topCustomers}
                        value={(c) => c.total}
                        label={(c) => <Link to={`/admin/customers/${c.customerId}`}>{c.name}</Link>}
                      />
                    ) : (
                      <p className="muted">—</p>
                    )}
                  </div>

                  <div className="panel">
                    <h2>Sales by category</h2>
                    {d.categories.length ? (
                      <Bars rows={d.categories} value={(c) => c.taxable} label={(c) => c.name} />
                    ) : (
                      <p className="muted">—</p>
                    )}
                  </div>

                  <div className="panel">
                    <h2>Top products</h2>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th className="num">Qty</th>
                          <th className="num">Sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.topProducts.map((p) => (
                          <tr key={p.sku + p.name}>
                            <td>
                              {p.name}
                              <small>{p.sku}</small>
                            </td>
                            <td className="num">{p.qty.toLocaleString("en-IN")}</td>
                            <td className="num">{rs(p.taxable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="panel">
                    <h2>Money owed by age</h2>
                    <table className="tbl">
                      <tbody>
                        {[
                          ["Not yet due", "current"],
                          ["1–30 days late", "d30"],
                          ["31–60 days late", "d60"],
                          ["61–90 days late", "d90"],
                          ["Over 90 days", "d90plus"],
                        ].map(([l, k]) => (
                          <tr key={k}>
                            <td>{l}</td>
                            <td className={"num" + (k !== "current" && d.aging[k] ? " due" : "")}>{rs(d.aging[k])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <h3>Team Performance</h3>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Person</th>
                          <th>Leads</th>
                          <th>Won</th>
                          <th>Quotes</th>
                          <th className="num">Converted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.staff.map((x) => (
                          <tr key={x.name}>
                            <td>{x.name}</td>
                            <td>{x.enquiries}</td>
                            <td>{x.won}</td>
                            <td>{x.quotes}</td>
                            <td className="num">{rs(x.converted)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel">
                  <h2>Downloads for your accountant</h2>
                  <p className="muted">
                    CSV files open in Excel and can be imported into Tally / Zoho Books (via their import templates) or used for GSTR-1.
                  </p>
                  <div className="btn-row">
                    <a className="btn ghost" href={`/api/admin/reports/sales-register.csv?${q}`}>
                      GST sales register
                    </a>
                    <a className="btn ghost" href={`/api/admin/reports/hsn-summary.csv?${q}`}>
                      HSN summary
                    </a>
                    <a className="btn ghost" href={`/api/admin/reports/payments.csv?${q}`}>
                      Payments received
                    </a>
                    <a className="btn ghost" href="/api/admin/reports/receivables.csv">
                      Receivables (today)
                    </a>
                    <a className="btn ghost" href="/api/admin/reports/stock.csv">
                      Stock & value
                    </a>
                  </div>
                </div>
              </>
            )}
          </Loader>
        </>
      )}
    </>
  );
}
