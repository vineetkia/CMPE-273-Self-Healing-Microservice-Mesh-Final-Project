/* LoginPage — username + password sign-in. */

import React, { useState } from "react";

export function LoginPage({
  onSubmit,
  onGoogle,
  onSwitchRegister,
  onSwitchLanding,
  busy,
  oauthError,
  googleEnabled,
}) {
  const [user, setUser] = useState("demo");
  const [password, setPassword] = useState("x");
  const [err, setErr] = useState("");
  const shownError = err || oauthError;

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    const r = await onSubmit({ user, password });
    if (!r?.ok) setErr(r?.message || "Login failed");
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

        <h1>Sign in</h1>
        <div className="sub">SRE control plane · production · us-west-2</div>

        <form onSubmit={submit}>
          <div className="field">
            <span className="label">User</span>
            <input
              type="text" autoComplete="username"
              placeholder="demo" required
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="label">Password</span>
            <input
              type="password" autoComplete="current-password"
              placeholder="••••••" required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {shownError ? <div className="auth-error">{shownError}</div> : null}

          <button type="submit" className="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="divider"><span>or</span></div>

        <button type="button" className="oauth-btn" onClick={onGoogle} disabled={busy || !googleEnabled}>
          <span className="google-mark" aria-hidden="true">G</span>
          {googleEnabled ? "Continue with Google" : "Google sign-in not configured"}
        </button>

        <div className="footer-note">
          New here? <a href="#/register" onClick={(e) => { e.preventDefault(); onSwitchRegister(); }}>Create an account</a>
          <span style={{ float: "right" }}>
            <a href="#/landing" onClick={(e) => { e.preventDefault(); onSwitchLanding(); }}>Back</a>
          </span>
        </div>
      </div>
    </div>
  );
}
