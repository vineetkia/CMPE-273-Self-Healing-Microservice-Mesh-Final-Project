/* DependencyGraph — pure-SVG hero. Layered DAG layout, smooth wheel zoom,
   drag-to-pan on background, drag-to-move on nodes, bidirectional latency-
   aware particles, click-to-drill. */

import React, { useState, useEffect, useRef } from "react";

const NODE_W = 168;
const NODE_H = 64;
const VIEW_W = 1100;
const VIEW_H = 480;

export function computeLayout(services, edges) {
  const inDeg = Object.fromEntries(services.map(s => [s.id, 0]));
  const succ  = Object.fromEntries(services.map(s => [s.id, []]));
  edges.forEach(([a, b]) => {
    inDeg[b] = (inDeg[b] || 0) + 1;
    succ[a] = succ[a] ? [...succ[a], b] : [b];
  });

  const remaining = new Set(services.map(s => s.id));
  const layers = [];
  const localIn = { ...inDeg };
  while (remaining.size) {
    const layer = [...remaining].filter(n => localIn[n] === 0);
    if (!layer.length) { layers.push([...remaining]); break; }
    layers.push(layer);
    layer.forEach(n => {
      remaining.delete(n);
      (succ[n] || []).forEach(s => { localIn[s] -= 1; });
    });
  }

  const marginLeft = 110, marginRight = 110, marginY = 60;
  const usableW = VIEW_W - marginLeft - marginRight;
  const usableH = VIEW_H - marginY * 2;
  const layout = {};

  const placedLayers = [];
  layers.forEach(layer => {
    if (layer.length > 5) {
      const half = Math.ceil(layer.length / 2);
      placedLayers.push(layer.slice(0, half));
      placedLayers.push(layer.slice(half));
    } else {
      placedLayers.push(layer);
    }
  });

  placedLayers.forEach((layer, li) => {
    const x = placedLayers.length === 1 ? VIEW_W / 2
      : marginLeft + (li / (placedLayers.length - 1)) * usableW;
    layer.forEach((id, ni) => {
      const y = layer.length === 1 ? VIEW_H / 2
        : marginY + (ni / (layer.length - 1)) * usableH;
      layout[id] = { x, y };
    });
  });
  return layout;
}

function curveD(x1, y1, x2, y2, offset = 0) {
  const dx = (x2 - x1) * 0.55;
  return `M ${x1} ${y1 + offset} C ${x1 + dx} ${y1 + offset}, ${x2 - dx} ${y2 + offset}, ${x2} ${y2 + offset}`;
}

function durationFor(p95, faulty) {
  const clamped = Math.max(50, Math.min(1500, p95 || 50));
  const base = 1.4 + ((clamped - 50) / 1450) * 3.1;
  return faulty ? base * 0.7 : base;
}

function ServiceNode({ svc, pos, m, focused, faulty, victim, onPointerDown, kind, dragging }) {
  const x = pos.x - NODE_W / 2, y = pos.y - NODE_H / 2;
  const isFault = faulty === svc.id;
  const isVic = victim.includes(svc.id);
  const stroke = isFault ? "var(--crit)" : isVic ? "var(--warn)" : focused ? "var(--hairline-3)" : "var(--hairline-2)";
  const strokeW = isFault ? 1.5 : focused ? 1.25 : 1;
  const fill = isFault ? "rgba(255,77,94,0.06)" : isVic ? "rgba(242,162,59,0.04)" : "var(--bg)";
  const dotColor = isFault ? "var(--crit)" : isVic ? "var(--warn)" : "var(--signal)";
  const valueColor = isFault ? "var(--crit)" : isVic ? "var(--warn)" : "var(--fg)";

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{
        cursor: dragging ? "grabbing" : "grab",
        transition: dragging ? "none" : "transform 200ms cubic-bezier(.2,0,0,1)",
      }}
      onPointerDown={(e) => onPointerDown(e, svc.id)}
    >
      <rect width={NODE_W} height={NODE_H} rx={8} fill={fill} stroke={stroke} strokeWidth={strokeW}
        style={{ transition: "stroke 200ms, fill 200ms" }} />
      <circle cx={14} cy={20} r={3} fill={dotColor}>
        {(isFault || isVic) && <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />}
      </circle>
      <text x={26} y={24} fontFamily="var(--mono)" fontSize="13" fill="var(--fg)" pointerEvents="none">{svc.label}</text>
      <text x={NODE_W - 14} y={24} fontFamily="var(--mono)" fontSize="10" fill="var(--fg-3)" textAnchor="end" style={{ letterSpacing: "0.04em" }} pointerEvents="none">
        {kind === "edge" ? "EDGE" : "SVC"}
      </text>
      <text x={14} y={44} fontFamily="var(--mono)" fontSize="11" fill="var(--fg-2)" pointerEvents="none">p95</text>
      <text x={42} y={44} fontFamily="var(--mono)" fontSize="11" fill={valueColor} pointerEvents="none">{Math.round(m.p95)}ms</text>
      <text x={94} y={44} fontFamily="var(--mono)" fontSize="11" fill="var(--fg-2)" pointerEvents="none">err</text>
      <text x={118} y={44} fontFamily="var(--mono)" fontSize="11" fill={valueColor} pointerEvents="none">{(m.err * 100).toFixed(1)}%</text>
      <text x={14} y={56} fontFamily="var(--mono)" fontSize="10" fill="var(--fg-3)" pointerEvents="none">{Math.round(m.rps)} rps</text>
      {focused && <rect width={NODE_W} height={NODE_H} rx={8} fill="none" stroke="var(--fg)" strokeWidth={1} strokeDasharray="2 3" opacity={0.5} pointerEvents="none" />}
    </g>
  );
}

