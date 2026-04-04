/* FlowExerciser — per-flow form to manually exercise the active endpoint.
   Renders inputs based on activeFlow id. */

import React, { useState, useEffect } from "react";
import { PlayGlyph } from "./Primitives";

const SKUS_LIST = ["sku-1", "sku-2", "sku-3", "sku-4", "sku-5", "sku-6", "sku-7"];

function defaults(id) {
  switch (id) {
    case "checkout":        return { sku: "sku-1", qty: 1, zip: "94110" };
    case "refund":          return { order_id: "", charge_id: "", amount_cents: 1999 };
    case "cart_merge":      return { guest_cart_id: "g_2941", skus: ["sku-1", "sku-2"] };
    case "restock":         return { sku: "sku-1", qty: 50 };
    case "fraud_review":    return { order_id: "" };
    case "recommendations": return { user: "demo", limit: 5 };
    default: return {};
  }
}

function renderInputs(id, form, set, useLastOrder) {
  const row = { display: "grid", gridTemplateColumns: "100px 1fr", gap: "var(--s-3)", alignItems: "center", padding: "4px 0" };
  switch (id) {
    case "checkout":
      return (
        <div className="field">
          <div style={row}><span className="label">SKU</span><select value={form.sku} onChange={e => set("sku", e.target.value)}>{SKUS_LIST.map(s => <option key={s}>{s}</option>)}</select></div>
          <div style={row}><span className="label">Quantity</span><input type="number" min={1} max={20} value={form.qty || 1} onChange={e => set("qty", parseInt(e.target.value, 10))} /></div>
          <div style={row}><span className="label">Zip</span><input type="text" value={form.zip || ""} onChange={e => set("zip", e.target.value)} /></div>
        </div>
      );
    case "refund":
      return (
        <div className="field">
          <div style={row}>
            <span className="label">Order ID</span>
            <div className="row" style={{ gap: "var(--s-2)" }}>
              <input type="text" value={form.order_id || ""} onChange={e => set("order_id", e.target.value)} />
              <button className="btn sm" onClick={useLastOrder}>use last</button>
            </div>
          </div>
          <div style={row}><span className="label">Charge ID</span><input type="text" value={form.charge_id || ""} onChange={e => set("charge_id", e.target.value)} placeholder="optional" /></div>
          <div style={row}><span className="label">Amount (¢)</span><input type="number" value={form.amount_cents || 0} onChange={e => set("amount_cents", parseInt(e.target.value, 10))} /></div>
        </div>
      );
    case "cart_merge":
      return (
        <div className="field">
          <div style={row}><span className="label">Guest cart</span><input type="text" value={form.guest_cart_id || ""} onChange={e => set("guest_cart_id", e.target.value)} /></div>
          <div style={row}>
            <span className="label">SKUs</span>
            <div className="chips">
              {SKUS_LIST.map(s => {
                const on = (form.skus || []).includes(s);
                return <button key={s} className={`chip ${on ? "on" : ""}`} onClick={() => set("skus", on ? form.skus.filter(x => x !== s) : [...(form.skus || []), s])}>{s}</button>;
              })}
            </div>
          </div>
        </div>
      );
    case "restock":
      return (
        <div className="field">
          <div style={row}><span className="label">SKU</span><select value={form.sku} onChange={e => set("sku", e.target.value)}>{SKUS_LIST.map(s => <option key={s}>{s}</option>)}</select></div>
          <div style={row}><span className="label">Quantity</span><input type="number" min={1} max={500} value={form.qty || 1} onChange={e => set("qty", parseInt(e.target.value, 10))} /></div>
        </div>
      );
    case "fraud_review":
      return (
        <div className="field">
          <div style={row}>
            <span className="label">Order ID</span>
            <div className="row" style={{ gap: "var(--s-2)" }}>
              <input type="text" value={form.order_id || ""} onChange={e => set("order_id", e.target.value)} />
              <button className="btn sm" onClick={useLastOrder}>use last</button>
            </div>
          </div>
        </div>
      );
    case "recommendations":
      return (
        <div className="field">
          <div style={row}><span className="label">User</span><input type="text" value={form.user || ""} onChange={e => set("user", e.target.value)} /></div>
          <div style={row}><span className="label">Limit</span><input type="number" min={1} max={20} value={form.limit || 5} onChange={e => set("limit", parseInt(e.target.value, 10))} /></div>
        </div>
      );
    default: return null;
  }
}

export function FlowExerciser({ activeFlow, flows, lastResponse, recentOrders, onSubmit }) {
  const flow = flows[activeFlow];
  const [form, setForm] = useState({});

  useEffect(() => { setForm(defaults(activeFlow)); }, [activeFlow]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const useLastOrder = () => {
    const ord = recentOrders?.[0];
    if (ord) set("order_id", ord.id);
  };

  if (!flow) return null;

  return (
    <div className="card">
      <div className="card-head">
        <div className="ttl"><span className="label">Exercise flow</span></div>
        <div className="meta"><span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>{flow.endpoint}</span></div>
      </div>
      <div className="card-body">
        {renderInputs(activeFlow, form, set, useLastOrder)}

        <div className="row" style={{ marginTop: "var(--s-3)", justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={() => onSubmit(activeFlow, form)}>
            <PlayGlyph size={9} color="currentColor" />
            Send {flow.title.toLowerCase()}
          </button>
        </div>

        {lastResponse && (
          <div className="resp">
            <div className="label">Last response</div>
            <div className={`resp-body ${lastResponse.ok ? "" : "fail"}`}>
              {Object.entries(lastResponse.body).map(([k, v]) => (
                <div key={k} className="resp-line">
                  <span className="k">{k}</span>
                  <span className="v">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
