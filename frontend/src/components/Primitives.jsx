/* Primitives — small reusable pieces (numbers, pills, sparks, skeletons,
   kbd chips, icon buttons, disclosures, glyphs, tooltip, time helpers). */

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function CountUp({ value, decimals = 0, suffix = "", className = "" }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(performance.now());
  const rafRef = useRef(0);

  useEffect(() => {
    fromRef.current = shown;
    startRef.current = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startRef.current) / 300);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setShown(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={`num ${className}`}>{shown.toFixed(decimals)}{suffix}</span>;
}

export function StatusPill({ status, label, transmitting = false }) {
  return (
    <span className={`pill ${status || "unknown"}`}>
      <span className={`dot ${transmitting ? "pulse-on" : ""}`}></span>
      {label || status}
    </span>
  );
}

export function MetricSparkline({ data, width = 120, height = 28, accent = "var(--fg)" }) {
  if (!data || !data.length) return <svg width={width} height={height}></svg>;
  const min = Math.min(...data);
  const max = Math.max(...data, min + 1);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const fillD = `${d} L ${width} ${height} L 0 ${height} Z`;
  const lastY = pts[pts.length - 1][1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={fillD} fill={accent} opacity={0.06} />
      <path d={d} fill="none" stroke={accent} strokeWidth={1.1} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={lastY} r={1.8} fill={accent} />
    </svg>
  );
}

export function PulseSparkline({ data, width = 110, height = 18 }) {
  return <MetricSparkline data={data} width={width} height={height} accent="var(--fg-2)" />;
}

export function Skeleton({ width = "100%", height = 4, style = {} }) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

export function Kbd({ children }) { return <kbd className="kbd">{children}</kbd>; }

/* Tooltip — rich hover popover with label + optional hint line.
   Renders via portal so positioning isn't trapped by overflow:hidden. */
export function Tooltip({ children, label, hint, side = "top", delay = 220 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, align: "center" });
  const ref = useRef(null);
  const tRef = useRef(0);

  const show = () => {
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let x = r.left + r.width / 2;
      let y = side === "bottom" ? r.bottom + 8 : r.top - 8;
      let align = "center";
      if (x < 140) { x = r.left; align = "left"; }
      else if (x > window.innerWidth - 140) { x = r.right; align = "right"; }
      setPos({ x, y, align });
      setOpen(true);
    }, delay);
  };
  const hide = () => { clearTimeout(tRef.current); setOpen(false); };

  return (
    <span ref={ref} className="tip-wrap"
      onMouseEnter={show} onMouseLeave={hide}
      onFocus={show} onBlur={hide}>
      {children}
      {open && (label || hint) && createPortal(
        <div className={`tip ${side} ${pos.align} ${open ? "in" : ""}`}
          style={{ left: pos.x, top: pos.y }}>
          {label && <div className="tip-label">{label}</div>}
          {hint && <div className="tip-hint">{hint}</div>}
        </div>,
        document.body
      )}
    </span>
  );
}

export function IconBtn({ title, onClick, children, href, target, tip }) {
  const inner = href
    ? <a className="icon-btn" href={href} target={target || "_blank"} rel="noreferrer">{children}</a>
    : <button className="icon-btn" onClick={onClick}>{children}</button>;
  if (tip || title) {
    return <Tooltip label={title} hint={tip}>{inner}</Tooltip>;
  }
  return inner;
}

export function Disclosure({ open, onToggle, label, count }) {
  return (
    <button className={`collapse-toggle ${open ? "open" : ""}`} onClick={onToggle}>
      <span className="caret">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M2 1 L6 4 L2 7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </span>
      <span>{label}{count != null ? <span style={{ color: "var(--fg-4)", marginLeft: 6 }}>{count}</span> : null}</span>
    </button>
  );
}

export function relTime(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5)   return "just now";
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function durationStr(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

export function formatCents(c) {
  if (c == null) return "—";
  const dollars = (c / 100).toFixed(2);
  return `$${dollars}`;
}

export function CheckGlyph({ size = 14, color = "var(--signal)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3 7 L6 10 L11 4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function XGlyph({ size = 14, color = "var(--crit)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
export function PlayGlyph({ size = 10, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <path d="M2 1.5 L8.5 5 L2 8.5 Z" fill={color} />
    </svg>
  );
}
export function ExtLink({ size = 11, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M5 2 L10 2 L10 7 M10 2 L4 8 M2 4 L2 10 L8 10" stroke={color} strokeWidth="1.1" />
    </svg>
  );
}
