import { POSTS } from "../content/posts";

/**
 * /sitemap.xml: the public pages search engines should know about. The
 * dashboard, login and signup are left out (robots.txt disallows them).
 * Add a public page here when its route is added; blog posts are picked up
 * from content/posts.ts.
 */
const ORIGIN = (import.meta.env.VITE_APP_URL || "https://exp.3m4.net").replace(/\/$/, "");
const PAGES = ["/", "/info/", "/info/docs/", "/info/pricing/", "/blog/", "/sponsors/"];

export function sitemapXml(): string {
  const paths = [...PAGES, ...POSTS.map((post) => `/blog/${post.slug}/`)];
  const urls = paths.map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