function Edge({ a, b, faulty, p95, traffic }) {
  const A = { x: a.x + NODE_W / 2, y: a.y };
  const B = { x: b.x - NODE_W / 2, y: b.y };
  const fwd = curveD(A.x, A.y, B.x, B.y, 0);
  const rev = curveD(A.x, A.y, B.x, B.y, 8);
  const eStroke = faulty ? "var(--crit)" : "var(--hairline-3)";
  const fwdColor = faulty ? "var(--crit)" : "var(--signal)";
  const revColor = faulty ? "var(--crit)" : "var(--fg-3)";
  const dur = durationFor(p95, faulty);
  // Connecting lines are always visible (the static base topology). Only the
  // animated particles fade with the traffic toggle.
  const particleOpacity = traffic ? 1 : 0;

  return (
    <g>
      <path d={fwd} stroke={eStroke} strokeWidth={1} fill="none" style={{ transition: "stroke 200ms" }} />
      <path d={rev} stroke={eStroke} strokeWidth={1} fill="none" strokeDasharray="3 4" opacity={0.5} />
      <g style={{ transition: "opacity 300ms" }} opacity={particleOpacity}>
        {[0, 1, 2].map(i => (
          <circle key={`f${i}`} r={1.8} fill={fwdColor}>
            <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${i * (dur/3)}s`} path={fwd} />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur={`${dur}s`} repeatCount="indefinite" begin={`${i * (dur/3)}s`} />
          </circle>
        ))}
        {[0, 1].map(i => (
          <circle key={`r${i}`} r={1.4} fill={revColor}>
            <animateMotion dur={`${dur * 1.1}s`} repeatCount="indefinite" begin={`${i * (dur/2)}s`} path={rev} keyPoints="1;0" keyTimes="0;1" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur={`${dur * 1.1}s`} repeatCount="indefinite" begin={`${i * (dur/2)}s`} />
          </circle>
        ))}
      </g>
    </g>
  );
}

export function DependencyGraph({ services, edges, layout, health, focused, faulty, traffic, onFocus, onBgClick }) {
  const [, setTick] = useState(0);
  const liveRef = useRef({ pan: { x: 0, y: 0 }, zoom: 1 });
  const targetRef = useRef({ pan: { x: 0, y: 0 }, zoom: 1 });
  const rafRef = useRef(0);
  const overridesRef = useRef({});
  const dragRef = useRef(null);
  const svgRef = useRef(null);
  const flowKey = services.map(s => s.id).join("|");

  useEffect(() => {
    overridesRef.current = {};
    targetRef.current = { pan: { x: 0, y: 0 }, zoom: 1 };
    liveRef.current = { pan: { x: 0, y: 0 }, zoom: 1 };
    setTick(t => t + 1);
  }, [flowKey]);

  useEffect(() => {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const t = targetRef.current, l = liveRef.current;
      const k = 1 - Math.pow(0.0008, dt / 1000);
      const dx = t.pan.x - l.pan.x;
      const dy = t.pan.y - l.pan.y;
      const dz = t.zoom - l.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 0.05 || Math.abs(dz) > 0.001) {
        l.pan.x += dx * k;
        l.pan.y += dy * k;
        l.zoom += dz * k;
        setTick(n => n + 1);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const clientToView = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return {
      x: ((cx - r.left) / r.width) * VIEW_W,
      y: ((cy - r.top) / r.height) * VIEW_H,
    };
  };

  const onWheel = (e) => {
    e.preventDefault();
    const { x: mx, y: my } = clientToView(e.clientX, e.clientY);
    const t = targetRef.current;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.5, Math.min(3, t.zoom * factor));
    const wx = (mx - t.pan.x) / t.zoom;
    const wy = (my - t.pan.y) / t.zoom;
    t.pan = { x: mx - wx * newZoom, y: my - wy * newZoom };
    t.zoom = newZoom;
  };

  const onPointerDownBg = (e) => {
    if (!e.target.dataset.bg) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "pan",
      sx: e.clientX, sy: e.clientY,
      pan: { ...targetRef.current.pan },
      moved: false,
    };
  };

  const onPointerDownNode = (e, svcId) => {
    e.stopPropagation();
    e.currentTarget.ownerSVGElement.setPointerCapture(e.pointerId);
    const start = clientToView(e.clientX, e.clientY);
    const startPos = overridesRef.current[svcId] || layout[svcId];
    dragRef.current = {
      kind: "node",
      id: svcId,
      startView: start,
      startPos: { ...startPos },
      moved: false,
    };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      const r = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - d.sx) / r.width) * VIEW_W;
      const dy = ((e.clientY - d.sy) / r.height) * VIEW_H;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
      const t = targetRef.current;
      const z = t.zoom;
      const minX = -(VIEW_W * (z - 1)) - VIEW_W * 0.5;
      const maxX = VIEW_W * 0.5;
      const minY = -(VIEW_H * (z - 1)) - VIEW_H * 0.5;
      const maxY = VIEW_H * 0.5;
      t.pan = {
        x: Math.max(minX, Math.min(maxX, d.pan.x + dx)),
        y: Math.max(minY, Math.min(maxY, d.pan.y + dy)),
      };
      liveRef.current.pan = { ...t.pan };
      setTick(n => n + 1);
    } else if (d.kind === "node") {
      const cur = clientToView(e.clientX, e.clientY);
      const dx = (cur.x - d.startView.x) / liveRef.current.zoom;
      const dy = (cur.y - d.startView.y) / liveRef.current.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      overridesRef.current = {
        ...overridesRef.current,
        [d.id]: { x: d.startPos.x + dx, y: d.startPos.y + dy },
      };
      setTick(n => n + 1);
    }
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "pan" && !d.moved && e.target.dataset.bg) onBgClick && onBgClick();
    if (d.kind === "node" && !d.moved) onFocus && onFocus(d.id);
  };

  const animatedZoomTo = (newZoom, anchor) => {
    const t = targetRef.current;
    const ax = anchor?.x ?? VIEW_W / 2;
    const ay = anchor?.y ?? VIEW_H / 2;
    const wx = (ax - t.pan.x) / t.zoom;
    const wy = (ay - t.pan.y) / t.zoom;
    t.zoom = Math.max(0.5, Math.min(3, newZoom));
    t.pan = { x: ax - wx * t.zoom, y: ay - wy * t.zoom };
  };

  const fitView = () => {
    overridesRef.current = {};
    targetRef.current = { pan: { x: 0, y: 0 }, zoom: 1 };
  };

  const positionsFor = (svcId) => overridesRef.current[svcId] || layout[svcId];

  const victim = (() => {
    if (!faulty) return [];
    const out = new Set();
    const queue = [faulty];
    while (queue.length) {
      const cur = queue.shift();
      edges.forEach(([a, b]) => { if (b === cur && !out.has(a)) { out.add(a); queue.push(a); } });
    }
    return [...out];
  })();

  const live = liveRef.current;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg
        className="canvas"
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <defs>
          <pattern id="grid-fine" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5" />
          </pattern>
          <pattern id="grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="url(#grid-fine)" />
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect data-bg="1" width={VIEW_W} height={VIEW_H} fill="url(#grid-major)" />
        <g transform={`translate(${live.pan.x.toFixed(2)}, ${live.pan.y.toFixed(2)}) scale(${live.zoom.toFixed(3)})`}>
          {edges.map(([a, b], i) => {
            const A = positionsFor(a), B = positionsFor(b);
            if (!A || !B) return null;
            const isFault = faulty && b === faulty && a !== faulty;
            const m = health[b] || { p95: 50 };
            return <Edge key={i} a={A} b={B} faulty={isFault} p95={m.p95} traffic={traffic} />;
          })}
          {services.map(svc => {
            const pos = positionsFor(svc.id);
            if (!pos) return null;
            return (
              <ServiceNode
                key={svc.id}
                svc={svc}
                pos={pos}
                m={health[svc.id] || { p95: 0, err: 0, rps: 0 }}
                focused={focused === svc.id}
                faulty={faulty}
                victim={victim}
                kind={svc.kind}
                dragging={dragRef.current?.kind === "node" && dragRef.current?.id === svc.id}
                onPointerDown={onPointerDownNode}
              />
            );
          })}
        </g>
      </svg>
      <div className="zoom-cluster">
        <button title="Zoom in" onClick={() => animatedZoomTo(targetRef.current.zoom * 1.2)}>+</button>
        <button title="Fit to canvas" className="fit" onClick={fitView}>fit</button>
        <button title="Zoom out" onClick={() => animatedZoomTo(targetRef.current.zoom / 1.2)}>−</button>
      </div>
    </div>
  );
}

export function MiniDependencyGraph({ services, edges, layout, faulty }) {
  const W = 260, H = 120;
  const xs = services.map(s => layout[s.id]?.x).filter(v => v != null);
  const ys = services.map(s => layout[s.id]?.y).filter(v => v != null);
  const minX = xs.length ? Math.min(...xs) : 0, maxX = xs.length ? Math.max(...xs) : VIEW_W;
  const minY = ys.length ? Math.min(...ys) : 0, maxY = ys.length ? Math.max(...ys) : VIEW_H;
  const padX = 36, padY = 22;
  const sx = (x) => padX + ((x - minX) / Math.max(1, maxX - minX)) * (W - padX * 2);
  const sy = (y) => padY + ((y - minY) / Math.max(1, maxY - minY)) * (H - padY * 2);

  const victims = (() => {
    if (!faulty) return new Set();
    const out = new Set();
    const queue = [faulty];
    while (queue.length) {
      const cur = queue.shift();
      edges.forEach(([a, b]) => { if (b === cur && !out.has(a)) { out.add(a); queue.push(a); } });
    }
    return out;
  })();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <defs>
        <radialGradient id="mg-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(255,77,94,0.35)" />
          <stop offset="60%" stopColor="rgba(255,77,94,0.05)" />
          <stop offset="100%" stopColor="rgba(255,77,94,0)" />
        </radialGradient>
      </defs>
      {Array.from({ length: 7 }).map((_, ix) =>
        Array.from({ length: 4 }).map((__, iy) =>
          <circle key={`g-${ix}-${iy}`} cx={ix * (W/6)} cy={iy * (H/3)} r={0.5} fill="rgba(255,255,255,0.06)" />
        )
      )}
      {faulty && layout[faulty] && (
        <circle cx={sx(layout[faulty].x)} cy={sy(layout[faulty].y)} r={28} fill="url(#mg-glow)" />
      )}
      {edges.map(([f, t], i) => {
        const a = layout[f], b = layout[t];
        if (!a || !b) return null;
        const x1 = sx(a.x), y1 = sy(a.y);
        const x2 = sx(b.x), y2 = sy(b.y);
        const isCrit = faulty && (t === faulty || (f === faulty));
        const dx = x2 - x1;
        const cx = x1 + dx * 0.5, cy = (y1 + y2) / 2;
        const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
        return (
          <path key={i} d={d} fill="none"
            stroke={isCrit ? "var(--crit)" : "rgba(255,255,255,0.10)"}
            strokeWidth={isCrit ? 1.2 : 0.8}
            opacity={isCrit ? 0.95 : 0.75}
          />
        );
      })}
      {services.map(svc => {
        const p = layout[svc.id];
        if (!p) return null;
        const isF = faulty === svc.id;
        const isV = victims.has(svc.id);
        const cx = sx(p.x), cy = sy(p.y);
        const fill = isF ? "rgba(255,77,94,0.18)" : isV ? "rgba(242,162,59,0.12)" : "rgba(0,224,138,0.08)";
        const stroke = isF ? "var(--crit)" : isV ? "var(--warn)" : "var(--signal-hair)";
        const dot = isF ? "var(--crit)" : isV ? "var(--warn)" : "var(--signal)";
        return (
          <g key={svc.id} transform={`translate(${cx}, ${cy})`}>
            <rect x={-26} y={-9} width={52} height={18} rx={4}
              fill={fill} stroke={stroke} strokeWidth={isF ? 1.1 : 0.8} />
            <circle cx={-19} cy={0} r={2} fill={dot}>
              {isF && <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />}
            </circle>
            <text x={-13} y={3} fontFamily="var(--mono)" fontSize="8.5"
              fill={isF ? "var(--crit)" : isV ? "var(--warn)" : "var(--fg-2)"}>
              {svc.label.length > 8 ? svc.label.slice(0, 7) + "…" : svc.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
