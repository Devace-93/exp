/**
 * Warm the SSR server before the suite: the first requests after a container
 * (re)build are slow enough to race the first dashboard load. One GET per entry
 * page (/login and /signup are redirects to accounts now).
 */
import { BASE_URL } from "./playwright.config";

export default async function globalSetup(): Promise<void> {
  for (const path of ["/", "/dashboard/"]) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch(BASE_URL + path);
        if (res.ok) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
