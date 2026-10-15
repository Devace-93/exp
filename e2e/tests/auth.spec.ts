import { test, expect } from "@playwright/test";
import {
  ACCESS_KEY,
  API_URL,
  PASSWORD,
  REFRESH_KEY,
  jwtHeaders,
  registerAccount,
  seedSession,
  uniqueEmail,
} from "../helpers";

/**
 * Sign-up → dashboard → marketing nav reflects the session → log out from the
 * dashboard nav → dashboard guard → log in again. Token refresh through the
 * API and transparently from the app. One account per test.
 */
test.describe("auth + session", () => {
  test("@critical sign up through the UI, keep the session, log out, log in", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByText("Early access: full access, free.")).toBeVisible();
    await page.getByLabel("Workspace name").fill("E2E workspace");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page.getByText("E2E workspace")).toBeVisible();
    await expect(page.getByText("No projects yet.")).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), ACCESS_KEY)).toBeTruthy();
    expect(await page.evaluate((k) => localStorage.getItem(k), REFRESH_KEY)).toBeTruthy();

    // Marketing nav resolves the session client-side on every page.
    const authBox = page.getByRole("banner").locator("[data-auth-state]");
    for (const path of ["/", "/blog", "/info/docs"]) {
      await page.goto(path);
      await expect(authBox).toHaveAttribute("data-auth-state", "true");
      await expect(authBox.getByRole("link", { name: "Dashboard" })).toBeVisible();
      await expect(authBox.getByRole("link", { name: "Log in" })).toHaveCount(0);
    }

    // /login and /signup bounce a signed-in visitor to the dashboard.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard\/?$/);

    // Log out from the dashboard nav.
    await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login\/?$/);
    expect(await page.evaluate((k) => localStorage.getItem(k), ACCESS_KEY)).toBeNull();
    expect(await page.evaluate((k) => localStorage.getItem(k), REFRESH_KEY)).toBeNull();

    // Dashboard is now guarded.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\/?$/);

    // Log in again.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  });

  test("login rejects a wrong password", async ({ page, request }) => {
    const account = await registerAccount(request);
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(page).toHaveURL(/\/login\/?$/);
    await expect(page.locator("form").getByText(/invalid|incorrect|wrong|failed/i)).toBeVisible();
  });

  test("@critical refresh issues a new access token; logout revokes the refresh token", async ({ request }) => {
    const account = await registerAccount(request);

    const refreshed = await request.post(`${API_URL}/auth/refresh`, {
      data: { refresh_token: account.refreshToken },
    });
    expect(refreshed.status(), await refreshed.text()).toBe(200);
    const { access_token } = await refreshed.json();
    expect(typeof access_token).toBe("string");
    const me = await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${access_token}` } });
    expect(me.status()).toBe(200);
    expect((await me.json()).account.id).toBe(account.accountId);

    const logout = await request.post(`${API_URL}/auth/logout`, {
      data: { refresh_token: account.refreshToken },
    });
    expect(logout.status()).toBe(204);

    const again = await request.post(`${API_URL}/auth/refresh`, {
      data: { refresh_token: account.refreshToken },
    });
    expect(again.status()).toBe(401);
  });

  test("dashboard transparently refreshes an expired access token", async ({ page, request }) => {
    const account = await registerAccount(request);
    // A valid refresh token but a garbage access token: the API answers 401,
    // the client refreshes once and retries.
    await seedSession(page, { ...account, accessToken: "not-a-valid-jwt" });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page.getByText("No projects yet.")).toBeVisible();
    const stored = await page.evaluate((k) => localStorage.getItem(k), ACCESS_KEY);
    expect(stored).not.toBe("not-a-valid-jwt");
    const me = await request.get(`${API_URL}/auth/me`, { headers: jwtHeaders({ accessToken: stored! }) });
    expect(me.status()).toBe(200);
  });
});
