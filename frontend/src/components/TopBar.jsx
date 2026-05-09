/* TopBar — sticky 56px header.
   Owns brand mark, env chip, live RPS pulse, uptime, since-last-incident,
   jaeger/prom/help icon buttons, avatar.
   Props: rps, pulse, lastIncidentAt, bootedAt, onHelp. */

import React, { useState, useEffect } from "react";
import { CountUp, PulseSparkline, IconBtn, Tooltip, durationStr } from "./Primitives";
import { JAEGER_URL, PROM_URL } from "../api/config";

function MeshMark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" fill="none">
      <circle cx="6" cy="6" r="2" fill="var(--fg)" />
      <circle cx="18" cy="6" r="2" fill="var(--fg)" />
      <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
      <circle cx="6" cy="18" r="2" fill="var(--fg)" />
      <circle cx="18" cy="18" r="2" fill="var(--fg)" />
      <path d="M6 6 L12 12 L18 6 M6 18 L12 12 L18 18" stroke="var(--hairline-3)" strokeWidth="1" />
    </svg>
  );
}

export function TopBar({
  rps, pulse, lastIncidentAt, bootedAt, onHelp, env = "production",
  user, onProfile, onLogout, notifSlot,
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const uptime = durationStr(Date.now() - bootedAt);
  const sinceInc = lastIncidentAt ? durationStr(Date.now() - lastIncidentAt) : "—";

  const initials = user
    ? (user.display_name || user.id || "?")
        .split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase()
    : "JK";

  return (
    <header className="topbar">
      <div className="brand">
        <MeshMark />
        <div className="name">Mesh<span>Control</span></div>
      </div>

      <button className="env">
        <span className="dot"></span>
        <span>{env}</span>
        <span style={{ color: "var(--fg-4)", marginLeft: 4 }}>us-west-2</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginLeft: 2 }}>
          <path d="M2 4 L5 7 L8 4" stroke="var(--fg-3)" strokeWidth="1" fill="none" />
        </svg>
      </button>

      <div className="tb-center">
        <div className="tb-cluster">
          <PulseSparkline data={pulse} width={130} height={20} />
          <div className="tb-stack">
            <div className="v"><CountUp value={rps} suffix=" rps" /></div>
            <div className="l">global throughput</div>
          </div>
        </div>

        <div className="tb-divider"></div>

        <div className="tb-stack">
          <div className="v mono">{uptime}</div>
          <div className="l">uptime</div>
        </div>

        <div className="tb-divider"></div>

        <div className="tb-stack">
          <div className="v mono">{sinceInc}</div>
          <div className="l">since last incident</div>
        </div>
      </div>

      <div className="tb-right">
        <IconBtn href={JAEGER_URL}
          title="Open in Jaeger"
          tip="Distributed traces for the active flow. Opens in a new tab.">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.1" />
            <path d="M7 7.5 L7 12 M4 12 L10 12" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </IconBtn>
        <IconBtn href={PROM_URL}
          title="Open in Prometheus"
          tip="Raw mesh metrics — request_total, error_rate, p95. Opens in a new tab.">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 11 L5 6 L8 9 L12 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <circle cx="5" cy="6" r="1" fill="currentColor" />
            <circle cx="8" cy="9" r="1" fill="currentColor" />
            <circle cx="12" cy="3" r="1" fill="currentColor" />
          </svg>
        </IconBtn>
        <IconBtn onClick={onHelp}
          title="Keyboard shortcuts"
          tip="Press ? anytime to see all shortcuts.">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.1" />
            <path d="M5 5.5 a2 2 0 0 1 4 0 c0 1.2 -2 1.3 -2 2.5 M7 10.5 L7 10.6" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
          </svg>
        </IconBtn>
        {notifSlot}
        <Tooltip
          label={user ? `${user.display_name || user.id}` : "Profile"}
          hint="Open your profile, manage the session, sign out."
          side="bottom"
        >
          <button className="avatar" onClick={onProfile} style={{ cursor: "pointer" }}>
            {initials}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
