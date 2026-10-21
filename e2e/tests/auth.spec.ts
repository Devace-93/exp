import { test, expect } from "@playwright/test";
import { ACCOUNTS_URL, API_URL, registerAccount, seedSession } from "../helpers";

/**
 * Identity lives at accounts.3m4.net: this app only recognises its session.
 * These tests cover the hand-offs — the redirects to the hosted pages, the
 * dashboard guard, the marketing nav reflecting the shared session, and a
 * logout that revokes it everywhere.
 */
test.describe("auth + session", () => {
  test("@critical /login and /signup hand off to accounts with return_to", async ({ page }) => {
    const login = await page.request.get("/login", { maxRedirects: 0 });
    expect(login.status()).toBe(302);
    const loginTarget = new URL(login.headers()["location"]);
    expect(loginTarget.origin + loginTarget.pathname).toBe(`${ACCOUNTS_URL}/login`);
    expect(loginTarget.searchParams.get("return_to")).toMatch(/\/dashboard$/);

    const signup = await page.request.get("/signup?return_to=https://evil.example/", { maxRedirects: 0 });
    expect(signup.status()).toBe(302);
    const signupTarget = new URL(signup.headers()["location"]);
    expect(signupTarget.pathname).toBe("/signup");
    // Foreign return targets are replaced by our dashboard.
    expect(signupTarget.searchParams.get("return_to")).toMatch(/\/dashboard$/);
  });

  test("the dashboard sends a signed-out visitor to the accounts login page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`^${ACCOUNTS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/login`));
    expect(new URL(page.url()).searchParams.get("return_to")).toContain("/dashboard");
  });

  test("@critical a shared session: dashboard, marketing nav, profile link, logout everywhere", async ({ page, request }) => {
    const account = await registerAccount(request);
    await seedSession(page, account);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    // Identity in the nav links to the accounts profile.
    const profile = page.getByTestId("nav-profile");
    await expect(profile).toContainText(`@${account.handle}`);
    await expect(profile).toHaveAttribute("href", new RegExp(`^${ACCOUNTS_URL}/profile`));
    await expect(page.getByTestId("unverified-banner")).toHaveCount(0);

    // Marketing nav resolves the shared session client-side on every page.
    const authBox = page.getByRole("banner").locator("[data-auth-state]");
    for (const path of ["/", "/blog", "/info/docs"]) {
      await page.goto(path);
      await expect(authBox).toHaveAttribute("data-auth-state", "true");
      await expect(authBox.getByRole("link", { name: "Dashboard" })).toBeVisible();
      await expect(authBox.getByRole("button", { name: "Log out" })).toBeVisible();
      await expect(authBox.getByRole("link", { name: "Log in" })).toHaveCount(0);
    }

    // Log out from the marketing nav: the session is revoked at accounts, so
    // the API no longer accepts the cookie either.
    await authBox.getByRole("button", { name: "Log out" }).click();
    await expect(authBox).toHaveAttribute("data-auth-state", "false");
    await expect(authBox.getByRole("link", { name: "Log in" })).toBeVisible();
    const me = await page.request.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(401);

    // Dashboard is guarded again.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`^${ACCOUNTS_URL}/login`));
  });

  test("an unverified identity sees the banner and cannot create projects", async ({ page, request, browser }) => {
    // Sign up but do NOT verify.
    const email = `unverified+${Date.now()}@example.com`;
    const ctx = await browser.newContext();
    try {
      const signup = await ctx.request.post(`${ACCOUNTS_URL}/api/auth/signup`, {
        data: { email, password: "E2e-Passw0rd!" },
      });
      expect(signup.status()).toBe(201);
      const me = await ctx.request.get(`${API_URL}/auth/me`);
      expect(me.status(), await me.text()).toBe(200);
      expect((await me.json()).user.email_verified).toBe(false);

      const create = await ctx.request.post(`${API_URL}/projects`, { data: { name: "Unverified project" } });
      expect(create.status()).toBe(403);
      expect((await create.json()).error.code).toBe("email_unverified");

      const state = await ctx.request.storageState();
      await page.context().addCookies(state.cookies.filter((c) => c.name.startsWith("3m4_")));
      await page.goto("/dashboard");
      await expect(page.getByTestId("unverified-banner")).toContainText(email);
      await expect(page.getByTestId("resend-verification")).toHaveAttribute("href", new RegExp(`^${ACCOUNTS_URL}/verify`));
    } finally {
      await ctx.close();
    }
    void request;
  });
});
