/**
 * Scripted product demo: drives the running local stack with Playwright,
 * records a video (Playwright's built-in recorder, webm) and captures
 * captioned still frames. `make-gif.py` turns the frames into docs/demo.gif;
 * the webm is written next to them as demo.webm (convert with ffmpeg if you
 * need mp4).
 *
 *   cd e2e && bun run scripts/record-demo.ts [outDir]
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8081";
const OUT = process.argv[2] ?? join(import.meta.dir, "..", "demo-frames");
mkdirSync(OUT, { recursive: true });

const frames: { file: string; hold: number }[] = [];
let n = 0;

async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      Object.assign(el.style, {
        position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "99999",
        padding: "14px 24px", background: "rgba(46,16,101,.92)", color: "#fff",
        font: "600 20px/1.3 system-ui, sans-serif", textAlign: "center",
        letterSpacing: ".01em",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

/**
 * Capture one frame; `hold` is how long the GIF shows it (ms). The video
 * keeps rolling, so we also pause for `hold` to give viewers time to read.
 */
async function shot(page: Page, text: string, hold = 1600) {
  await caption(page, text);
  await page.waitForTimeout(250);
  const file = join(OUT, `frame-${String(n++).padStart(3, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, hold });
  await page.waitForTimeout(hold);
}

async function typeInto(page: Page, selector: string, value: string, text: string) {
  await page.fill(selector, "");
  await page.locator(selector).pressSequentially(value, { delay: 35 });
  await shot(page, text, 900);
}

/** Set a native <input type=range> and fire the input event Qwik listens to. */
async function setRange(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
const ts = Date.now().toString(36);
const email = `demo+${ts}@example.com`;
const password = "Demo-Passw0rd!";

// 1. Landing
await page.goto(`${BASE}/`);
await page.waitForSelector("text=Feature flags for");
await shot(page, "exp: open-source feature flags for projects, people and AI agents", 2200);

// 2. Sign up
await page.goto(`${BASE}/signup`);
await page.waitForSelector("input[type=email]");
await typeInto(page, "input[type=email]", email, "Sign up. Early access: every account gets full access, free");
await page.fill("input[type=password]", password);
await page.locator("button[type=submit]").click();
await page.waitForURL(/\/dashboard/);
await page.waitForSelector("text=New project");
await shot(page, "The dashboard: projects, usage, no plans to pick", 1600);

// 3. Create a project → keys step
await page.getByRole("button", { name: "New project" }).click();
await page.waitForSelector("#pname");
await typeInto(page, "#pname", "Web app", "Create a project — the key is slugged from the name…");
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForSelector("[data-testid=project-keys-step]");
await shot(page, "…and you get three environments, each with a one-time client key", 2600);
await page.getByRole("link", { name: "Go to project" }).click();
await page.waitForSelector("text=New flag");
const projectId = page.url().match(/projects\/([0-9a-f-]{36})/)![1];

// 4. Create flags
await page.getByRole("button", { name: "New flag" }).click();
await page.waitForSelector("#fkey");
await typeInto(page, "#fkey", "new-checkout", "Add a boolean flag…");
await page.getByRole("button", { name: "Create flag" }).click();
await page.waitForSelector("text=new-checkout");
await page.getByRole("button", { name: "New flag" }).click();
await page.waitForSelector("#fkey");
await page.fill("#fkey", "banner-text");
await page.selectOption("#fkind", "string");
await page.fill("#fdefault", "Spring sale");
await shot(page, "…and a string flag with a default value (number and JSON too)", 1500);
await page.getByRole("button", { name: "Create flag" }).click();
await page.waitForSelector("text=banner-text");

// 5. Toggle per environment
await page.getByRole("switch", { name: "new-checkout in production" }).click();
await page.waitForTimeout(400);
await page.getByRole("switch", { name: "banner-text in staging" }).click();
await page.waitForTimeout(400);
await shot(page, "Flip a flag per environment: one click, one audited PUT", 2200);

// 6. Flag editor: rollout + preview
await page.getByRole("link", { name: "new-checkout" }).click();
await page.waitForSelector("#r-staging");
await page.getByRole("switch", { name: "new-checkout in staging" }).click();
await setRange(page, "#r-staging", 25);
await page.getByRole("button", { name: "Save staging" }).click();
await page.waitForSelector("text=Saved.");
await shot(page, "Roll out to 25% of users in staging: deterministic sha256 buckets", 2200);
await page.locator("#penv").selectOption("staging");
await page.fill("#pdid", "user-42");
await page.getByRole("button", { name: "Preview", exact: true }).click();
await page.waitForSelector("text=Result");
await page.locator("text=Preview evaluation").scrollIntoViewIfNeeded();
await shot(page, "Preview what the evaluation API answers for a user, not metered", 2200);

// 7. Copy flags to a second project (created through the API to keep the demo short)
const token = await page.evaluate(() => localStorage.getItem("exp_access_token"));
await page.request.post(`${BASE}/api/projects`, {
  headers: { Authorization: `Bearer ${token}` },
  data: { name: "Mobile app" },
});
await page.goto(`${BASE}/dashboard/projects/${projectId}`);
await page.waitForSelector("text=Copy flags…");
await page.getByRole("button", { name: "Copy flags…" }).click();
await page.waitForSelector("#ctarget");
await shot(page, "Copy flags into another project, with or without their states", 1800);
await page.getByRole("button", { name: "Copy flags", exact: true }).click();
await page.waitForSelector("text=Copy finished");
await shot(page, "One transaction; conflicts are skipped or overwritten, your call", 2200);

// 8. API keys with roles
await page.goto(`${BASE}/dashboard/settings`);
await page.waitForSelector("#keyname");
await typeInto(page, "#keyname", "claude-code", "API keys carry a role: viewer, editor or admin");
await page.selectOption("#keyrole", "editor");
await page.waitForTimeout(200);
await page.locator("button[type=submit]:has-text('Create key')").click();
await page.waitForSelector("text=Copy your new key now");
await shot(page, "The secret is shown once. Roles are enforced by the API and mirrored by the MCP server", 2600);

// 9. Back to the MCP pitch
await page.goto(`${BASE}/#mcp`);
await page.locator("#mcp").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot(page, "claude mcp add exp … then: “turn on new-checkout in staging for 10% of users”", 3000);

const video = page.video();
await ctx.close();
await browser.close();
if (video) {
  const recorded = await video.path();
  renameSync(recorded, join(OUT, "demo.webm"));
}
writeFileSync(join(OUT, "frames.json"), JSON.stringify(frames, null, 2));
console.log(`captured ${frames.length} frames${video ? " + demo.webm" : ""} in ${OUT}`);
