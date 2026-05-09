/* ChaosPanel — service / mode / magnitude / duration + active chaos list. */

import React, { useState } from "react";
import { Tooltip } from "./Primitives";

const MODE_DEFS = [
  { id: "latency", label: "latency" },
  { id: "errors",  label: "errors" },
  { id: "grey",    label: "grey" },
  { id: "none",    label: "none" },
];

const DURATIONS = [15, 30, 60, 120];

export function ChaosPanel({
  services, flowServices, chaos, activeChaos,
  onMode, onService, onErrorRate, onLatency, onDuration,
  onInject, onClear, onClearAll,
}) {
  const [scope, setScope] = useState("flow");
  const list = services.filter(s => scope === "all" || !flowServices || flowServices.includes(s.id));
  const activeList = Object.entries(activeChaos || {});

  return (
    <div className="card" id="chaos-panel">
      <div className="card-head">
        <div className="ttl"><span className="label">Chaos injector</span></div>
        <div className="meta chips">
          <button className={`chip ${scope === "flow" ? "on" : ""}`} onClick={() => setScope("flow")}>active flow</button>
          <button className={`chip ${scope === "all" ? "on" : ""}`} onClick={() => setScope("all")}>all services</button>
        </div>
      </div>
      <div className="card-body">
        <div className="field">
          <span className="label">Service</span>
          <div className="chips">
            {list.filter(s => s.id !== "gateway").map(s => (
              <button key={s.id} className={`chip ${chaos.service === s.id ? "on" : ""}`} onClick={() => onService(s.id)}>
                <span className="marker"></span>{s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <span className="label">Mode</span>
          <div className="chips">
            {MODE_DEFS.map(m => (
              <button key={m.id} className={`chip ${chaos.mode === m.id ? "on" : ""}`} onClick={() => onMode(m.id)}>
                <span className="marker"></span>{m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row" style={{ marginTop: "var(--s-3)" }}>
          <div className="field">
            <span className={`label ${chaos.mode === "latency" ? "" : "dim"}`}>Latency (ms)</span>
            <input
              type="number" min={0} max={5000} step={50}
              value={chaos.latency_ms || 0}
              onChange={(e) => onLatency(parseInt(e.target.value, 10))}
              style={{ opacity: chaos.mode === "errors" ? 0.45 : 1 }}
            />
          </div>
          <div className="field">
            <span className={`label ${chaos.mode === "errors" || chaos.mode === "grey" ? "" : "dim"}`}>Error rate (0–1)</span>
            <input
              type="number" min={0} max={1} step={0.05}
              value={chaos.error_rate || 0}
              onChange={(e) => onErrorRate(parseFloat(e.target.value))}
              style={{ opacity: chaos.mode === "latency" ? 0.45 : 1 }}
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: "var(--s-3)" }}>
          <span className="label">Duration</span>
          <div className="chips">
            {DURATIONS.map(d => (
              <button key={d} className={`chip ${chaos.duration_s === d ? "on" : ""}`} onClick={() => onDuration(d)}>
                <span className="marker"></span>{d}s
              </button>
            ))}
            <input
              type="number" min={1} max={600}
              value={chaos.duration_s || 30}
              onChange={(e) => onDuration(parseInt(e.target.value, 10))}
              style={{ width: 64 }}
            />
          </div>
        </div>

        <div className="row" style={{ gap: "var(--s-3)", marginTop: "var(--s-4)" }}>
          <Tooltip label="Inject failure" hint={`Apply ${chaos.mode} on ${chaos.service} for ${chaos.duration_s}s. The agent will detect and respond.`}>
            <button className="btn warn" onClick={() => onInject(chaos)}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 1 L9 9 L1 9 Z" stroke="currentColor" fill="none" strokeWidth="1" /></svg>
              Inject failure
            </button>
          </Tooltip>
          <Tooltip label="Clear chaos" hint={`Removes any active failure on ${chaos.service}.`}>
            <button className="btn" onClick={() => onClear(chaos.service)}>Clear on this service</button>
          </Tooltip>
          <Tooltip label="Clear all chaos" hint="Sweeps every active failure across all 8 services." side="bottom">
            <button className="btn ghost" onClick={onClearAll}>↻ Clear all chaos</button>
          </Tooltip>
        </div>

        <div className="active-chaos">
          <div className="label">Active chaos</div>
          {activeList.length === 0 ? (
            <span style={{ color: "var(--fg-3)", fontSize: 12 }}>No active failures.</span>
          ) : activeList.map(([svc, c]) => (
            <div key={svc} className="active-chaos-row">
              <span><code style={{ background: "var(--bg-2)", padding: "1px 6px", border: "1px solid var(--hairline)", borderRadius: 4 }}>{svc}</code> · <span style={{ color: "var(--fg-3)" }}>{c.mode}</span> · {c.mode === "latency" ? `${c.magnitude}ms` : `${Math.round(c.magnitude * 100)}%`}</span>
              <button className="btn sm" onClick={() => onClear(svc)}>clear</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
