import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../../lib/api";
import { capture } from "../../../../../../lib/analytics";
import { errorMessage, isLimitError } from "../../../../../../lib/errors";
import { downloadJson } from "../../../../../../lib/flag-values";
import { FeaturesContext } from "../../../../../../lib/features";
import { tr, useI18n } from "../../../../../../i18n";
import type { Environment, Project } from "../../../../../../lib/types";

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const id = loc.params.id;

  const state = useStore<{
    project: Project | null;
    envs: Environment[];
    loading: boolean;
    loadError: string;
    /** One-time client keys by environment id (create / rotate). */
    revealed: Record<string, string>;
    copied: string;
    envError: string;
    busy: string;
  }>({ project: null, envs: [], loading: true, loadError: "", revealed: {}, copied: "", envError: "", busy: "" });

  const info = useStore({ name: "", description: "", saving: false, saved: false, error: "" });
  const create = useStore({ key: "", name: "", submitting: false, error: "", limitReached: false });
  const exp = useStore({ busy: false, error: "" });
  const del = useStore({ confirm: "", deleting: false, error: "" });

  const load = $(async () => {
    state.loading = true;
    state.loadError = "";
    try {
      const project = await api.getProject(id);
      state.project = project;
      state.envs = project.environments ?? (await api.listEnvironments(id));
      info.name = project.name;
      info.description = project.description ?? "";
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "psettings.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const saveInfo = $(async () => {
    info.saving = true;
    info.error = "";
    info.saved = false;
    try {
      state.project = await api.updateProject(id, { name: info.name.trim(), description: info.description.trim() });
      info.saved = true;
    } catch (e) {
      info.error = errorMessage(i18n, e, "psettings.saveFailed");
    } finally {
      info.saving = false;
    }
  });

  const createEnv = $(async () => {
    create.submitting = true;
    create.error = "";
    create.limitReached = false;
    try {
      const env = await api.createEnvironment(id, { key: create.key.trim(), name: create.name.trim() || undefined });
      capture("environment_created");
      state.envs = [...state.envs, env];
      if (env.client_key) state.revealed[env.id] = env.client_key;
      create.key = "";
      create.name = "";
    } catch (e) {
      create.limitReached = isLimitError(e);
      create.error = errorMessage(i18n, e, "psettings.createEnvFailed");
    } finally {
      create.submitting = false;
    }
  });

  const rotate = $(async (env: Environment) => {
    if (!confirm(tr(i18n, "psettings.rotateConfirm", { env: env.key }))) return;
    state.busy = env.id;
    state.envError = "";
    try {
      const res = await api.rotateEnvironmentKey(id, env.id);
      capture("environment_key_rotated");
      state.revealed[env.id] = res.client_key;
      state.envs = state.envs.map((e) => (e.id === env.id ? { ...e, client_key_prefix: res.client_key_prefix } : e));
    } catch (e) {
      state.envError = errorMessage(i18n, e, "psettings.rotateFailed");
    } finally {
      state.busy = "";
    }
  });

  const deleteEnv = $(async (env: Environment) => {
    if (!confirm(tr(i18n, "psettings.deleteEnvConfirm", { env: env.key }))) return;
    state.busy = env.id;
    state.envError = "";
    try {
      await api.deleteEnvironment(id, env.id);
      capture("environment_deleted");
      state.envs = state.envs.filter((e) => e.id !== env.id);
      delete state.revealed[env.id];
    } catch (e) {
      state.envError =
        e instanceof ApiRequestError && e.error.code === "last_environment"
          ? tr(i18n, "psettings.lastEnv")
          : errorMessage(i18n, e, "psettings.deleteEnvFailed");
    } finally {
      state.busy = "";
    }
  });

  const copyKey = $(async (envId: string) => {
    try {
      await navigator.clipboard.writeText(state.revealed[envId] ?? "");
      state.copied = envId;
      setTimeout(() => (state.copied = ""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  });

  const exportProject = $(async () => {
    exp.busy = true;
    exp.error = "";
    try {
      const data = await api.exportProject(id);
      downloadJson(`${data.project.key}.exp.json`, data);
      capture("project_exported");
    } catch (e) {
      exp.error = errorMessage(i18n, e, "psettings.exportFailed");
    } finally {
      exp.busy = false;
    }
  });

  const deleteProject = $(async () => {
    if (!state.project || del.confirm !== state.project.key) return;
    del.deleting = true;
    del.error = "";
    try {
      await api.deleteProject(id);
      capture("project_deleted");
      await nav("/dashboard");
    } catch (e) {
      del.error = errorMessage(i18n, e, "psettings.deleteProjectFailed");
      del.deleting = false;
    }
  });

  if (state.loading) {
    return (
      <div class="mx-auto max-w-4xl px-4 py-8">
        <div class="card p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
      </div>
    );
  }

  const project = state.project;
  if (!project) {
    return (
      <div class="mx-auto max-w-4xl px-4 py-8">
        <Link href="/dashboard" class="text-sm text-slate-500 hover:text-primary-600">
          {tr(i18n, "project.back")}
        </Link>
        <div class="mt-4 card p-10 text-center text-sm text-red-600">
          {state.loadError || tr(i18n, "psettings.loadFailed")}
        </div>
      </div>
    );
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8">
      <Link href={`/dashboard/projects/${id}`} class="text-sm text-slate-500 hover:text-primary-600">
        {tr(i18n, "psettings.back")}
      </Link>
      <h1 class="mt-2 text-2xl font-bold text-slate-900">{tr(i18n, "psettings.title")}</h1>
      <p class="text-sm text-slate-500">
        {project.name} · <span class="font-mono">{project.key}</span>
      </p>

      {/* Project info */}
      <section class="mt-6 card p-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.infoTitle")}</h2>
        <form class="mt-4 space-y-4" preventdefault:submit onSubmit$={saveInfo}>
          {info.error && (
            <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{info.error}</div>
          )}
          {info.saved && (
            <div class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{tr(i18n, "common.saved")}</div>
          )}
          <div>
            <label class="label" for="iname">{tr(i18n, "common.name")}</label>
            <input id="iname" type="text" required class="input" value={info.name} onInput$={(_, el) => (info.name = el.value)} />
          </div>
          <div>
            <label class="label" for="idesc">{tr(i18n, "common.description")}</label>
            <textarea id="idesc" class="input" rows={2} value={info.description} onInput$={(_, el) => (info.description = el.value)} />
          </div>
          <div class="flex justify-end">
            <button type="submit" class="btn-primary" disabled={info.saving}>
              {info.saving ? tr(i18n, "common.saving") : tr(i18n, "common.save")}
            </button>
          </div>
        </form>
      </section>

      {/* Environments */}
      <section class="mt-6 card p-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.envsTitle")}</h2>
        <p class="mt-1 text-sm text-slate-500">{tr(i18n, "psettings.envsBody")}</p>
        {state.envError && (
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.envError}</div>
        )}
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th class="px-3 py-2">{tr(i18n, "psettings.colKey")}</th>
                <th class="px-3 py-2">{tr(i18n, "psettings.colName")}</th>
                <th class="px-3 py-2">{tr(i18n, "psettings.colClientKey")}</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              {state.envs.map((env) => (
                <tr key={env.id}>
                  <td class="px-3 py-3 font-mono text-slate-800">{env.key}</td>
                  <td class="px-3 py-3 text-slate-700">{env.name}</td>
                  <td class="px-3 py-3">
                    {state.revealed[env.id] ? (
                      <div class="rounded-lg border border-green-300 bg-green-50 p-2">
                        <p class="text-xs font-semibold text-green-800">{tr(i18n, "psettings.oneTimeKey")}</p>
                        <div class="mt-1 flex items-center gap-2">
                          <code class="flex-1 overflow-x-auto rounded bg-white px-2 py-1 text-xs text-slate-800">
                            {state.revealed[env.id]}
                          </code>
                          <button type="button" class="btn-secondary px-2 py-1 text-xs" onClick$={() => copyKey(env.id)}>
                            {state.copied === env.id ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <code class="font-mono text-xs text-slate-500">{env.client_key_prefix}…</code>
                    )}
                  </td>
                  <td class="px-3 py-3 text-right">
                    <div class="flex justify-end gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        class="text-xs font-medium text-primary-600 hover:underline"
                        disabled={state.busy === env.id}
                        onClick$={() => rotate(env)}
                      >
                        {tr(i18n, "psettings.rotate")}
                      </button>
                      <button
                        type="button"
                        class="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                        disabled={state.busy === env.id || state.envs.length <= 1}
                        title={state.envs.length <= 1 ? tr(i18n, "psettings.lastEnv") : undefined}
                        onClick$={() => deleteEnv(env)}
                      >
                        {tr(i18n, "psettings.deleteEnv")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form class="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5" preventdefault:submit onSubmit$={createEnv}>
          <div>
            <label class="label" for="ekey">{tr(i18n, "psettings.envKey")}</label>
            <input
              id="ekey"
              type="text"
              required
              class="input font-mono"
              pattern="[a-z0-9][a-z0-9_-]{0,62}"
              placeholder={tr(i18n, "psettings.envKeyPlaceholder")}
              value={create.key}
              onInput$={(_, el) => (create.key = el.value)}
            />
          </div>
          <div class="flex-1">
            <label class="label" for="ename">
              {tr(i18n, "psettings.envName")}{" "}
              <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
            </label>
            <input id="ename" type="text" class="input" value={create.name} onInput$={(_, el) => (create.name = el.value)} />
          </div>
          <button type="submit" class="btn-primary" disabled={create.submitting}>
            {create.submitting ? tr(i18n, "common.creating") : tr(i18n, "psettings.createEnv")}
          </button>
        </form>
        {create.error && (
          <div
            class={[
              "mt-3 rounded-lg border px-3 py-2 text-sm",
              create.limitReached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700",
            ]}
          >
            {create.error}{" "}
            {create.limitReached && features.billing && !features["early-access"] && (
              <Link href="/dashboard/billing" class="font-semibold underline">{tr(i18n, "limit.upgrade")}</Link>
            )}
          </div>
        )}
      </section>

      {/* Export */}
      <section class="mt-6 card p-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.exportTitle")}</h2>
        <p class="mt-1 text-sm text-slate-500">{tr(i18n, "psettings.exportBody")}</p>
        {exp.error && (
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exp.error}</div>
        )}
        <button type="button" class="btn-secondary mt-4" disabled={exp.busy} onClick$={exportProject}>
          {exp.busy ? tr(i18n, "common.loading") : tr(i18n, "psettings.download")}
        </button>
      </section>

      {/* Danger zone */}
      <section class="mt-6 card border-red-200 p-6">
        <h2 class="text-lg font-semibold text-red-700">{tr(i18n, "psettings.dangerTitle")}</h2>
        <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.dangerBody")}</p>
        {del.error && (
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{del.error}</div>
        )}
        <form class="mt-4 flex flex-wrap items-end gap-3" preventdefault:submit onSubmit$={deleteProject}>
          <div class="flex-1">
            <label class="label" for="pconfirm">{tr(i18n, "psettings.deleteProjectConfirm")}</label>
            <input
              id="pconfirm"
              type="text"
              class="input font-mono"
              placeholder={project.key}
              value={del.confirm}
              onInput$={(_, el) => (del.confirm = el.value)}
            />
          </div>
          <button
            type="submit"
            class="btn bg-red-600 text-white hover:bg-red-700"
            disabled={del.deleting || del.confirm !== project.key}
          >
            {del.deleting ? tr(i18n, "common.deleting") : tr(i18n, "psettings.deleteProject")}
          </button>
        </form>
      </section>
    </div>
  );
});

export const head: DocumentHead = { title: "Project settings — exp" };
