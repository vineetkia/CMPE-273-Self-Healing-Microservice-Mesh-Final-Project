/* TrafficGenerator — start/stop, RPS slider, burst, recent orders log. */

import React from "react";
import { StatusPill, CheckGlyph, XGlyph, PlayGlyph, Tooltip, relTime } from "./Primitives";

export function TrafficGenerator({ traffic, orders, onToggle, onRps, onBurst }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="ttl"><span className="label">Traffic generator</span></div>
        <div className="meta">
          <StatusPill status={traffic.running ? "healthy" : "degraded"} label={traffic.running ? "Running" : "Idle"} transmitting={traffic.running} />
        </div>
      </div>
      <div className="card-body">
        <div className="row" style={{ justifyContent: "space-between" }}>
          {traffic.running ? (
            <Tooltip label="Stop traffic" hint="Halts the synthetic load generator. Active flows continue draining.">
              <button className="btn stop" onClick={() => onToggle(false)}>
                <svg width="8" height="8" viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6" fill="currentColor" /></svg>
                Stop traffic
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="Start traffic" hint="Sends continuous requests against the active flow's endpoint.">
              <button className="btn primary" onClick={() => onToggle(true)}>
                <PlayGlyph size={9} color="currentColor" />
                Start traffic
              </button>
            </Tooltip>
          )}
          <Tooltip label="Burst 20 orders" hint="Fires 20 requests in 2 seconds without engaging the continuous loop.">
            <button className="btn" onClick={onBurst}>Burst 20</button>
          </Tooltip>
        </div>

        <div className="row" style={{ gap: "var(--s-3)", marginTop: "var(--s-3)" }}>
          <span className="label" style={{ minWidth: 24 }}>1</span>
          <input className="slider" type="range" min={1} max={48} step={1}
            value={traffic.rps} onChange={(e) => onRps(parseInt(e.target.value, 10))} />
          <span className="num" style={{ fontSize: 12, minWidth: 56, textAlign: "right" }}>{traffic.rps} rps</span>
        </div>

        <div className="log">
          <div className="label">Recent orders</div>
          {(orders || []).slice(0, 6).map((o, i) => {
            // Display short form; full canonical id is preserved in `o.id`
            // for downstream use (refund/fraud-review "use last").
            const shortId = o.id ? `#${o.id.replace(/^ord-/, "").toUpperCase().slice(0, 8)}` : "#---";
            return (
              <div className={`log-row ${o.status === "failed" ? "failed" : ""}`} key={`${o.id || "x"}-${i}`}>
                <span className="ts">{relTime(o.ts)}</span>
                <span className="body"><span className="order">{shortId}</span> · {o.sku} · {o.who}</span>
                <span className="lat">{o.latency_ms ?? 0}ms</span>
                <span className={`status ${o.status === "failed" ? "crit" : ""}`}>
                  {o.status === "failed" ? <XGlyph size={10} /> : <CheckGlyph size={10} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
