/**
 * Warm the SSR server before the suite: the first requests after a container
 * (re)build are slow enough to race the sign-up flow. One GET per entry page.
 */
import { BASE_URL } from "./playwright.config";

export default async function globalSetup(): Promise<void> {
  for (const path of ["/", "/signup/", "/login/", "/dashboard/"]) {
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
