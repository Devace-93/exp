/**
 * Token storage. Access token is kept in memory (primary) and mirrored to
 * localStorage so it survives reloads; refresh token lives in localStorage.
 * All access is browser-guarded so this module is import-safe during SSR.
 */
const ACCESS_KEY = "exp_access_token";
const REFRESH_KEY = "exp_refresh_token";

let accessTokenMem: string | null = null;

export function getAccessToken(): string | null {
  if (accessTokenMem) return accessTokenMem;
  if (typeof localStorage !== "undefined") {
    accessTokenMem = localStorage.getItem(ACCESS_KEY);
  }
  return accessTokenMem;
}

export function getRefreshToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setAccessToken(token: string): void {
  accessTokenMem = token;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACCESS_KEY, token);
  }
}

export function setTokens(access: string, refresh?: string): void {
  setAccessToken(access);
  if (refresh && typeof localStorage !== "undefined") {
    localStorage.setItem(REFRESH_KEY, refresh);
  }
}

export function clearTokens(): void {
  accessTokenMem = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
