// WhisperBox API client with auto-refresh of access tokens.
// Tokens are kept in memory; refresh token is in sessionStorage.
// Private key material is NEVER stored; it is re-derived from the password on login.

import type {
  AuthResponse,
  ConversationSummary,
  EncryptedPayload as ApiEncPayload,
  MessageResponse,
  UserProfile,
  UserPublicInfo,
} from "./types";

export const API_BASE = "https://whisperbox.koyeb.app";
export const WS_BASE = "wss://whisperbox.koyeb.app";

const REFRESH_KEY = "wb.refresh";

let accessToken: string | null = null;
let refreshToken: string | null = sessionStorage.getItem(REFRESH_KEY);
let accessExpiresAt = 0;
let refreshInflight: Promise<string> | null = null;

export function getAccessToken() {
  return accessToken;
}

export function hasRefreshToken() {
  return !!refreshToken;
}

function setTokens(access: string, expiresIn: number, refresh?: string) {
  accessToken = access;
  accessExpiresAt = Date.now() + expiresIn * 1000;
  if (refresh) {
    refreshToken = refresh;
    sessionStorage.setItem(REFRESH_KEY, refresh);
  }
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  accessExpiresAt = 0;
  sessionStorage.removeItem(REFRESH_KEY);
}

async function refreshAccess(): Promise<string> {
  if (!refreshToken) throw new Error("No refresh token");
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    const r = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) {
      clearTokens();
      throw new Error("Session expired");
    }
    const data = (await r.json()) as {
      access_token: string;
      expires_in: number;
    };
    setTokens(data.access_token, data.expires_in);
    return data.access_token;
  })();
  try {
    return await refreshInflight;
  } finally {
    refreshInflight = null;
  }
}

async function ensureAccess(): Promise<string | null> {
  if (!accessToken) {
    if (refreshToken) return await refreshAccess();
    return null;
  }
  if (Date.now() > accessExpiresAt - 30_000) {
    try {
      return await refreshAccess();
    } catch {
      return null;
    }
  }
  return accessToken;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (auth) {
    const tok = await ensureAccess();
    if (tok) headers.set("Authorization", `Bearer ${tok}`);
  }
  let r = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (r.status === 401 && auth && refreshToken) {
    try {
      const tok = await refreshAccess();
      headers.set("Authorization", `Bearer ${tok}`);
      r = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch {
      /* fall through */
    }
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = j.detail?.[0]?.msg || j.detail || j.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export async function register(body: {
  username: string;
  display_name: string;
  password: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
}): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    false,
  );
  setTokens(data.access_token, data.expires_in, data.refresh_token);
  return data;
}

export async function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  const data = await apiFetch<AuthResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
    false,
  );
  setTokens(data.access_token, data.expires_in, data.refresh_token);
  return data;
}

export async function getMe(): Promise<UserProfile> {
  return apiFetch<UserProfile>("/auth/me");
}

export async function logout(): Promise<void> {
  if (refreshToken) {
    try {
      await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      /* ignore */
    }
  }
  clearTokens();
}

export async function searchUsers(q: string): Promise<UserPublicInfo[]> {
  const params = new URLSearchParams({ q });
  return apiFetch<UserPublicInfo[]>(`/users/search?${params}`);
}

export async function getUserPublicKey(userId: string): Promise<string> {
  const r = await apiFetch<{ public_key: string }>(
    `/users/${userId}/public-key`,
  );
  return r.public_key;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/conversations");
}

export async function listMessages(
  userId: string,
  before?: string,
  limit = 50,
): Promise<MessageResponse[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  return apiFetch<MessageResponse[]>(
    `/conversations/${userId}/messages?${params}`,
  );
}

export async function sendMessageRest(
  to: string,
  payload: ApiEncPayload,
): Promise<MessageResponse> {
  return apiFetch<MessageResponse>("/messages", {
    method: "POST",
    body: JSON.stringify({ to, payload }),
  });
}

export async function getAccessTokenForWs(): Promise<string | null> {
  return ensureAccess();
}
