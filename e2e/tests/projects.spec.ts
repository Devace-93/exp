import { test, expect } from "@playwright/test";
import {
  API_URL,
  envKeyHeaders,
  jwtHeaders,
  registerAccount,
  seedSession,
  type Account,
  type Environment,
  type Project,
} from "../helpers";

/**
 * Projects through the dashboard: create (name → key slug, one-time keys
 * step), list, settings (environments, key rotation, export, delete).
 * One account per file; the project created in the first test is reused.
 */
test.describe("projects", () => {
  let account: Account;
  let project: Project;
  /** Client keys shown once on the keys step, by environment key. */
  const clientKeys: Record<string, string> = {};

  test.beforeAll(async ({ request }) => {
    account = await registerAccount(request);
  });

  test.beforeEach(async ({ page }) => {
    await seedSession(page, account);
  });

  test("@critical create a project in the dashboard: slug, keys step, go to project", async ({ page, request }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Project name").fill("Web App E2E");
    await expect(dialog.getByLabel("Key")).toHaveValue("web-app-e2e");
    await dialog.getByLabel("Description").fill("Created by the e2e suite");
    await dialog.getByRole("button", { name: "Create project" }).click();

    // Keys step: three environments, each with a one-time exp_env_ key.
    const keysStep = page.getByTestId("project-keys-step");
    await expect(keysStep).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Your environment client keys" })).toBeVisible();
    await expect(keysStep.getByText("Copy these keys now")).toBeVisible();
    const items = keysStep.getByRole("listitem");
    await expect(items).toHaveCount(3);
    for (const envKey of ["production", "staging", "development"]) {
      const item = items.filter({ hasText: envKey });
      await expect(item).toHaveCount(1);
      const secret = (await item.locator("code").textContent())!.trim();
      expect(secret).toMatch(/^exp_env_[A-Za-z0-9_-]+$/);
      clientKeys[envKey] = secret;
    }
    expect(new Set(Object.values(clientKeys)).size).toBe(3);

    await keysStep.getByRole("link", { name: "Go to project" }).click();
    await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]{36}\/?$/);
    await expect(page.getByRole("heading", { level: 1, name: "Web App E2E" })).toBeVisible();
    await expect(page.getByText("No flags yet.")).toBeVisible();
    const id = page.url().match(/projects\/([0-9a-f-]{36})/)![1];

    // API view agrees with the UI.
    const res = await request.get(`${API_URL}/projects/${id}`, { headers: jwtHeaders(account) });
    expect(res.status()).toBe(200);
    project = await res.json();
    expect(project.key).toBe("web-app-e2e");
    expect(project.name).toBe("Web App E2E");
    expect(project.description).toBe("Created by the e2e suite");
    expect(project.environments.map((e) => e.key)).toEqual(["production", "staging", "development"]);
    for (const env of project.environments) {
      expect(env.client_key).toBeUndefined(); // never on GET
      expect(clientKeys[env.key].startsWith(env.client_key_prefix)).toBe(true);
    }

    // The keys evaluate for their own environment only.
    const evalRes = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(clientKeys.staging) });
    expect(evalRes.status(), await evalRes.text()).toBe(200);
    expect((await evalRes.json()).environment.key).toBe("staging");
  });

  test("project list shows the project card and the API lists it newest first", async ({ page, request }) => {
    await page.goto("/dashboard");
    const card = page.getByRole("link", { name: /Web App E2E/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText("web-app-e2e");
    await expect(card).toContainText("0 flags");
    await expect(card).toContainText("3 environments");
    await expect(page.getByText("Projects").first()).toBeVisible();

    const list = await request.get(`${API_URL}/projects`, { headers: jwtHeaders(account) });
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(project.id);
    expect(body.items[0].environments).toHaveLength(3);

    // Search filters client-side.
    await page.getByRole("searchbox", { name: "Search" }).fill("nothing-matches");
    await expect(page.getByText("No project matches your search.")).toBeVisible();

    // Duplicate key is a 409.
    const dup = await request.post(`${API_URL}/projects`, {
      headers: jwtHeaders(account),
      data: { name: "Dup", key: "web-app-e2e" },
    });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("key_taken");
  });

  test("@critical settings: create an environment, rotate a key, export JSON", async ({ page, request }) => {
    await page.goto(`/dashboard/projects/${project.id}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Project settings" })).toBeVisible();
    const envTable = page.getByRole("table").first();
    await expect(envTable.getByRole("row")).toHaveCount(4); // header + 3

    // Create environment "qa".
    await page.getByLabel("Environment key").fill("qa");
    await page.getByLabel("Name", { exact: false }).last().fill("QA");
    await page.getByRole("button", { name: "Create environment" }).click();
    const qaRow = envTable.getByRole("row").filter({ hasText: "qa" });
    await expect(qaRow).toBeVisible();
    await expect(qaRow).toContainText("Copy this client key now");
    const qaKey = (await qaRow.locator("code").textContent())!.trim();
    expect(qaKey).toMatch(/^exp_env_/);
    const qaEval = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(qaKey) });
    expect(qaEval.status()).toBe(200);
    expect((await qaEval.json()).environment.key).toBe("qa");

    // Rotate the production key: a new key is revealed, the old one stops working.
    page.once("dialog", (d) => d.accept());
    const prodRow = envTable.getByRole("row").filter({ hasText: "production" });
    await prodRow.getByRole("button", { name: "Rotate key" }).click();
    await expect(prodRow).toContainText("Copy this client key now");
    const rotated = (await prodRow.locator("code").textContent())!.trim();
    expect(rotated).toMatch(/^exp_env_/);
    expect(rotated).not.toBe(clientKeys.production);
    const oldKey = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(clientKeys.production) });
    expect(oldKey.status()).toBe(401);
    const newKey = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(rotated) });
    expect(newKey.status()).toBe(200);
    clientKeys.production = rotated;

    // The prefix in the row matches the new key.
    const envs: Environment[] = await (
      await request.get(`${API_URL}/projects/${project.id}/environments`, { headers: jwtHeaders(account) })
    ).json();
    expect(envs.map((e) => e.key)).toEqual(["production", "staging", "development", "qa"]);
    expect(rotated.startsWith(envs[0].client_key_prefix)).toBe(true);

    // Export downloads exp.project.v1 JSON.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("web-app-e2e.exp.json");
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(exported.format).toBe("exp.project.v1");
    expect(exported.project.key).toBe("web-app-e2e");
    expect(exported.environments.map((e: { key: string }) => e.key)).toEqual([
      "production",
      "staging",
      "development",
      "qa",
    ]);
    expect(exported.flags).toEqual([]);
  });

  test("settings: the last environment cannot be deleted; others can", async ({ request }) => {
    const envs: Environment[] = await (
      await request.get(`${API_URL}/projects/${project.id}/environments`, { headers: jwtHeaders(account) })
    ).json();
    const qa = envs.find((e) => e.key === "qa")!;
    const del = await request.delete(`${API_URL}/projects/${project.id}/environments/${qa.id}`, {
      headers: jwtHeaders(account),
    });
    expect(del.status()).toBe(204);

    const solo = await request.post(`${API_URL}/projects`, {
      headers: jwtHeaders(account),
      data: { name: "Solo" },
    });
    const soloProject: Project = await solo.json();
    for (const env of soloProject.environments.slice(1)) {
      expect(
        (await request.delete(`${API_URL}/projects/${soloProject.id}/environments/${env.id}`, { headers: jwtHeaders(account) })).status(),
      ).toBe(204);
    }
    const last = await request.delete(
      `${API_URL}/projects/${soloProject.id}/environments/${soloProject.environments[0].id}`,
      { headers: jwtHeaders(account) },
    );
    expect(last.status()).toBe(400);
    expect((await last.json()).error.code).toBe("last_environment");
    await request.delete(`${API_URL}/projects/${soloProject.id}`, { headers: jwtHeaders(account) });
  });

  test("@critical delete the project from the danger zone", async ({ page, request }) => {
    await page.goto(`/dashboard/projects/${project.id}/settings`);
    const deleteButton = page.getByRole("button", { name: "Delete project" });
    await expect(deleteButton).toBeDisabled();
    await page.getByLabel("Type the project key to confirm").fill(project.key);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(page.getByText("No projects yet.")).toBeVisible();

    const gone = await request.get(`${API_URL}/projects/${project.id}`, { headers: jwtHeaders(account) });
    expect(gone.status()).toBe(404);
    // Cascade: the environment keys are dead.
    const evalRes = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(clientKeys.production) });
    expect(evalRes.status()).toBe(401);
  });
});
