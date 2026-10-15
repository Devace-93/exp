import {
  component$,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../../../lib/api";
import { capture } from "../../../../../../../lib/analytics";
import { errorMessage } from "../../../../../../../lib/errors";
import { KINDS, KIND_LABEL, formatValue, parseValue } from "../../../../../../../lib/flag-values";
import { Switch } from "../../../../../../../components/switch";
import { tr, useI18n } from "../../../../../../../i18n";
import type { Environment, Evaluation, Flag, FlagKind } from "../../../../../../../lib/types";

interface EnvForm {
  enabled: boolean;
  value: string;
  rollout: number;
  saving: boolean;
  error: string;
  saved: boolean;
}

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const i18n = useI18n();
  const projectId = loc.params.id;
  const flagRef = loc.params.flag;

  const state = useStore<{
    flag: Flag | null;
    envs: Environment[];
    loading: boolean;
    loadError: string;
  }>({ flag: null, envs: [], loading: true, loadError: "" });

  const def = useStore({
    name: "",
    description: "",
    kind: "boolean" as FlagKind,
    defaultValue: "",
    tags: "",
    archived: false,
    saving: false,
    saved: false,
    error: "",
  });

  const envForms = useStore<Record<string, EnvForm>>({});

  const preview = useStore<{
    env: string;
    distinctId: string;
    running: boolean;
    error: string;
    result: Evaluation | null;
  }>({ env: "", distinctId: "", running: false, error: "", result: null });

  const del = useStore({ confirm: "", deleting: false, error: "" });

  const hydrate = $((flag: Flag) => {
    def.name = flag.name ?? "";
    def.description = flag.description ?? "";
    def.kind = flag.kind;
    def.defaultValue = flag.kind === "boolean" ? "" : formatValue(flag.kind, flag.default_value);
    def.tags = flag.tags.join(", ");
    def.archived = flag.archived;
    for (const [envKey, st] of Object.entries(flag.states)) {
      envForms[envKey] = {
        enabled: st.enabled,
        value: formatValue(flag.kind, st.value),
        rollout: st.rollout_percent,
        saving: false,
        error: "",
        saved: false,
      };
    }
  });

  const load = $(async () => {
    state.loading = true;
    state.loadError = "";
    try {
      const [flag, project] = await Promise.all([api.getFlag(projectId, flagRef), api.getProject(projectId)]);
      state.flag = flag;
      state.envs = project.environments ?? [];
      preview.env = state.envs[0]?.key ?? "";
      await hydrate(flag);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "flag.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const saveDefinition = $(async () => {
    if (!state.flag) return;
    def.error = "";
    def.saved = false;
    const parsed = def.kind === "boolean" ? { ok: true as const, value: true } : parseValue(def.kind, def.defaultValue);
    if (!parsed.ok) {
      def.error = tr(i18n, parsed.error);
      return;
    }
    def.saving = true;
    try {
      const updated = await api.updateFlag(projectId, state.flag.id, {
        name: def.name.trim(),
        description: def.description.trim(),
        kind: def.kind,
        default_value: def.kind === "boolean" ? undefined : parsed.value ?? undefined,
        tags: def.tags.split(",").map((t) => t.trim()).filter(Boolean),
        archived: def.archived,
      });
      state.flag = updated;
      await hydrate(updated);
      def.saved = true;
      capture("flag_updated", { kind: updated.kind, archived: updated.archived });
    } catch (e) {
      def.error = errorMessage(i18n, e, "flag.saveFailed");
    } finally {
      def.saving = false;
    }
  });

  const saveState = $(async (envKey: string) => {
    const form = envForms[envKey];
    if (!state.flag || !form) return;
    form.error = "";
    form.saved = false;
    const parsed = state.flag.kind === "boolean" ? { ok: true as const, value: null } : parseValue(state.flag.kind, form.value);
    if (!parsed.ok) {
      form.error = tr(i18n, parsed.error);
      return;
    }
    form.saving = true;
    try {
      const updated = await api.setFlagState(projectId, state.flag.id, envKey, {
        enabled: form.enabled,
        value: parsed.value,
        rollout_percent: Math.max(0, Math.min(100, Math.round(form.rollout))),
      });
      state.flag = updated;
      const st = updated.states[envKey];
      if (st) {
        form.enabled = st.enabled;
        form.value = formatValue(updated.kind, st.value);
        form.rollout = st.rollout_percent;
      }
      form.saved = true;
      capture("flag_state_updated", { environment: envKey, enabled: form.enabled, rollout: form.rollout });
    } catch (e) {
      form.error = errorMessage(i18n, e, "flag.stateSaveFailed").split("{env}").join(envKey);
    } finally {
      form.saving = false;
    }
  });

  const runPreview = $(async () => {
    if (!preview.env) return;
    preview.running = true;
    preview.error = "";
    preview.result = null;
    try {
      preview.result = await api.evaluatePreview(projectId, preview.env, preview.distinctId.trim());
    } catch (e) {
      preview.error = errorMessage(i18n, e, "flag.previewFailed");
    } finally {
      preview.running = false;
    }
  });

  const deleteFlag = $(async () => {
    if (!state.flag || del.confirm !== state.flag.key) return;
    del.deleting = true;
    del.error = "";
    try {
      await api.deleteFlag(projectId, state.flag.id);
      capture("flag_deleted");
      await nav(`/dashboard/projects/${projectId}`);
    } catch (e) {
      del.error = errorMessage(i18n, e, "flag.deleteFailed");
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

  const flag = state.flag;
  if (!flag) {
    return (
      <div class="mx-auto max-w-4xl px-4 py-8">
        <Link href={`/dashboard/projects/${projectId}`} class="text-sm text-slate-500 hover:text-primary-600">
          {tr(i18n, "flag.back")}
        </Link>
        <div class="mt-4 card p-10 text-center text-sm text-red-600">
          {state.loadError || tr(i18n, "flag.loadFailed")}
        </div>
      </div>
    );
  }

  const kindChanged = def.kind !== flag.kind;
  const envKeys = state.envs.length ? state.envs.map((e) => e.key) : Object.keys(flag.states);
  const previewEntry = preview.result?.flags[flag.key];

  return (
    <div class="mx-auto max-w-4xl px-4 py-8">
      <Link href={`/dashboard/projects/${projectId}`} class="text-sm text-slate-500 hover:text-primary-600">
        {tr(i18n, "flag.back")}
      </Link>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <h1 class="font-mono text-2xl font-bold text-slate-900">{flag.key}</h1>
        <span class="badge bg-slate-100 text-slate-700">{tr(i18n, KIND_LABEL[flag.kind])}</span>
        {flag.archived && (
          <span class="badge bg-slate-100 text-slate-600">{tr(i18n, "project.archivedBadge")}</span>
        )}
      </div>

      {/* Definition */}
      <section class="mt-6 card p-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "flag.definitionTitle")}</h2>
        <form class="mt-4 space-y-4" preventdefault:submit onSubmit$={saveDefinition}>
          {def.error && (
            <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{def.error}</div>
          )}
          {def.saved && (
            <div class="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{tr(i18n, "common.saved")}</div>
          )}
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="dname">{tr(i18n, "common.name")}</label>
              <input id="dname" type="text" class="input" value={def.name} onInput$={(_, el) => (def.name = el.value)} />
            </div>
            <div>
              <label class="label" for="dkind">{tr(i18n, "project.flagKind")}</label>
              <select id="dkind" class="input" value={def.kind} onChange$={(_, el) => (def.kind = el.value as FlagKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k} selected={k === def.kind}>{tr(i18n, KIND_LABEL[k])}</option>
                ))}
              </select>
              {kindChanged && <p class="mt-1 text-xs text-amber-700">{tr(i18n, "flag.kindChangeWarning")}</p>}
            </div>
          </div>
          <div>
            <label class="label" for="ddesc">{tr(i18n, "common.description")}</label>
            <textarea id="ddesc" class="input" rows={2} value={def.description} onInput$={(_, el) => (def.description = el.value)} />
          </div>
          <div>
            <label class="label" for="ddefault">{tr(i18n, "project.defaultValue")}</label>
            {def.kind === "boolean" ? (
              <p class="text-sm text-slate-500">{tr(i18n, "project.booleanDefaultNote")}</p>
            ) : def.kind === "json" ? (
              <textarea id="ddefault" class="input font-mono" rows={4} value={def.defaultValue} onInput$={(_, el) => (def.defaultValue = el.value)} />
            ) : (
              <input
                id="ddefault"
                type={def.kind === "number" ? "number" : "text"}
                step="any"
                class="input"
                value={def.defaultValue}
                onInput$={(_, el) => (def.defaultValue = el.value)}
              />
            )}
          </div>
          <div>
            <label class="label" for="dtags">{tr(i18n, "project.tags")}</label>
            <input id="dtags" type="text" class="input" value={def.tags} onInput$={(_, el) => (def.tags = el.value)} />
            <p class="mt-1 text-xs text-slate-400">{tr(i18n, "project.tagsHint")}</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={def.archived} onChange$={(_, el) => (def.archived = el.checked)} />
            {tr(i18n, "flag.archived")}
          </label>
          <div class="flex justify-end">
            <button type="submit" class="btn-primary" disabled={def.saving}>
              {def.saving ? tr(i18n, "common.saving") : tr(i18n, "common.save")}
            </button>
          </div>
        </form>
      </section>

      {/* Per-environment states */}
      <section class="mt-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "flag.envTitle")}</h2>
        <p class="text-sm text-slate-500">{tr(i18n, "flag.envBody")}</p>
        <div class="mt-4 grid gap-4 md:grid-cols-3">
          {envKeys.map((envKey) => {
            const form = envForms[envKey];
            const env = state.envs.find((e) => e.key === envKey);
            if (!form) return null;
            return (
              <div key={envKey} class="card flex flex-col p-5">
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-slate-900">{env?.name || envKey}</h3>
                  <Switch
                    checked={form.enabled}
                    label={tr(i18n, "project.toggleLabel", { flag: flag.key, env: envKey })}
                    onToggle$={(next) => {
                      form.enabled = next;
                      form.saved = false;
                    }}
                  />
                </div>
                <p class="mt-0.5 font-mono text-xs text-slate-400">{envKey}</p>

                {flag.kind !== "boolean" && (
                  <div class="mt-4">
                    <label class="label" for={`v-${envKey}`}>{tr(i18n, "flag.value")}</label>
                    {flag.kind === "json" ? (
                      <textarea
                        id={`v-${envKey}`}
                        class="input font-mono text-xs"
                        rows={4}
                        value={form.value}
                        onInput$={(_, el) => (form.value = el.value)}
                      />
                    ) : (
                      <input
                        id={`v-${envKey}`}
                        type={flag.kind === "number" ? "number" : "text"}
                        step="any"
                        class="input"
                        value={form.value}
                        onInput$={(_, el) => (form.value = el.value)}
                      />
                    )}
                    <p class="mt-1 text-xs text-slate-400">{tr(i18n, "flag.valueHint")}</p>
                  </div>
                )}

                <div class="mt-4">
                  <label class="label" for={`r-${envKey}`}>
                    {tr(i18n, "flag.rollout")} · <span class="font-mono">{form.rollout}%</span>
                  </label>
                  <input
                    id={`r-${envKey}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    class="w-full accent-primary-600"
                    value={form.rollout}
                    onInput$={(_, el) => (form.rollout = Number(el.value))}
                  />
                  <p class="mt-1 text-xs text-slate-400">{tr(i18n, "flag.rolloutHint")}</p>
                </div>

                {form.error && (
                  <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{form.error}</div>
                )}
                {form.saved && (
                  <div class="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">{tr(i18n, "common.saved")}</div>
                )}
                <button
                  type="button"
                  class="btn-primary mt-4"
                  disabled={form.saving}
                  onClick$={() => saveState(envKey)}
                >
                  {form.saving ? tr(i18n, "common.saving") : tr(i18n, "flag.saveState", { env: envKey })}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Preview evaluation */}
      <section class="mt-6 card p-6">
        <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "flag.previewTitle")}</h2>
        <p class="text-sm text-slate-500">{tr(i18n, "flag.previewBody")}</p>
        <form class="mt-4 flex flex-wrap items-end gap-3" preventdefault:submit onSubmit$={runPreview}>
          <div>
            <label class="label" for="penv">{tr(i18n, "flag.environment")}</label>
            <select id="penv" class="input" value={preview.env} onChange$={(_, el) => (preview.env = el.value)}>
              {envKeys.map((k) => (
                <option key={k} value={k} selected={k === preview.env}>{k}</option>
              ))}
            </select>
          </div>
          <div class="flex-1">
            <label class="label" for="pdid">{tr(i18n, "flag.distinctId")}</label>
            <input
              id="pdid"
              type="text"
              class="input font-mono"
              placeholder={tr(i18n, "flag.distinctIdPlaceholder")}
              value={preview.distinctId}
              onInput$={(_, el) => (preview.distinctId = el.value)}
            />
          </div>
          <button type="submit" class="btn-secondary" disabled={preview.running}>
            {preview.running ? tr(i18n, "common.loading") : tr(i18n, "flag.runPreview")}
          </button>
        </form>
        {preview.error && (
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{preview.error}</div>
        )}
        {preview.result && (
          <div class="mt-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "flag.previewResult")}</div>
            {previewEntry ? (
              <div class="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span class="font-mono">{flag.key}</span>
                <span class={["badge", previewEntry.enabled ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"]}>
                  {previewEntry.enabled ? tr(i18n, "common.on") : tr(i18n, "common.off")}
                </span>
                <code class="font-mono text-xs text-slate-700">{JSON.stringify(previewEntry.value)}</code>
              </div>
            ) : (
              <p class="mt-2 text-sm text-slate-500">{tr(i18n, "project.archivedBadge")}</p>
            )}
            <details class="mt-3">
              <summary class="cursor-pointer text-xs text-slate-500">{tr(i18n, "flag.previewAll")}</summary>
              <pre class="mt-2 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs"><code>{JSON.stringify(preview.result, null, 2)}</code></pre>
            </details>
          </div>
        )}
      </section>

      {/* Delete */}
      <section class="mt-6 card border-red-200 p-6">
        <h2 class="text-lg font-semibold text-red-700">{tr(i18n, "flag.deleteTitle")}</h2>
        <p class="mt-1 text-sm text-slate-600">{tr(i18n, "flag.deleteBody")}</p>
        {del.error && (
          <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{del.error}</div>
        )}
        <form class="mt-4 flex flex-wrap items-end gap-3" preventdefault:submit onSubmit$={deleteFlag}>
          <div class="flex-1">
            <label class="label" for="dconfirm">{tr(i18n, "flag.deleteConfirm")}</label>
            <input
              id="dconfirm"
              type="text"
              class="input font-mono"
              placeholder={flag.key}
              value={del.confirm}
              onInput$={(_, el) => (del.confirm = el.value)}
            />
          </div>
          <button
            type="submit"
            class="btn bg-red-600 text-white hover:bg-red-700"
            disabled={del.deleting || del.confirm !== flag.key}
          >
            {del.deleting ? tr(i18n, "common.deleting") : tr(i18n, "flag.deleteButton")}
          </button>
        </form>
      </section>
    </div>
  );
});

export const head: DocumentHead = ({ params }) => ({ title: `${params.flag} — exp` });
