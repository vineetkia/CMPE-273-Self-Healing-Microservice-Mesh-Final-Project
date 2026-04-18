import { GATEWAY_URL, jpost } from "./config";

const TOKEN_KEY = "mesh.auth.token";
const OAUTH_TOKEN_PARAM = "oauth_token";
const OAUTH_ERROR_PARAM = "oauth_error";

export function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

export async function login({ user, password }) {
  return jpost(`${GATEWAY_URL}/auth/login`, { user, password });
}

export async function googleStatus() {
  try {
    const r = await fetch(`${GATEWAY_URL}/auth/google/status`);
    if (!r.ok) return { enabled: false };
    return r.json();
  } catch {
    return { enabled: false };
  }
}

export function googleLoginUrl() {
  const returnTo = `${frontendBase()}#/dashboard`;
  return `${GATEWAY_URL}/auth/google/login?return_to=${encodeURIComponent(returnTo)}`;
}

export function startGoogleLogin() {
  window.location.assign(googleLoginUrl());
}

export function readInitialAuthState() {
  const oauth = consumeOAuthResultFromHash();
  if (oauth.token) setStoredToken(oauth.token);
  return {
    token: oauth.token || getStoredToken(),
    oauthError: oauth.error || "",
  };
}

function consumeOAuthResultFromHash() {
  const hash = window.location.hash || "";
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return { token: "", error: "" };

  const route = hash.slice(0, queryStart) || "#/dashboard";
  const params = new URLSearchParams(hash.slice(queryStart + 1));
  const token = params.get(OAUTH_TOKEN_PARAM) || "";
  const error = params.get(OAUTH_ERROR_PARAM) || "";
  if (!token && !error) return { token: "", error: "" };

  params.delete(OAUTH_TOKEN_PARAM);
  params.delete("oauth_user");
  params.delete(OAUTH_ERROR_PARAM);
  const rest = params.toString();
  const cleanHash = `${route}${rest ? `?${rest}` : ""}`;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${cleanHash}`,
  );
  return { token, error };
}

function frontendBase() {
  const originOverride = import.meta.env.VITE_FRONTEND_URL;
  if (originOverride) return originOverride.replace(/\/$/, "");
  return `${window.location.origin}${window.location.pathname}`;
}

export async function register({ email, password, display_name }) {
  return jpost(`${GATEWAY_URL}/auth/register`, { email, password, display_name });
}

export async function getMe(token) {
  return jpost(`${GATEWAY_URL}/auth/me`, { token });
}

export async function logout(token) {
  try { await jpost(`${GATEWAY_URL}/auth/logout`, { token }); } catch { /* ignore */ }
  setStoredToken(null);
}
