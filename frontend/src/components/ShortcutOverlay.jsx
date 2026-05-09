/* ShortcutOverlay — full-screen modal triggered by `?`. 12-row Kbd grid. */

import React from "react";
import { Kbd } from "./Primitives";

const SHORTCUTS = [
  { keys: [["1"], ["2"], ["3"], ["4"], ["5"], ["6"]], desc: "Select flow (Checkout / Refund / Cart merge / Restock / Fraud / Recs)" },
  { keys: [["g"], ["j"]], desc: "Open Jaeger" },
  { keys: [["g"], ["p"]], desc: "Open Prometheus" },
  { keys: [["c"]], desc: "Clear all chaos" },
  { keys: [["t"]], desc: "Toggle traffic generator" },
  { keys: [["?"]], desc: "Toggle this overlay" },
  { keys: [["Esc"]], desc: "Close overlay / drill panel" },
];

export function ShortcutOverlay({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="shortcut-backdrop" onClick={onClose}>
      <div className="shortcut-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="label">Keyboard shortcuts</span>
          <span className="label" style={{ color: "var(--fg-4)" }}>press ? to toggle</span>
        </header>
        <div className="shortcut-grid">
          {SHORTCUTS.map((s, i) => (
            <React.Fragment key={i}>
              <div className="keys">
                {s.keys.map((k, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <span className="sep">then</span>}
                    {k.map((ch, l) => <Kbd key={l}>{ch}</Kbd>)}
                  </React.Fragment>
                ))}
              </div>
              <div className="desc">{s.desc}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
