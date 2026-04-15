/* ProfilePage — read-only profile + sign-out + a few preferences.
   Toy/static for the demo; the layout matches the rest of the app. */

import React from "react";
import { CheckGlyph } from "./Primitives";

function fmtDate(ms) {
  if (!ms) return "—";
  try {
    const d = new Date(ms);
    return d.toLocaleString();
  } catch { return "—"; }
}

export function ProfilePage({ user, onLogout, onBack }) {
  if (!user) return null;
  const initials = (user.display_name || user.id || "?")
    .split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="profile-shell">
      <header className="profile-head">
        <button className="btn ghost" onClick={onBack}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M6 1 L2 5 L6 9" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          Back to dashboard
        </button>
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
            <circle cx="6" cy="6" r="2" fill="var(--fg)" />
            <circle cx="18" cy="6" r="2" fill="var(--fg)" />
            <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
            <circle cx="6" cy="18" r="2" fill="var(--fg)" />
            <circle cx="18" cy="18" r="2" fill="var(--fg)" />
            <path d="M6 6 L12 12 L18 6 M6 18 L12 12 L18 18" stroke="var(--hairline-3)" strokeWidth="1" />
          </svg>
          <div className="name" style={{ fontSize: 13 }}>Mesh<span>Control</span></div>
        </div>
      </header>

      <div className="profile-body">
        <div className="profile-card">
          <div className="profile-id">
            <div className="avatar lg">{initials}</div>
            <div>
              <h2>{user.display_name || user.id}</h2>
              <div className="muted">{user.email || "—"}</div>
            </div>
          </div>

          <div className="profile-section">
            <div className="label">Account</div>
            <div className="profile-grid">
              <div className="row"><span className="k">User ID</span><span className="v mono">{user.id}</span></div>
              <div className="row"><span className="k">Email</span><span className="v">{user.email || "—"}</span></div>
              <div className="row"><span className="k">Display name</span><span className="v">{user.display_name || "—"}</span></div>
              <div className="row"><span className="k">Created</span><span className="v">{fmtDate(user.created_ts_ms)}</span></div>
            </div>
          </div>

          <div className="profile-section">
            <div className="label">Permissions</div>
            <div className="profile-grid">
              <div className="row"><span className="k">View dashboard</span><span className="v ok"><CheckGlyph size={11} /> Granted</span></div>
              <div className="row"><span className="k">Inject chaos</span><span className="v ok"><CheckGlyph size={11} /> Granted</span></div>
              <div className="row"><span className="k">Run scripted demos</span><span className="v ok"><CheckGlyph size={11} /> Granted</span></div>
              <div className="row"><span className="k">Modify agent policy</span><span className="v muted">Read-only</span></div>
            </div>
          </div>

          <div className="profile-section">
            <div className="label">Sessions</div>
            <div className="profile-grid">
              <div className="row"><span className="k">Active session</span><span className="v">This browser</span></div>
              <div className="row"><span className="k">Token rotation</span><span className="v">On logout</span></div>
            </div>
          </div>

          <div className="profile-actions">
            <button className="btn stop" onClick={onLogout}>Sign out</button>
          </div>
        </div>

        <aside className="profile-side">
          <div className="label">About this account</div>
          <p className="muted">
            This is a demo identity for Mesh Control. Tokens are issued by
            the auth gRPC service and validated on every request through the
            gateway. Logging out drops the local token; the auth service
            keeps the token valid until restart for simplicity.
          </p>
          <p className="muted">
            For a real deployment, swap the in-memory user store for a
            database, add token expiry, and put TLS at the load balancer.
          </p>
        </aside>
      </div>
    </div>
  );
}
