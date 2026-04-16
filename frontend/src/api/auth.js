import { GATEWAY_URL, jpost } from "./config";

const TOKEN_KEY = "mesh.auth.token";

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
