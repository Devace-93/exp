import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../lib/api";
import { capture } from "../../../lib/analytics";
import { errorMessage, isLimitError } from "../../../lib/errors";
import { slugify } from "../../../lib/flag-values";
import { UsageBar } from "../../../components/usage-bar";
import { EarlyAccessBanner } from "../../../components/early-access-banner";
import { Modal } from "../../../components/modal";
import { FeaturesContext } from "../../../lib/features";
import { tr, useI18n } from "../../../i18n";
import type { Environment, MeResponse, Project } from "../../../lib/types";

export default component$(() => {
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const state = useStore<{
    projects: Project[];
    me: MeResponse | null;
    loading: boolean;
    loadError: string;
    q: string;
  }>({ projects: [], me: null, loading: true, loadError: "", q: "" });

  const form = useStore({
    open: false,
    name: "",
    key: "",
    keyTouched: false,
    description: "",
    submitting: false,
    error: "",
    limitReached: false,
    /** Set after a successful POST: the dialog switches to the one-time keys step. */
    created: null as Project | null,
    copiedEnv: "",
  });

  const load = $(async () => {
    state.loading = true;
    state.loadError = "";
    try {
      const [me, projects] = await Promise.all([api.me(), api.listProjects()]);
      state.me = me;
      state.projects = projects.items;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "dash.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const createProject = $(async () => {
    form.error = "";
    form.limitReached = false;
    form.submitting = true;
    try {
      const project = await api.createProject({
        name: form.name.trim(),
        key: form.key.trim() || undefined,
        description: form.description.trim() || undefined,
      });
      capture("project_created");
      form.name = "";
      form.key = "";
      form.keyTouched = false;
      form.description = "";
      state.projects = [project, ...state.projects];
      api.me().then((me) => (state.me = me)).catch(() => {});
      // Client keys come back exactly once (never on GET), so show them here.
      form.created = project;
    } catch (e) {
      form.limitReached = isLimitError(e);
      form.error = errorMessage(i18n, e, "dash.createFailed");
    } finally {
      form.submitting = false;
    }
  });

  const copyEnvKey = $(async (env: Environment) => {
    try {
      await navigator.clipboard.writeText(env.client_key ?? "");
      form.copiedEnv = env.id;
      setTimeout(() => (form.copiedEnv = ""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  });

  const closeDialog = $(() => {
    form.open = false;
    form.created = null;
    form.error = "";
  });

  const limits = state.me?.limits;
  const usage = state.me?.usage;
  const q = state.q.trim().toLowerCase();
  const visible = q
    ? state.projects.filter((p) => `${p.name} ${p.key} ${p.description ?? ""}`.toLowerCase().includes(q))
    : state.projects;
  const evalLimit = limits?.evaluations_per_month ?? -1;
  const overage = !!usage && evalLimit >= 0 && usage.evaluations > evalLimit;

  return (
    <div class="mx-auto max-w-6xl px-4 py-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "dash.title")}</h1>
          {state.me && (
            <p class="text-sm text-slate-500">
              {state.me.account.name} ·{" "}
              {features["early-access"] ? (
                <span>{tr(i18n, "dash.earlyAccess")}</span>
              ) : (
                <>
                  <span class="capitalize">{state.me.account.plan}</span>{" "}
                  {tr(i18n, "dash.planSuffix")}
                </>
              )}
            </p>
          )}
        </div>
        <div class="flex items-center gap-2">
          {features.billing && !features["early-access"] && (
            <Link href="/dashboard/billing" class="btn-secondary">
              {tr(i18n, "dash.upgradePlan")}
            </Link>
          )}
          <button type="button" class="btn-primary" onClick$={() => (form.open = true)}>
            {tr(i18n, "dash.newProject")}
          </button>
        </div>
      </div>

      <div class="mt-4">
        <EarlyAccessBanner />
      </div>

      {/* Usage */}
      {limits && usage && (
        <div class="mt-6 grid gap-6 sm:grid-cols-2">
          <div class="card p-5">
            <UsageBar
              label={tr(i18n, "dash.usageProjects")}
              used={state.me?.counts?.projects ?? usage.counts?.projects ?? state.projects.length}
              limit={limits.projects}
            />
          </div>
          <div class="card p-5">
            <UsageBar
              label={tr(i18n, "dash.usageEvaluations")}
              used={usage.evaluations}
              limit={limits.evaluations_per_month}
            />
            {overage && (
              <p class="mt-2 text-xs text-amber-700">{tr(i18n, "dash.evalOverage")}</p>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      {state.projects.length > 0 && (
        <div class="mt-6">
          <input
            type="search"
            class="input sm:max-w-sm"
            placeholder={tr(i18n, "dash.searchPlaceholder")}
            aria-label={tr(i18n, "common.search")}
            value={state.q}
            onInput$={(_, el) => (state.q = el.value)}
          />
        </div>
      )}

      {/* Projects grid */}
      <div class="mt-6">
        {state.loading ? (
          <div class="card p-10 text-center text-sm text-slate-400">
            {tr(i18n, "common.loading")}
          </div>
        ) : state.loadError ? (
          <div class="card p-10 text-center text-sm text-red-600">
            {state.loadError}{" "}
            <button type="button" class="font-medium underline" onClick$={load}>
              {tr(i18n, "common.retry")}
            </button>
          </div>
        ) : state.projects.length === 0 ? (
          <div class="card p-10 text-center text-sm text-slate-500">
            {tr(i18n, "dash.empty")}
          </div>
        ) : visible.length === 0 ? (
          <div class="card p-10 text-center text-sm text-slate-500">
            {tr(i18n, "dash.noMatch")}
          </div>
        ) : (
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/projects/${p.id}`}
                class="card flex flex-col p-5 hover:border-primary-300"
              >
                <div class="flex items-start justify-between gap-2">
                  <h2 class="font-semibold text-slate-900">{p.name}</h2>
                  <span class="font-mono text-xs text-slate-500">{p.key}</span>
                </div>
                {p.description && (
                  <p class="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>
                )}
                <div class="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span class="badge bg-primary-50 text-primary-700">
                    {tr(i18n, "dash.flagsCount", { n: p.flag_count })}
                  </span>
                  <span class="badge bg-slate-100 text-slate-600">
                    {tr(i18n, "dash.envsCount", { n: p.environments?.length ?? 0 })}
                  </span>
                  <span class="ml-auto font-medium text-primary-600">{tr(i18n, "dash.openProject")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Create project dialog */}
      <Modal
        open={form.open}
        title={form.created ? tr(i18n, "dash.keysTitle") : tr(i18n, "dash.newProject")}
        onClose$={closeDialog}
      >
        {form.created ? (
          <div data-testid="project-keys-step">
            <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {tr(i18n, "dash.keysWarning")}
            </div>
            <ul class="mt-4 space-y-3">
              {(form.created.environments ?? []).map((env) => (
                <li key={env.id} class="rounded-lg border border-slate-200 p-3">
                  <div class="flex items-center justify-between text-sm">
                    <span class="font-semibold text-slate-900">{env.name || env.key}</span>
                    <span class="font-mono text-xs text-slate-500">{env.key}</span>
                  </div>
                  <div class="mt-2 flex items-center gap-2">
                    <code class="flex-1 overflow-x-auto rounded bg-slate-100 px-2 py-1 text-xs text-slate-800">
                      {env.client_key ?? `${env.client_key_prefix}…`}
                    </code>
                    {env.client_key && (
                      <button type="button" class="btn-secondary px-2 py-1 text-xs" onClick$={() => copyEnvKey(env)}>
                        {form.copiedEnv === env.id ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div class="mt-4 flex justify-end">
              <Link href={`/dashboard/projects/${form.created.id}`} class="btn-primary" onClick$={closeDialog}>
                {tr(i18n, "dash.goToProject")}
              </Link>
            </div>
          </div>
        ) : (
        <form class="space-y-4" preventdefault:submit onSubmit$={createProject}>
          {form.error && (
            <div
              class={[
                "rounded-lg border px-3 py-2 text-sm",
                form.limitReached
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-red-200 bg-red-50 text-red-700",
              ]}
            >
              {form.error}{" "}
              {form.limitReached && features.billing && !features["early-access"] && (
                <Link href="/dashboard/billing" class="font-semibold underline">
                  {tr(i18n, "limit.upgrade")}
                </Link>
              )}
            </div>
          )}
          <div>
            <label class="label" for="pname">{tr(i18n, "dash.projectName")}</label>
            <input
              id="pname"
              type="text"
              required
              class="input"
              placeholder={tr(i18n, "dash.projectNamePlaceholder")}
              value={form.name}
              onInput$={(_, el) => {
                form.name = el.value;
                if (!form.keyTouched) form.key = slugify(el.value);
              }}
            />
          </div>
          <div>
            <label class="label" for="pkey">
              {tr(i18n, "dash.projectKey")}{" "}
              <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
            </label>
            <input
              id="pkey"
              type="text"
              class="input font-mono"
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              placeholder={tr(i18n, "dash.projectKeyPlaceholder")}
              value={form.key}
              onInput$={(_, el) => {
                form.key = el.value;
                form.keyTouched = true;
              }}
            />
            <p class="mt-1 text-xs text-slate-400">{tr(i18n, "dash.projectKeyHint")}</p>
          </div>
          <div>
            <label class="label" for="pdesc">
              {tr(i18n, "dash.projectDescription")}{" "}
              <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
            </label>
            <textarea
              id="pdesc"
              class="input"
              rows={2}
              value={form.description}
              onInput$={(_, el) => (form.description = el.value)}
            />
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary" onClick$={closeDialog}>
              {tr(i18n, "common.cancel")}
            </button>
            <button type="submit" class="btn-primary" disabled={form.submitting}>
              {form.submitting ? tr(i18n, "common.creating") : tr(i18n, "dash.createProject")}
            </button>
          </div>
        </form>
        )}
      </Modal>
    </div>
  );
});

export const head: DocumentHead = { title: "Projects — exp" };
