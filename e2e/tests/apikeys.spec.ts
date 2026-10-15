import { test, expect, type Page } from "@playwright/test";
import {
  API_URL,
  ROLE_SCOPES,
  keyHeaders,
  registerAccount,
  seedSession,
  type Account,
  type Role,
} from "../helpers";

/**
 * Role-scoped API keys: the public roles endpoint, keys created in
 * /dashboard/settings, scope enforcement (403 insufficient_scope), audit log
 * (API + UI table) and revocation.
 */
test.describe("API keys + RBAC", () => {
  let account: Account;
  const secrets: Partial<Record<Role, string>> = {};
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    account = await registerAccount(request);
  });

  async function createKeyViaUi(page: Page, name: string, role: Role): Promise<string> {
    await page.goto("/dashboard/settings");
    await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
    await page.getByLabel("New key name").fill(name);
    await page.locator("#keyrole").selectOption(role);
    // The role description + scopes follow the picker.
    await expect(page.getByText(`(${ROLE_SCOPES[role].join(", ")})`)).toBeVisible();
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText("Copy your new key now")).toBeVisible();
    const secret = (await page.locator("code", { hasText: /^exp_live_/ }).first().textContent())!.trim();
    expect(secret).toMatch(/^exp_live_[A-Za-z0-9_-]+$/);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(role === "viewer" ? "Viewer" : role === "admin" ? "Admin" : "Editor");
    await expect(row).toContainText("Never");
    return secret;
  }

  test("GET /apikeys/roles is public and matches the shared registry", async ({ request }) => {
    const res = await request.get(`${API_URL}/apikeys/roles`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.default_role).toBe("editor");
    expect(Object.keys(body.roles).sort()).toEqual(["admin", "editor", "viewer"]);
    for (const role of ["viewer", "editor", "admin"] as Role[]) {
      expect(body.roles[role].scopes.sort()).toEqual([...ROLE_SCOPES[role]].sort());
      expect(body.roles[role].label).toBe(role[0].toUpperCase() + role.slice(1));
    }
    const bad = await request.post(`${API_URL}/apikeys`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      data: { name: "bad", role: "owner" },
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_role");
  });

  test("@critical create keys of each role in settings; the API enforces scopes", async ({ page, request }) => {
    await seedSession(page, account);
    secrets.viewer = await createKeyViaUi(page, "e2e viewer", "viewer");
    secrets.editor = await createKeyViaUi(page, "e2e editor", "editor");
    secrets.admin = await createKeyViaUi(page, "e2e admin", "admin");
    expect(new Set(Object.values(secrets)).size).toBe(3);

    // viewer: cannot write.
    const denied = await request.post(`${API_URL}/projects`, {
      headers: keyHeaders(secrets.viewer),
      data: { name: "Denied" },
    });
    expect(denied.status()).toBe(403);
    const deniedBody = await denied.json();
    expect(deniedBody.error.code).toBe("insufficient_scope");
    expect(deniedBody.error.required_scope).toBe("projects:write");
    expect(deniedBody.error.role).toBe("viewer");

    // viewer: can read.
    expect((await request.get(`${API_URL}/projects`, { headers: keyHeaders(secrets.viewer) })).status()).toBe(200);
    expect((await request.get(`${API_URL}/account/usage`, { headers: keyHeaders(secrets.viewer) })).status()).toBe(200);

    // editor: can create, cannot delete.
    const created = await request.post(`${API_URL}/projects`, {
      headers: keyHeaders(secrets.editor),
      data: { name: "Keyed project" },
    });
    expect(created.status(), await created.text()).toBe(201);
    projectId = (await created.json()).id;
    const flag = await request.post(`${API_URL}/projects/${projectId}/flags`, {
      headers: keyHeaders(secrets.editor),
      data: { key: "by-editor" },
    });
    expect(flag.status()).toBe(201);
    const editorDelete = await request.delete(`${API_URL}/projects/${projectId}`, { headers: keyHeaders(secrets.editor) });
    expect(editorDelete.status()).toBe(403);
    expect((await editorDelete.json()).error.required_scope).toBe("projects:delete");
    const editorFlagDelete = await request.delete(`${API_URL}/projects/${projectId}/flags/by-editor`, {
      headers: keyHeaders(secrets.editor),
    });
    expect(editorFlagDelete.status()).toBe(403);
    expect((await editorFlagDelete.json()).error.required_scope).toBe("flags:delete");

    // admin: can delete.
    const flagDelete = await request.delete(`${API_URL}/projects/${projectId}/flags/by-editor`, {
      headers: keyHeaders(secrets.admin),
    });
    expect(flagDelete.status()).toBe(204);
    const projectDelete = await request.delete(`${API_URL}/projects/${projectId}`, { headers: keyHeaders(secrets.admin) });
    expect(projectDelete.status()).toBe(204);

    // /apikeys/me reports role + scopes for each key.
    for (const role of ["viewer", "editor", "admin"] as Role[]) {
      const me = await (await request.get(`${API_URL}/apikeys/me`, { headers: keyHeaders(secrets[role]!) })).json();
      expect(me.key.role).toBe(role);
      expect(me.scopes.sort()).toEqual([...ROLE_SCOPES[role]].sort());
      expect(me.account.id).toBe(account.accountId);
    }

    // Keys are listed with last_used_at once used.
    const keys = await (await request.get(`${API_URL}/apikeys`, { headers: { Authorization: `Bearer ${account.accessToken}` } })).json();
    expect(keys).toHaveLength(3);
    for (const k of keys) {
      expect(k.prefix).toMatch(/^exp_live_/);
      expect(secrets[k.role as Role]!.startsWith(k.prefix)).toBe(true);
      expect(k.last_used_at).toBeTruthy();
    }
  });

  test("@critical audit log records denials and mutations (API + UI table)", async ({ page, request }) => {
    // Admin scope audit:read; viewer and editor cannot read it.
    for (const role of ["viewer", "editor"] as Role[]) {
      const res = await request.get(`${API_URL}/account/audit`, { headers: keyHeaders(secrets[role]!) });
      expect(res.status(), role).toBe(403);
    }
    const audit = await request.get(`${API_URL}/account/audit?limit=50`, { headers: keyHeaders(secrets.admin!) });
    expect(audit.status()).toBe(200);
    const events: Array<{ action: string; outcome: string; actor_type: string; target_id?: string; meta?: any }> = (
      await audit.json()
    ).items;
    const denied = events.filter((e) => e.action === "auth.denied");
    expect(denied.length).toBeGreaterThanOrEqual(3);
    expect(denied[0].outcome).toBe("denied");
    expect(denied[0].actor_type).toBe("api_key");
    const created = events.find((e) => e.action === "project.create" && e.target_id === projectId);
    expect(created, JSON.stringify(events)).toBeTruthy();
    expect(created!.outcome).toBe("ok");
    expect(events.find((e) => e.action === "project.delete" && e.target_id === projectId)).toBeTruthy();
    expect(events.filter((e) => e.action === "apikey.create")).toHaveLength(3);

    // Filter by action.
    const filtered = await (
      await request.get(`${API_URL}/account/audit?limit=50&action=auth.denied`, { headers: keyHeaders(secrets.admin!) })
    ).json();
    expect(filtered.items.length).toBeGreaterThanOrEqual(3);
    expect(filtered.items.every((e: { action: string }) => e.action === "auth.denied")).toBe(true);

    // UI table on /dashboard/settings.
    await seedSession(page, account);
    await page.goto("/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    const table = page.getByRole("table").nth(1);
    await expect(table.getByRole("cell", { name: "auth.denied" }).first()).toBeVisible();
    await expect(table.getByRole("cell", { name: "project.create" }).first()).toBeVisible();
    await expect(table.getByRole("cell", { name: "apikey.create" }).first()).toBeVisible();
    await expect(table.getByText("denied", { exact: true }).first()).toBeVisible();

    await page.locator("#auditaction").selectOption("project.delete");
    await expect(table.getByRole("cell", { name: "project.delete" })).toHaveCount(1);
    await expect(table.getByRole("cell", { name: "auth.denied" })).toHaveCount(0);
  });

  test("@critical revoked key stops working", async ({ page, request }) => {
    await seedSession(page, account);
    const secret = await createKeyViaUi(page, "e2e revoke-me", "viewer");
    expect((await request.get(`${API_URL}/apikeys/me`, { headers: keyHeaders(secret) })).status()).toBe(200);
    page.once("dialog", (d) => d.accept());
    const row = page.getByRole("row").filter({ hasText: "e2e revoke-me" });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toHaveCount(0);
    expect((await request.get(`${API_URL}/apikeys/me`, { headers: keyHeaders(secret) })).status()).toBe(401);
    expect((await request.get(`${API_URL}/projects`, { headers: keyHeaders(secret) })).status()).toBe(401);

    const audit = await (
      await request.get(`${API_URL}/account/audit?limit=5&action=apikey.revoke`, { headers: keyHeaders(secrets.admin!) })
    ).json();
    expect(audit.items).toHaveLength(1);
  });
});
