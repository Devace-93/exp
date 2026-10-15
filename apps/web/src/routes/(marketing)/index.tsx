import { component$, useContext } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { FeaturesContext } from "../../lib/features";
import { tr, useI18n } from "../../i18n";
import { PLANS, fmtLimit } from "../../lib/plans";

const APP_URL = (import.meta.env.VITE_APP_URL || "https://exp.3m4.net").replace(/\/$/, "");
const GITHUB_URL = "https://github.com/Devace-93/exp";
const MCP_NPM_URL = "https://www.npmjs.com/package/exp-mcp";
const MCP_SNIPPET = "claude mcp add exp --scope user --env EXP_API_KEY=exp_live_… -- npx -y exp-mcp";
const MCP_REMOTE_SNIPPET = `claude mcp add --transport http exp ${APP_URL}/mcp --header "Authorization: Bearer exp_live_…"`;
const CURL_SNIPPET = `curl "${APP_URL}/api/eval/flags?distinct_id=user-42" \\
  -H "X-Environment-Key: exp_env_…"`;
const CURL_RESPONSE = `{
  "environment": { "key": "production" },
  "distinct_id": "user-42",
  "flags": {
    "new-checkout": { "kind": "boolean", "enabled": true,  "value": true },
    "banner-text":  { "kind": "string",  "enabled": true,  "value": "Spring sale" },
    "max-items":    { "kind": "number",  "enabled": false, "value": null }
  }
}`;

