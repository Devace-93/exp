import type { RequestHandler } from "@builder.io/qwik-city";

/**
 * Sign-up lives at accounts.3m4.net (one identity for every 3m4 app). This
 * route only exists so old links and the Caddy matchers keep working: it
 * bounces to the hosted page and asks to come back to the dashboard.
 */
export const onGet: RequestHandler = ({ redirect, url, env }) => {
  const accounts = (env.get("ACCOUNTS_URL") || process.env.ACCOUNTS_URL || "http://localhost:8085").replace(/\/$/, "");
  const requested = url.searchParams.get("return_to") || "";
  // Only our own origin may be a return target; anything else goes to the dashboard.
  const back = requested.startsWith(url.origin) ? requested : `${url.origin}/dashboard`;
  throw redirect(302, `${accounts}/signup?return_to=${encodeURIComponent(back)}`);
};
