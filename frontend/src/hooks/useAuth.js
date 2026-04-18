import { useState, useEffect, useCallback } from "react";
import * as Auth from "../api/auth";

/* useAuth — single source of truth for the logged-in user.
   Tries to validate any stored token on mount; if invalid, drops it.
   Returns { token, user, status, login, register, logout }. */
export function useAuth() {
  const [initialAuth] = useState(() => Auth.readInitialAuthState());
  const [oauthError, setOauthError] = useState(initialAuth.oauthError);
  const [token, setToken] = useState(initialAuth.token);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | anon | authed | error
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    Auth.googleStatus().then((r) => {
      if (alive) setGoogleEnabled(Boolean(r.enabled));
    });
    return () => { alive = false; };
  }, []);

  // Validate any persisted token on mount.
  useEffect(() => {
    if (!token) { setStatus("anon"); return; }
    let alive = true;
    (async () => {
      try {
        const r = await Auth.getMe(token);
        if (!alive) return;
        if (r.ok) {
          setUser({ id: r.user, display_name: r.display_name, email: r.email, created_ts_ms: r.created_ts_ms });
          setStatus("authed");
        } else {
          Auth.setStoredToken(null);
          setToken(null);
          setStatus("anon");
        }
      } catch {
        if (!alive) return;
        // network error — keep token, retry next time, but mark anon for now.
        setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const doLogin = useCallback(async ({ user: u, password }) => {
    setOauthError("");
    const r = await Auth.login({ user: u, password });
    if (r.ok && r.token) {
      Auth.setStoredToken(r.token);
      setToken(r.token);
      // me-fetch happens in the effect when token changes
    }
    return r;
  }, []);

  const doRegister = useCallback(async ({ email, password, display_name }) => {
    setOauthError("");
    const r = await Auth.register({ email, password, display_name });
    if (r.ok && r.token) {
      Auth.setStoredToken(r.token);
      setToken(r.token);
    }
    return r;
  }, []);

  const doLogout = useCallback(async () => {
    if (token) await Auth.logout(token);
    Auth.setStoredToken(null);
    setToken(null);
    setUser(null);
    setStatus("anon");
  }, [token]);

  const doGoogleLogin = useCallback(() => {
    setOauthError("");
    Auth.startGoogleLogin();
  }, []);

  return {
    token,
    user,
    status,
    oauthError,
    googleEnabled,
    login: doLogin,
    googleLogin: doGoogleLogin,
    register: doRegister,
    logout: doLogout,
  };
}