export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const early = features["early-access"];
  const steps = [
    { title: tr(i18n, "landing.step1Title"), body: tr(i18n, "landing.step1Body") },
    { title: tr(i18n, "landing.step2Title"), body: tr(i18n, "landing.step2Body") },
    { title: tr(i18n, "landing.step3Title"), body: tr(i18n, "landing.step3Body") },
  ];
  return (
    <>
      {/* Hero */}
      <section class="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-primary-50 to-white">
        <div class="mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <span class="badge mb-5 bg-primary-100 text-primary-700">
            {tr(i18n, "landing.badge")}
          </span>
          <h1 class="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            {tr(i18n, "landing.heroTitle")}{" "}
            <span class="text-primary-600">{tr(i18n, "landing.heroTitleAccent")}</span>
          </h1>
          <p class="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            {tr(i18n, "landing.heroBody")}
          </p>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
            {features.signups ? (
              <Link href="/signup" class="btn-primary px-6 py-3 text-base">
                {tr(i18n, "landing.getStarted")}
              </Link>
            ) : (
              <Link href="/login" class="btn-primary px-6 py-3 text-base">
                {tr(i18n, "nav.login")}
              </Link>
            )}
            {early ? (
              <Link
                href="/blog/what-paid-plans-will-include"
                class="btn-secondary px-6 py-3 text-base"
              >
                {tr(i18n, "landing.whyFree")}
              </Link>
            ) : (
              <Link
                href="/info/pricing"
                class="btn-secondary px-6 py-3 text-base"
              >
                {tr(i18n, "landing.seePricing")}
              </Link>
            )}
          </div>
          <p class="mt-4 text-sm text-slate-500" data-testid="hero-plan-note">
            {early
              ? tr(i18n, "landing.earlyNote")
              : tr(i18n, "landing.freeNote", {
                  projects: fmtLimit(PLANS.free.projects, i18n),
                  flags: fmtLimit(PLANS.free.flags_per_project, i18n),
                  evals: fmtLimit(PLANS.free.evaluations_per_month, i18n),
                })}
          </p>
        </div>
      </section>

      {/* How it works */}
      <section class="mx-auto max-w-6xl px-4 py-16">
        <h2 class="text-center text-3xl font-bold text-slate-900">
          {tr(i18n, "landing.howTitle")}
        </h2>
        <div class="mt-10 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.title} class="card p-6">
              <h3 class="text-lg font-semibold text-slate-900">{s.title}</h3>
              <p class="mt-2 text-sm text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Evaluation API */}
      <section class="border-y border-slate-200 bg-slate-50" id="evaluate">
        <div class="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2 lg:items-center">
          <div class="min-w-0">
            <h2 class="text-3xl font-bold text-slate-900">{tr(i18n, "landing.evalTitle")}</h2>
            <p class="mt-3 text-slate-600">{tr(i18n, "landing.evalBody")}</p>
            <p class="mt-4 text-sm text-slate-500">{tr(i18n, "landing.evalNote")}</p>
            <Link href="/info/docs" class="btn-secondary mt-6">
              {tr(i18n, "landing.readDocs")}
            </Link>
          </div>
          <div class="panel-dark card min-w-0 bg-slate-900 p-6 text-slate-100">
            <div class="text-xs uppercase tracking-wide text-slate-400">{tr(i18n, "landing.evalPanelRequest")}</div>
            <pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-800 p-4 text-sm leading-relaxed"><code>{CURL_SNIPPET}</code></pre>
            <div class="mt-5 text-xs uppercase tracking-wide text-slate-400">{tr(i18n, "landing.evalPanelResponse")}</div>
            <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-800 p-4 text-xs leading-relaxed"><code>{CURL_RESPONSE}</code></pre>
          </div>
        </div>
      </section>

      {/* Copy flags highlight */}
      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div class="card order-2 p-6 lg:order-1">
            <div class="flex items-center justify-between text-sm">
              <span class="font-mono font-semibold text-slate-900">web-app</span>
              <span class="text-primary-600" aria-hidden="true">→</span>
              <span class="font-mono font-semibold text-slate-900">mobile-app</span>
            </div>
            <ul class="mt-4 space-y-2 text-sm">
              {[
                ["new-checkout", "copied", "bg-green-100 text-green-800"],
                ["banner-text", "overwritten", "bg-amber-100 text-amber-800"],
                ["max-items", "copied", "bg-green-100 text-green-800"],
                ["legacy-footer", "skipped", "bg-slate-100 text-slate-600"],
              ].map(([key, result, cls]) => (
                <li key={key} class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <span class="font-mono text-slate-700">{key}</span>
                  <span class={["badge", cls]}>{result}</span>
                </li>
              ))}
            </ul>
          </div>
          <div class="order-1 min-w-0 lg:order-2">
            <h2 class="text-3xl font-bold text-slate-900">{tr(i18n, "landing.copyTitle")}</h2>
            <p class="mt-3 text-slate-600">{tr(i18n, "landing.copyBody")}</p>
            <ul class="mt-5 list-disc space-y-2 pl-5 text-sm text-slate-700">
              <li>{tr(i18n, "landing.copyBullet1")}</li>
              <li>{tr(i18n, "landing.copyBullet2")}</li>
              <li>{tr(i18n, "landing.copyBullet3")}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* MCP */}
      <section class="border-y border-slate-200 bg-slate-50" id="mcp">
        <div class="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-2 lg:items-center">
          <div class="min-w-0">
            <span class="badge bg-primary-100 text-primary-700">{tr(i18n, "landing.mcpBadge")}</span>
            <h2 class="mt-4 text-3xl font-bold text-slate-900">
              {tr(i18n, "landing.mcpTitle")}
            </h2>
            <p class="mt-3 text-slate-600">
              {tr(i18n, "landing.mcpIntro")}{" "}
              <em>{tr(i18n, "landing.mcpExample1")}</em> {tr(i18n, "landing.mcpOr")}{" "}
              <em>{tr(i18n, "landing.mcpExample2")}</em>
            </p>
            <ul class="mt-5 space-y-2 text-sm text-slate-700">
              <li>
                <strong>{tr(i18n, "landing.mcpBullet1Title")}</strong> {tr(i18n, "landing.mcpBullet1Body")}
              </li>
              <li>
                <strong>{tr(i18n, "landing.mcpBullet2Title")}</strong> {tr(i18n, "landing.mcpBullet2Body")}
              </li>
              <li>
                <strong>{tr(i18n, "landing.mcpBullet3Title")}</strong> {tr(i18n, "landing.mcpBullet3Body")}
              </li>
              <li>
                <strong>{tr(i18n, "landing.mcpBullet4Title")}</strong> {tr(i18n, "landing.mcpBullet4Body1")}{" "}
                <code class="rounded bg-slate-200 px-1 py-0.5 text-xs">npx exp-mcp</code>{" "}
                (<a href={MCP_NPM_URL} target="_blank" rel="noreferrer" class="text-primary-600 hover:underline">{tr(i18n, "landing.mcpBullet4Npm")}</a>)
                {" "}{tr(i18n, "landing.mcpBullet4Body2")}{" "}
                <code class="rounded bg-slate-200 px-1 py-0.5 text-xs">{APP_URL}/mcp</code> {tr(i18n, "landing.mcpBullet4Body3")}
              </li>
            </ul>
          </div>
          <div class="panel-dark card min-w-0 bg-slate-900 p-6 text-slate-100">
            <div class="text-xs uppercase tracking-wide text-slate-400">{tr(i18n, "landing.mcpPanelLocal")}</div>
            <pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-800 p-4 text-sm leading-relaxed"><code>{MCP_SNIPPET}</code></pre>
            <div class="mt-5 text-xs uppercase tracking-wide text-slate-400">{tr(i18n, "landing.mcpPanelRemote")}</div>
            <pre class="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-800 p-4 text-sm leading-relaxed"><code>{MCP_REMOTE_SNIPPET}</code></pre>
            <div class="mt-5 text-xs uppercase tracking-wide text-slate-400">{tr(i18n, "landing.mcpPanelJson")}</div>
            <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-800 p-4 text-xs leading-relaxed"><code>{`{
  "mcpServers": {
    "exp": {
      "command": "npx",
      "args": ["-y", "exp-mcp"],
      "env": { "EXP_API_KEY": "exp_live_…" }
    }
  }
}`}</code></pre>
            <p class="mt-4 text-sm text-slate-300">
              {tr(i18n, "landing.mcpKeyNote")}{" "}
              <Link href="/dashboard/settings" class="text-white underline">
                {tr(i18n, "landing.mcpKeyLink")}
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Early access notice + CTA */}
      <section class="mx-auto max-w-6xl px-4 py-16">
        <div class="card bg-primary-50 p-8 text-center">
          <h2 class="text-2xl font-bold text-slate-900">{tr(i18n, "landing.ctaTitle")}</h2>
          <p class="mx-auto mt-2 max-w-2xl text-slate-600">{tr(i18n, "landing.ctaBody")}</p>
          {early && (
            <p class="mx-auto mt-3 max-w-2xl text-sm text-primary-900" data-testid="early-access-note">
              <span class="font-semibold">{tr(i18n, "early.bannerTitle")}</span>{" "}
              {tr(i18n, "early.bannerText")}
            </p>
          )}
          <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
            {features.signups ? (
              <Link href="/signup" class="btn-primary px-6 py-3 text-base">
                {tr(i18n, "landing.getStarted")}
              </Link>
            ) : (
              <Link href="/login" class="btn-primary px-6 py-3 text-base">
                {tr(i18n, "nav.login")}
              </Link>
            )}
            <Link href="/info/docs" class="btn-secondary px-6 py-3 text-base">
              {tr(i18n, "landing.readDocs")}
            </Link>
          </div>
        </div>
      </section>

      {/* Self-host callout */}
      <section class="mx-auto max-w-6xl px-4 pb-20">
        <div class="panel-dark card flex flex-col items-start gap-6 bg-slate-900 p-8 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-2xl font-bold">{tr(i18n, "landing.selfhostTitle")}</h2>
            <p class="mt-2 max-w-2xl text-slate-300">
              {tr(i18n, "landing.selfhostBody1")}
              <code class="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-sm">
                docker compose up
              </code>
              {tr(i18n, "landing.selfhostBody2")}
            </p>
          </div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            class="btn bg-white text-slate-900 hover:bg-slate-100"
          >
            {tr(i18n, "landing.viewGithub")}
          </a>
        </div>
      </section>
    </>
  );
});

export const head: DocumentHead = {
  title: "exp — feature flags for projects, people and AI agents",
  meta: [
    {
      name: "description",
      content:
        "exp is an open-source feature-flag service: per-environment toggles, percentage rollouts, typed values, a tiny evaluation API, role-scoped API keys and an MCP server for AI agents. Hosted or self-hostable (MIT).",
    },
  ],
};
