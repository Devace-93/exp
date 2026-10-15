import { test, expect } from "@playwright/test";

/**
 * Public marketing site with the current feature set (early-access=ON):
 * landing, info index, pricing (planned), docs, blog, sponsors; footer links.
 */
test.describe("marketing site", () => {
  test("@critical home renders hero, MCP section with snippets and early-access notes", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Feature flags for projects, people and AI agents/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started free" }).first()).toHaveAttribute("href", /\/signup/);
    await expect(page.getByRole("link", { name: "Why it's free right now" })).toHaveAttribute(
      "href",
      /\/blog\/what-paid-plans-will-include/,
    );
    await expect(page.getByTestId("hero-plan-note")).toContainText("Early access");
    await expect(page.getByTestId("early-access-note")).toContainText("Early access.");

    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A tiny evaluation API" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Copy flags between projects" })).toBeVisible();

    const mcp = page.locator("#mcp");
    await expect(mcp.getByRole("heading", { name: "Let your AI agent manage flags" })).toBeVisible();
    await expect(mcp.locator("code", { hasText: "claude mcp add exp --scope user" })).toBeVisible();
    await expect(mcp.locator("code", { hasText: "claude mcp add --transport http exp" })).toContainText("/mcp");
    await expect(mcp.locator("code", { hasText: '"mcpServers"' })).toContainText("exp-mcp");
    await expect(mcp.getByText("Role-scoped keys.")).toBeVisible();
    await expect(mcp.getByText("Human in the loop.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Self-host it (MIT, open source)" })).toBeVisible();
  });

  test("nav hides Pricing while early access is on", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("banner").getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Docs" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Blog" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sponsors" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Pricing" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Sign up free" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Log in" })).toBeVisible();
  });

  test("/info, /info/pricing (planned), /info/docs", async ({ page }) => {
    await page.goto("/info");
    await expect(page.getByRole("heading", { level: 1, name: "Info" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Planned pricing/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Docs/ }).first()).toBeVisible();

    await page.goto("/info/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "Planned pricing" })).toBeVisible();
    await expect(page.getByTestId("early-access-pricing")).toContainText("Right now every account has full access, free.");
    await expect(page.getByText("None of this is enforced during early access.")).toBeVisible();

    await page.goto("/info/docs");
    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
    await expect(page.locator("code", { hasText: /\/api$/ }).first()).toBeVisible();
    for (const h of ["Authentication", "Projects & environments", "Flags", "Evaluation semantics", "Errors & limits", "MCP (AI agents)"]) {
      await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("cell", { name: "/eval/flags?distinct_id=" })).toBeVisible();
  });

  test("blog lists the early-access post and renders it", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
    const post = page.getByRole("link", { name: /what paid plans will include/i });
    await expect(post).toBeVisible();
    await post.click();
    await expect(page).toHaveURL(/\/blog\/what-paid-plans-will-include/);
    await expect(page.getByRole("heading", { level: 1, name: /what paid plans will include/i })).toBeVisible();

    await page.goto("/blog/does-not-exist");
    await expect(page.getByRole("heading", { level: 1, name: "Post not found" })).toBeVisible();
  });

  test("/sponsors renders the early-access state", async ({ page }) => {
    await page.goto("/sponsors");
    await expect(page.getByRole("heading", { level: 1, name: "Sponsors" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The supporter badge" })).toBeVisible();
    await expect(page.getByText("Supporter subscriptions open together with paid plans")).toBeVisible();
  });

  test("@critical footer credits the author and links source + apps index on every page", async ({ page }) => {
    for (const path of ["/", "/info/docs", "/blog"]) {
      await page.goto(path);
      const footer = page.getByRole("contentinfo");
      await expect(footer.getByRole("link", { name: "Made by Enrique Magallón" })).toHaveAttribute(
        "href",
        /linkedin\.com\/in\/enrique-magallon/,
      );
      await expect(footer.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://github.com/Devace-93/exp");
      await expect(footer.getByRole("link", { name: "info.3m4.net" })).toHaveAttribute("href", /info\.3m4\.net/);
      await expect(footer.getByRole("link", { name: "Docs" })).toHaveAttribute("href", /\/info\/docs/);
      await expect(footer.getByRole("link", { name: "Pricing" })).toHaveCount(0);
      await expect(footer.getByText("Open source · MIT")).toBeVisible();
    }
  });

  test("/api/features exposes the public switches", async ({ request }) => {
    const res = await request.get("/api/features");
    expect(res.status()).toBe(200);
    const { features } = await res.json();
    expect(features["early-access"]).toBe(true);
    expect(features.signups).toBe(true);
    expect(features["evaluation-api"]).toBe(true);
    expect(features["flag-copy"]).toBe(true);
    expect(features["public-api"]).toBe(true);
  });
});
