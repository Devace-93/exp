import { test, expect } from "@playwright/test";

/** /sitemap.xml lists the public pages and the blog posts (apps/web/src/lib/sitemap.ts). */
test("sitemap.xml lists the public pages", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("xml");
  const xml = await res.text();
  expect(xml).toContain("<urlset");
  for (const path of ["/", "/info/", "/info/docs/", "/info/pricing/", "/blog/", "/sponsors/"]) {
    expect(xml).toMatch(new RegExp(`<loc>https?://[^/<]+${path}</loc>`));
  }
  expect(xml).toMatch(/<loc>[^<]+\/blog\/[a-z0-9-]+\/<\/loc>/);
  expect(xml).not.toContain("/dashboard");
});
