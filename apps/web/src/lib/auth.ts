/**
 * Session state for the dashboard, delegated to accounts.3m4.net.
 *
 * The browser never handles tokens: accounts sets the HttpOnly `3m4_session`
 * cookie on `.3m4.net` (host-only on localhost), this app's API verifies it,
 * and this module only asks accounts who the visitor is and where its hosted
 * pages live. Import-safe during SSR (nothing touches `window` at load).
 */
import { createSessionClient, type SessionUser } from "./m4session";

export const ACCOUNTS_URL = (import.meta.env.VITE_ACCOUNTS_URL || "http://localhost:8085").replace(/\/$/, "");

export const session = createSessionClient(ACCOUNTS_URL);

export type { SessionUser };

/** Current identity or `null` when signed out (cached ~30 s). */
export const getSession = (force = false): Promise<SessionUser | null> => session.getSession(force);

/** Hosted pages; `returnTo` defaults to the current page. */
export const loginUrl = (returnTo?: string): string => session.loginUrl(returnTo);
export const signupUrl = (returnTo?: string): string => session.signupUrl(returnTo);
export const profileUrl = (): string => session.profileUrl();
/** Where an unverified user confirms the e-mail (shows the resend button). */
export const verifyUrl = (returnTo?: string): string =>
  `${ACCOUNTS_URL}/verify?return_to=${encodeURIComponent(returnTo ?? (typeof location !== "undefined" ? location.href : "/"))}`;

/** Revoke the session at accounts (every app at once). */
export const logout = (): Promise<void> => session.logout();
