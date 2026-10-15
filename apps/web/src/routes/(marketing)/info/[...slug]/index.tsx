import { component$, useContext } from "@builder.io/qwik";
import { useLocation, Link, type DocumentHead } from "@builder.io/qwik-city";
import { PricingTable } from "../../../../components/pricing-table";
import { FeaturesContext } from "../../../../lib/features";
import { tr, useI18n } from "../../../../i18n";
import type { CatalogKey } from "../../../../i18n/catalog/en";

const APP_URL = (import.meta.env.VITE_APP_URL || "https://exp.3m4.net").replace(/\/$/, "");
const CONTRACT_URL = "https://github.com/Devace-93/exp/blob/main/CONTRACT.md";
const MCP_SNIPPET = "claude mcp add exp --scope user --env EXP_API_KEY=exp_live_… -- npx -y exp-mcp";
const MCP_REMOTE_SNIPPET = `claude mcp add --transport http exp ${APP_URL}/mcp --header "Authorization: Bearer exp_live_…"`;

interface Endpoint {
  method: string;
  path: string;
  scope: string;
  notes?: string;
}

/** Endpoint groups of the REST quick reference (mirror of CONTRACT.md). */
const SECTIONS: { title: CatalogKey; body: CatalogKey; endpoints: Endpoint[]; snippet?: string }[] = [
  {
    title: "docs.projectsTitle",
    body: "docs.projectsBody",
    endpoints: [
      { method: "GET", path: "/projects?q=", scope: "projects:read" },
      { method: "POST", path: "/projects", scope: "projects:write", notes: "{name, key?, description?} → 201 · 402 limit_reached" },
      { method: "GET", path: "/projects/:id", scope: "projects:read" },
      { method: "PATCH", path: "/projects/:id", scope: "projects:write", notes: "{name?, description?}" },
      { method: "DELETE", path: "/projects/:id", scope: "projects:delete", notes: "cascades" },
      { method: "GET", path: "/projects/:id/export", scope: "flags:read", notes: "exp.project.v1" },
      { method: "GET", path: "/projects/:id/environments", scope: "projects:read" },
      { method: "POST", path: "/projects/:id/environments", scope: "projects:write", notes: "{key, name?} → client_key once" },
      { method: "DELETE", path: "/projects/:id/environments/:envId", scope: "projects:delete", notes: "last one: 400 last_environment" },
      { method: "POST", path: "/projects/:id/environments/:envId/rotate-key", scope: "projects:write", notes: "old key stops immediately" },
    ],
    snippet: `curl -X POST ${APP_URL}/api/projects \\
  -H "X-API-Key: exp_live_…" -H "Content-Type: application/json" \\
  -d '{"name": "Web app"}'`,
  },
  {
    title: "docs.flagsTitle",
    body: "docs.flagsBody",
    endpoints: [
      { method: "GET", path: "/projects/:id/flags?q=&page=&per_page=&include_archived=", scope: "flags:read", notes: "ordered by key" },
      { method: "POST", path: "/projects/:id/flags", scope: "flags:write", notes: "{key, name?, kind?, default_value?, tags?, states?} · 409 key_taken · 402" },
      { method: "GET", path: "/projects/:id/flags/:flag", scope: "flags:read", notes: ":flag = UUID or key" },
      { method: "PATCH", path: "/projects/:id/flags/:flag", scope: "flags:write", notes: "changing kind resets state values" },
      { method: "DELETE", path: "/projects/:id/flags/:flag", scope: "flags:delete" },
    ],
    snippet: `curl -X POST ${APP_URL}/api/projects/$PROJECT/flags \\
  -H "X-API-Key: exp_live_…" -H "Content-Type: application/json" \\
  -d '{"key": "new-checkout", "kind": "boolean", "tags": ["checkout"]}'`,
  },
  {
    title: "docs.statesTitle",
    body: "docs.statesBody",
    endpoints: [
      { method: "PUT", path: "/projects/:id/flags/:flag/states/:envKey", scope: "flags:write", notes: "{enabled?, value?, rollout_percent?} → Flag" },
      { method: "GET", path: "/projects/:id/flags/evaluate?environment=&distinct_id=", scope: "flags:read", notes: "preview, not metered" },
    ],
    snippet: `curl -X PUT ${APP_URL}/api/projects/$PROJECT/flags/new-checkout/states/staging \\
  -H "X-API-Key: exp_live_…" -H "Content-Type: application/json" \\
  -d '{"enabled": true, "rollout_percent": 25}'`,
  },
  {
    title: "docs.copyTitle",
    body: "docs.copyBody",
    endpoints: [
      { method: "POST", path: "/projects/:id/flags/copy", scope: "flags:write", notes: "{target_project_id, flag_keys?, include_states?, on_conflict?} → {copied, overwritten, skipped}" },
    ],
  },
  {
    title: "docs.evalTitle",
    body: "docs.evalBody",
    endpoints: [
      { method: "GET", path: "/eval/flags?distinct_id=", scope: "X-Environment-Key", notes: "metered +1" },
      { method: "GET", path: "/eval/flags/:key?distinct_id=", scope: "X-Environment-Key", notes: "metered +1 · 404 for unknown/archived" },
    ],
    snippet: `curl "${APP_URL}/api/eval/flags?distinct_id=user-42" \\
  -H "X-Environment-Key: exp_env_…"`,
  },
];

const METHOD_CLASS: Record<string, string> = {
  GET: "bg-green-100 text-green-800",
  POST: "bg-primary-100 text-primary-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-amber-100 text-amber-800",
  DELETE: "bg-red-100 text-red-800",
};

