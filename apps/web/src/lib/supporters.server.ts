/**
 * Server-side supporters list (SSR only — imported from routeLoader$).
 *
 * `/sponsors` lists the people who support exp through payments.3m4.net
 * (opted-in Pro subscribers and donors). The portal is reached directly over
 * the `edge` docker network via `PAYMENTS_INTERNAL_URL` (compose:
 * http://payments-api-1:5000); when that is unset we fall back to the public
 * `VITE_PAYMENTS_URL`. A short cache keeps a burst of page views to one call,
 * and any error renders an empty list — the portal must never be able to
 * take the marketing site down.
 */
import type { Supporter } from "./types";

const TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 60_000;
const LIMIT = 50;

let cached: { items: Supporter[]; at: number } | null = null;

function paymentsBase(): string | null {
  const internal = process.env.PAYMENTS_INTERNAL_URL;
  if (internal) return internal.replace(/\/$/, "");
  const pub = import.meta.env.VITE_PAYMENTS_URL || "https://payments.3m4.net";
  if (/^https?:\/\//.test(pub)) return pub.replace(/\/$/, "");
  return null;
}

export async function fetchSupporters(app = "exp"): Promise<Supporter[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.items;
  const base = paymentsBase();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/public/supporters?app=${encodeURIComponent(app)}&limit=${LIMIT}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`supporters ${res.status}`);
    const data = (await res.json()) as { items?: Supporter[] };
    const items = Array.isArray(data.items) ? data.items : [];
    cached = { items, at: Date.now() };
    return items;
  } catch {
    return cached?.items ?? [];
  }
}
