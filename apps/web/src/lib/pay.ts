/**
 * The payments.3m4.net client for this app (browser only). exp never talks
 * to Stripe: Upgrade / Manage / Donate open the portal's hosted pages, and the
 * backend learns about the outcome through the signed push webhook (see
 * CONTRACT.md "Billing"). `PayResult` is UX only — the plan shown in the
 * dashboard always comes from `/auth/me`.
 */
import { ACCOUNTS_URL } from "./auth";
import { createPayClient, type PayClient } from "./m4pay";

export const PAYMENTS_URL = (import.meta.env.VITE_PAYMENTS_URL || "https://payments.3m4.net").replace(/\/$/, "");
export const PAYMENTS_APP = "exp";

let client: PayClient | null = null;

export function pay(): PayClient {
  if (!client) client = createPayClient(PAYMENTS_URL, { app: PAYMENTS_APP, accountsUrl: ACCOUNTS_URL });
  return client;
}
