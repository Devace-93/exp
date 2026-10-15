import { test, expect } from "@playwright/test";
import { registerAccount, seedSession } from "../helpers";

/**
 * Theme toggle and language picker: the same controls and options as the
 * other 3m4 apps. Preferences persist in localStorage under the shared keys
 * `3m4.theme` / `3m4.lang`, on the marketing site and in the dashboard.
 */
test.describe("shared chrome: theme, language", () => {
  test("@critical theme toggle switches to dark and persists", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("header nav button[data-theme-toggle]").first();
    await expect(toggle).toHaveText("🌙"); // light by default in the test browser
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toHaveText("☀️");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(11, 18, 32)");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("3m4.theme"))).toBe("dark");

    // The auth pages honour the same preference (and carry the same toggle).
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("header button[data-theme-toggle]")).toHaveText("☀️");

    await page.locator("header button[data-theme-toggle]").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => localStorage.getItem("3m4.theme"))).toBe("light");
  });

  test("@critical language picker lists the shared locales, switches to Spanish and persists", async ({ page }) => {
    await page.goto("/");
    const picker = page.locator("header nav [data-lang-picker]").first();
    await expect(picker.getByRole("button", { name: "Language" })).toContainText("English (US)");
    await picker.getByRole("button", { name: "Language" }).click();
    const options = picker.getByRole("option");
    await expect(options).toHaveCount(34); // same list as info.3m4.net / 3m4 / bubbles
    await picker.getByRole("searchbox").fill("mex");
    await expect(options).toHaveCount(1);
    await options.first().click();

    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
    await expect(picker.getByRole("button", { name: /idioma|language/i })).toContainText("Español (México)");
    expect(await page.evaluate(() => localStorage.getItem("3m4.lang"))).toBe("es-MX");
    // Strings switch: the nav login link is translated.
    await expect(page.getByRole("banner").getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Feature flags para");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
    await expect(page.getByRole("banner").getByRole("link", { name: "Iniciar sesión" })).toBeVisible();

    // The login page follows too.
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Iniciar sesión" })).toBeVisible();

    // Arabic flips the document direction.
    await page.evaluate(() => localStorage.setItem("3m4.lang", "ar-SA"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("dashboard nav carries the same theme toggle and language picker", async ({ page, request }) => {
    const account = await registerAccount(request);
    await seedSession(page, account);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    const nav = page.getByRole("banner");
    await expect(nav.locator("[data-lang-picker]")).toBeVisible();
    await nav.locator("button[data-theme-toggle]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("3m4.theme"))).toBe("dark");
  });
});
