/* RegisterPage — create-account form. */

import React, { useState } from "react";

export function RegisterPage({ onSubmit, onSwitchLogin, onSwitchLanding, busy }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    const r = await onSubmit({ email, password, display_name: displayName });
    if (!r?.ok) setErr(r?.message || "Registration failed");
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-row">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
            <circle cx="6" cy="6" r="2" fill="var(--fg)" />
            <circle cx="18" cy="6" r="2" fill="var(--fg)" />
            <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
            <circle cx="6" cy="18" r="2" fill="var(--fg)" />
            <circle cx="18" cy="18" r="2" fill="var(--fg)" />
            <path d="M6 6 L12 12 L18 6 M6 18 L12 12 L18 18" stroke="var(--hairline-3)" strokeWidth="1" />
          </svg>
          <div className="name">Mesh<span>Control</span></div>
        </div>

        <h1>Create account</h1>
        <div className="sub">Provision an operator account for the mesh.</div>

        <form onSubmit={submit}>
          <div className="field">
            <span className="label">Display name</span>
            <input
              type="text" placeholder="Jordan Kang"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="label">Work email</span>
            <input
              type="email" required autoComplete="email"
              placeholder="jane@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="label">Password</span>
            <input
              type="password" required autoComplete="new-password"
              minLength={4} placeholder="at least 4 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {err ? <div className="auth-error">{err}</div> : null}

          <button type="submit" className="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="divider"></div>

        <div className="footer-note">
          Already have an account? <a href="#/login" onClick={(e) => { e.preventDefault(); onSwitchLogin(); }}>Sign in</a>
          <span style={{ float: "right" }}>
            <a href="#/landing" onClick={(e) => { e.preventDefault(); onSwitchLanding(); }}>Back</a>
          </span>
        </div>
      </div>
    </div>
  );
}