const EndpointTable = component$<{ endpoints: Endpoint[] }>(({ endpoints }) => {
  const i18n = useI18n();
  return (
    <div class="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2">{tr(i18n, "docs.colMethod")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colPath")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colScope")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colNotes")}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {endpoints.map((e) => (
            <tr key={e.method + e.path}>
              <td class="px-3 py-2">
                <span class={["badge font-mono", METHOD_CLASS[e.method] ?? "bg-slate-100 text-slate-700"]}>{e.method}</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs text-slate-800">{e.path}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-500">{e.scope}</td>
              <td class="px-3 py-2 text-xs text-slate-600">{e.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/**
 * Catch-all info section: /info/pricing, /info/docs and a generic placeholder
 * for any other slug (terms, privacy, …) — future pages drop in here without
 * new routes.
 */
export default component$(() => {
  const loc = useLocation();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const slug = (loc.params.slug || "").replace(/\/$/, "");

  if (slug === "pricing") {
    const early = features["early-access"];
    return (
      <div class="mx-auto max-w-6xl px-4 py-16">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-slate-900">
            {early ? tr(i18n, "pricing.titlePlanned") : tr(i18n, "pricing.title")}
          </h1>
          <p class="mx-auto mt-3 max-w-2xl text-slate-600">
            {early ? tr(i18n, "pricing.introPlanned") : tr(i18n, "pricing.intro")}
          </p>
        </div>

        {early && (
          <div class="mx-auto mt-8 max-w-3xl rounded-xl border border-primary-200 bg-primary-50 p-6 text-center" data-testid="early-access-pricing">
            <p class="text-lg font-semibold text-primary-900">
              {tr(i18n, "pricing.earlyTitle")}
            </p>
            <p class="mt-2 text-sm text-primary-900/80">
              {tr(i18n, "pricing.earlyBody")}
            </p>
            <Link href="/blog/what-paid-plans-will-include" class="btn-primary mt-4">
              {tr(i18n, "pricing.earlyCta")}
            </Link>
          </div>
        )}

        <div class="mt-12">
          <PricingTable />
        </div>

        <div class="mt-10 card bg-primary-50 p-6 text-center">
          <h2 class="text-lg font-semibold text-slate-900">
            {tr(i18n, "pricing.enterpriseTitle")}
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            {tr(i18n, "pricing.enterpriseBody")}
          </p>
          <a
            href="mailto:enrique@3m4.net?subject=exp%20Enterprise"
            class="btn-primary mt-4"
          >
            {tr(i18n, "pricing.contactUs")}
          </a>
        </div>

        <p class="mt-8 text-center text-sm text-slate-500">
          {tr(i18n, "pricing.footnote")}
          {early && ` ${tr(i18n, "pricing.footnoteEarly")}`}
        </p>
      </div>
    );
  }

  if (slug === "docs") {
    return (
      <div class="mx-auto max-w-4xl px-4 py-16">
        <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "docs.title")}</h1>
        <p class="mt-2 text-slate-600">{tr(i18n, "docs.intro")}</p>
        <a href={CONTRACT_URL} target="_blank" rel="noreferrer" class="mt-3 inline-block text-sm font-medium text-primary-600 hover:underline">
          {tr(i18n, "docs.fullContract")} →
        </a>

        <div class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.baseUrl")}</h2>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm"><code>{APP_URL}/api</code></pre>
        </div>

        <section class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.authTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.authBody")}</p>
          <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>{tr(i18n, "docs.authDashboard")}</li>
            <li>{tr(i18n, "docs.authApiKey")}</li>
            <li>{tr(i18n, "docs.authEnvKey")}</li>
          </ul>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} class="mt-8 card p-6">
            <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, s.title)}</h2>
            <p class="mt-2 text-sm text-slate-600">{tr(i18n, s.body)}</p>
            {s.title === "docs.evalTitle" && (
              <>
                <ol class="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                  <li>{tr(i18n, "docs.evalRule1")}</li>
                  <li>{tr(i18n, "docs.evalRule2")}</li>
                  <li>{tr(i18n, "docs.evalRule3")}</li>
                  <li>{tr(i18n, "docs.evalRule4")}</li>
                </ol>
                <p class="mt-3 text-sm text-slate-600">{tr(i18n, "docs.evalPreview")}</p>
              </>
            )}
            <EndpointTable endpoints={s.endpoints} />
            {s.snippet && (
              <pre class="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs leading-relaxed"><code>{s.snippet}</code></pre>
            )}
          </section>
        ))}

        <section class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.errorsTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.errorsBody")}</p>
        </section>

        <section class="mt-8 card p-6" id="mcp">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.mcpTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.mcpBody")}</p>
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.mcpLocal")}</div>
          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs leading-relaxed"><code>{MCP_SNIPPET}</code></pre>
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.mcpRemote")}</div>
          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs leading-relaxed"><code>{MCP_REMOTE_SNIPPET}</code></pre>
        </section>
      </div>
    );
  }

  // Generic placeholder for any other /info/* page.
  const title = slug
    ? slug.split("/")[0].replace(/-/g, " ")
    : tr(i18n, "info.title");
  return (
    <div class="mx-auto max-w-3xl px-4 py-20 text-center">
      <h1 class="text-3xl font-bold capitalize text-slate-900">{title}</h1>
      <p class="mt-3 text-slate-600">{tr(i18n, "info.comingSoon")}</p>
      <Link href="/info" class="btn-secondary mt-6">
        {tr(i18n, "info.backToInfo")}
      </Link>
    </div>
  );
});

export const head: DocumentHead = ({ params }) => {
  const slug = (params.slug || "info").split("/")[0];
  const title = slug === "pricing" ? "Pricing" : slug === "docs" ? "Docs" : slug.replace(/-/g, " ");
  return {
    title: `${title.charAt(0).toUpperCase() + title.slice(1)} — exp`,
  };
};
