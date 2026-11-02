/**
 * Session state for the dashboard, delegated to accounts.3m4.net.
 *
 * The browser never handles tokens: accounts sets the HttpOnly `3m4_session`
 * cookie on `.3m4.net` (host-only on localhost), this app's API verifies it,
 * and this module only asks accounts who the visitor is and where its hosted
 * pages live. Import-safe during SSR (nothing touches `window` at load).
 */
import { LANG_STORAGE_KEY } from "../i18n/langs";
import { createSessionClient, type SessionUser } from "./m4session";

export const ACCOUNTS_URL = (import.meta.env.VITE_ACCOUNTS_URL || "http://localhost:8085").replace(/\/$/, "");

export const session = createSessionClient(ACCOUNTS_URL);

export type { SessionUser };

/**
 * The viewer's language (`localStorage["3m4.lang"]`, shared by every 3m4 app),
 * appended as `?lang=` to the hosted accounts pages so login / signup /
 * profile open in the same language as this app. `undefined` during SSR or
 * when never chosen (accounts then falls back to its own detection).
 */
export function currentLang(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Current identity or `null` when signed out (cached ~30 s). */
export const getSession = (force = false): Promise<SessionUser | null> => session.getSession(force);

/**
 * Hosted pages; `returnTo` defaults to the current page. `lang` defaults to
 * the stored preference; components pass the reactive `i18n.lang` instead so
 * the anchor follows the language picker.
 */
export const loginUrl = (returnTo?: string, lang: string | undefined = currentLang()): string =>
  session.loginUrl(returnTo, lang);
export const signupUrl = (returnTo?: string, lang: string | undefined = currentLang()): string =>
  session.signupUrl(returnTo, lang);
export const profileUrl = (lang: string | undefined = currentLang()): string => session.profileUrl(lang);
export const logoutUrl = (returnTo?: string, lang: string | undefined = currentLang()): string =>
  session.logoutUrl(returnTo, lang);
/** Where an unverified user confirms the e-mail (shows the resend button). */
export const verifyUrl = (returnTo?: string, lang: string | undefined = currentLang()): string => {
  return (
    `${ACCOUNTS_URL}/verify?return_to=${encodeURIComponent(returnTo ?? (typeof location !== "undefined" ? location.href : "/"))}` +
    (lang ? `&lang=${encodeURIComponent(lang)}` : "")
  );
};

/** Revoke the session at accounts (every app at once). */
export const logout = (): Promise<void> => session.logout();
