import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../lib/api";
import { capture } from "../../../../../lib/analytics";
import { errorMessage, isLimitError } from "../../../../../lib/errors";
import { KINDS, KIND_LABEL, RESERVED_FLAG_KEYS, parseValue, previewValue } from "../../../../../lib/flag-values";
import { FeaturesContext } from "../../../../../lib/features";
import { Modal } from "../../../../../components/modal";
import { Switch } from "../../../../../components/switch";
import { tr, useI18n } from "../../../../../i18n";
import type { CopyResult, Flag, FlagKind, OnConflict, Project } from "../../../../../lib/types";

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const id = loc.params.id;

  const state = useStore<{
    project: Project | null;
    flags: Flag[];
    total: number;
    loading: boolean;
    loadError: string;
    q: string;
    includeArchived: boolean;
    toggleError: string;
    /** `${flagId}:${envKey}` while a PUT is in flight. */
    busy: string;
    selected: string[];
  }>({
    project: null,
    flags: [],
    total: 0,
    loading: true,
    loadError: "",
    q: "",
    includeArchived: false,
    toggleError: "",
    busy: "",
    selected: [],
  });

  const create = useStore({
    open: false,
    key: "",
    name: "",
    description: "",
    kind: "boolean" as FlagKind,
    defaultValue: "",
    tags: "",
    submitting: false,
    error: "",
    limitReached: false,
  });

  const copy = useStore<{
    open: boolean;
    targets: Project[];
    targetId: string;
    which: "all" | "selected";
    includeStates: boolean;
    onConflict: OnConflict;
    running: boolean;
    error: string;
    limitReached: boolean;
    result: CopyResult | null;
  }>({
    open: false,
    targets: [],
    targetId: "",
    which: "all",
    includeStates: true,
    onConflict: "skip",
    running: false,
    error: "",
    limitReached: false,
    result: null,
  });

  const loadFlags = $(async () => {
    try {
      const res = await api.listFlags(id, {
        q: state.q.trim(),
        include_archived: state.includeArchived,
        per_page: 100,
      });
      state.flags = res.items;
      state.total = res.total;
      state.loadError = "";
    } catch (e) {
      state.loadError = errorMessage(i18n, e, "project.loadFailed");
    }
  });

  const load = $(async () => {
    state.loading = true;
    state.loadError = "";
    try {
      state.project = await api.getProject(id);
      await loadFlags();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "project.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  // Debounced server-side search; archived filter reloads immediately.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    track(() => state.q);
    track(() => state.includeArchived);
    if (state.loading) return;
    const t = setTimeout(() => loadFlags(), 250);
    cleanup(() => clearTimeout(t));
  });

  const toggle = $(async (flag: Flag, envKey: string, enabled: boolean) => {
    const key = `${flag.id}:${envKey}`;
    state.busy = key;
    state.toggleError = "";
    try {
      const updated = await api.setFlagState(id, flag.id, envKey, { enabled });
      state.flags = state.flags.map((f) => (f.id === updated.id ? updated : f));
      capture("flag_state_toggled", { enabled, environment: envKey });
    } catch (e) {
      state.toggleError = errorMessage(i18n, e, "project.toggleFailed");
    } finally {
      state.busy = "";
    }
  });

  const createFlag = $(async () => {
    create.error = "";
    create.limitReached = false;
    // Mirrors the API's 400 reserved_key: these would shadow /flags/copy and /flags/evaluate.
    if (RESERVED_FLAG_KEYS.includes(create.key.trim())) {
      create.error = tr(i18n, "project.reservedKey");
      return;
    }
    const parsed = create.kind === "boolean" ? { ok: true as const, value: true } : parseValue(create.kind, create.defaultValue);
    if (!parsed.ok) {
      create.error = tr(i18n, parsed.error);
      return;
    }
    create.submitting = true;
    try {
      const flag = await api.createFlag(id, {
        key: create.key.trim(),
        name: create.name.trim() || undefined,
        description: create.description.trim() || undefined,
        kind: create.kind,
        default_value: parsed.value ?? undefined,
        tags: create.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      capture("flag_created", { kind: create.kind });
      create.open = false;
      create.key = "";
      create.name = "";
      create.description = "";
      create.defaultValue = "";
      create.tags = "";
      state.flags = [...state.flags, flag].sort((a, b) => a.key.localeCompare(b.key));
      state.total += 1;
      if (state.project) state.project.flag_count += 1;
    } catch (e) {
      create.limitReached = isLimitError(e);
      create.error = errorMessage(i18n, e, "project.createFailed");
    } finally {
      create.submitting = false;
    }
  });

  const openCopy = $(async () => {
    copy.open = true;
    copy.result = null;
    copy.error = "";
    copy.which = state.selected.length ? "selected" : "all";
    try {
      const res = await api.listProjects();
      copy.targets = res.items.filter((p) => p.id !== id);
      if (!copy.targets.some((p) => p.id === copy.targetId)) copy.targetId = copy.targets[0]?.id ?? "";
    } catch (e) {
      copy.error = errorMessage(i18n, e, "copy.failed");
    }
  });

  const runCopy = $(async () => {
    if (!copy.targetId) return;
    copy.running = true;
    copy.error = "";
    copy.limitReached = false;
    try {
      copy.result = await api.copyFlags(id, {
        target_project_id: copy.targetId,
        flag_keys: copy.which === "selected" ? state.selected : undefined,
        include_states: copy.includeStates,
        on_conflict: copy.onConflict,
      });
      capture("flags_copied", { copied: copy.result.copied.length, overwritten: copy.result.overwritten.length });
    } catch (e) {
      copy.limitReached = isLimitError(e);
      copy.error = errorMessage(i18n, e, "copy.failed");
    } finally {
      copy.running = false;
    }
  });

  const toggleSelected = $((key: string, on: boolean) => {
    state.selected = on ? [...state.selected, key] : state.selected.filter((k) => k !== key);
  });

  const envs = state.project?.environments ?? [];
  const canCopy = features["flag-copy"];

  if (state.loading) {
    return (
      <div class="mx-auto max-w-6xl px-4 py-8">
        <div class="card p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
      </div>
    );
  }

  if (!state.project) {
    return (
      <div class="mx-auto max-w-6xl px-4 py-8">
        <Link href="/dashboard" class="text-sm text-slate-500 hover:text-primary-600">
          {tr(i18n, "project.back")}
        </Link>
        <div class="mt-4 card p-10 text-center text-sm text-red-600">
          {state.loadError || tr(i18n, "project.loadFailed")}
        </div>
      </div>
    );
  }

  return (
    <div class="mx-auto max-w-6xl px-4 py-8">
      <Link href="/dashboard" class="text-sm text-slate-500 hover:text-primary-600">
        {tr(i18n, "project.back")}
      </Link>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">{state.project.name}</h1>
          <p class="text-sm text-slate-500">
            <span class="font-mono">{state.project.key}</span>
            {state.project.description && <> · {state.project.description}</>}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Link href={`/dashboard/projects/${id}/settings`} class="btn-secondary">
            {tr(i18n, "project.settings")}
          </Link>
          {canCopy && (
            <button type="button" class="btn-secondary" onClick$={openCopy}>
              {tr(i18n, "project.copyFlags")}
            </button>
          )}
          <button type="button" class="btn-primary" onClick$={() => (create.open = true)}>
            {tr(i18n, "project.newFlag")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div class="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          class="input sm:max-w-sm"
          placeholder={tr(i18n, "project.searchPlaceholder")}
          aria-label={tr(i18n, "common.search")}
          value={state.q}
          onInput$={(_, el) => (state.q = el.value)}
        />
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={state.includeArchived}
            onChange$={(_, el) => (state.includeArchived = el.checked)}
          />
          {tr(i18n, "project.showArchived")}
        </label>
        <span class="ml-auto text-xs text-slate-400">{tr(i18n, "project.pageOf", { total: state.total })}</span>
      </div>

      {state.toggleError && (
        <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.toggleError}
        </div>
      )}

      {/* Flags table */}
      <div class="mt-4 card overflow-hidden">
        {state.loadError ? (
          <div class="p-10 text-center text-sm text-red-600">{state.loadError}</div>
        ) : state.flags.length === 0 ? (
          <div class="p-10 text-center text-sm text-slate-500">
            {state.q || state.includeArchived ? tr(i18n, "project.noMatch") : tr(i18n, "project.empty")}
          </div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {canCopy && <th class="w-8 px-3 py-3"></th>}
                  <th class="px-4 py-3">{tr(i18n, "project.colKey")}</th>
                  <th class="px-4 py-3">{tr(i18n, "project.colName")}</th>
                  <th class="px-4 py-3">{tr(i18n, "project.colKind")}</th>
                  <th class="px-4 py-3">{tr(i18n, "project.colTags")}</th>
                  {envs.map((env) => (
                    <th key={env.id} class="px-4 py-3 text-center">{env.name || env.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {state.flags.map((f) => (
                  <tr key={f.id} class={["hover:bg-slate-50", f.archived ? "opacity-60" : ""]}>
                    {canCopy && (
                      <td class="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={f.key}
                          checked={state.selected.includes(f.key)}
                          onChange$={(_, el) => toggleSelected(f.key, el.checked)}
                        />
                      </td>
                    )}
                    <td class="px-4 py-3">
                      <Link
                        href={`/dashboard/projects/${id}/flags/${f.id}`}
                        class="font-mono font-medium text-primary-600 hover:underline"
                      >
                        {f.key}
                      </Link>
                      {f.archived && (
                        <span class="badge ml-2 bg-slate-100 text-slate-600">{tr(i18n, "project.archivedBadge")}</span>
                      )}
                    </td>
                    <td class="max-w-xs truncate px-4 py-3 text-slate-700">{f.name || "—"}</td>
                    <td class="px-4 py-3">
                      <span class="badge bg-slate-100 text-slate-700">{tr(i18n, KIND_LABEL[f.kind])}</span>
                      {f.kind !== "boolean" && (
                        <span class="ml-2 font-mono text-xs text-slate-400">{previewValue(f.default_value)}</span>
                      )}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-1">
                        {f.tags.map((t) => (
                          <span key={t} class="badge bg-primary-50 text-primary-700">{t}</span>
                        ))}
                      </div>
                    </td>
                    {envs.map((env) => {
                      const st = f.states[env.key];
                      const busy = state.busy === `${f.id}:${env.key}`;
                      return (
                        <td key={env.id} class="px-4 py-3 text-center">
                          {st ? (
                            <div class="inline-flex flex-col items-center gap-0.5">
                              <Switch
                                small
                                checked={st.enabled}
                                disabled={busy || f.archived}
                                label={tr(i18n, "project.toggleLabel", { flag: f.key, env: env.key })}
                                onToggle$={(next) => toggle(f, env.key, next)}
                              />
                              {st.enabled && st.rollout_percent < 100 && (
                                <span class="text-[10px] font-medium text-primary-600">{st.rollout_percent}%</span>
                              )}
                            </div>
                          ) : (
                            <span class="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create flag dialog */}
      <Modal open={create.open} title={tr(i18n, "project.createFlag")} onClose$={() => (create.open = false)}>
        <form class="space-y-4" preventdefault:submit onSubmit$={createFlag}>
          {create.error && (
            <div
              class={[
                "rounded-lg border px-3 py-2 text-sm",
                create.limitReached
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-red-200 bg-red-50 text-red-700",
              ]}
            >
              {create.error}{" "}
              {create.limitReached && features.billing && !features["early-access"] && (
                <Link href="/dashboard/billing" class="font-semibold underline">
                  {tr(i18n, "limit.upgrade")}
                </Link>
              )}
            </div>
          )}
          <div>
            <label class="label" for="fkey">{tr(i18n, "project.flagKey")}</label>
            <input
              id="fkey"
              type="text"
              required
              class="input font-mono"
              pattern="[a-z0-9][a-z0-9_-]{0,98}"
              placeholder={tr(i18n, "project.flagKeyPlaceholder")}
              value={create.key}
              onInput$={(_, el) => (create.key = el.value)}
            />
            <p class="mt-1 text-xs text-slate-400">{tr(i18n, "project.flagKeyHint")}</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="fname">
                {tr(i18n, "project.flagName")}{" "}
                <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
              </label>
              <input
                id="fname"
                type="text"
                class="input"
                value={create.name}
                onInput$={(_, el) => (create.name = el.value)}
              />
            </div>
            <div>
              <label class="label" for="fkind">{tr(i18n, "project.flagKind")}</label>
              <select
                id="fkind"
                class="input"
                value={create.kind}
                onChange$={(_, el) => (create.kind = el.value as FlagKind)}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k} selected={k === create.kind}>{tr(i18n, KIND_LABEL[k])}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label class="label" for="fdefault">{tr(i18n, "project.defaultValue")}</label>
            {create.kind === "boolean" ? (
              <p class="text-sm text-slate-500">{tr(i18n, "project.booleanDefaultNote")}</p>
            ) : create.kind === "json" ? (
              <textarea
                id="fdefault"
                class="input font-mono"
                rows={4}
                placeholder="{}"
                value={create.defaultValue}
                onInput$={(_, el) => (create.defaultValue = el.value)}
              />
            ) : (
              <input
                id="fdefault"
                type={create.kind === "number" ? "number" : "text"}
                step="any"
                class="input"
                value={create.defaultValue}
                onInput$={(_, el) => (create.defaultValue = el.value)}
              />
            )}
            {create.kind !== "boolean" && (
              <p class="mt-1 text-xs text-slate-400">{tr(i18n, "project.defaultValueHint")}</p>
            )}
          </div>
          <div>
            <label class="label" for="ftags">
              {tr(i18n, "project.tags")}{" "}
              <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
            </label>
            <input
              id="ftags"
              type="text"
              class="input"
              placeholder="checkout, experiment"
              value={create.tags}
              onInput$={(_, el) => (create.tags = el.value)}
            />
            <p class="mt-1 text-xs text-slate-400">{tr(i18n, "project.tagsHint")}</p>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary" onClick$={() => (create.open = false)}>
              {tr(i18n, "common.cancel")}
            </button>
            <button type="submit" class="btn-primary" disabled={create.submitting}>
              {create.submitting ? tr(i18n, "common.creating") : tr(i18n, "project.createFlag")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Copy flags dialog */}
      <Modal open={copy.open} title={tr(i18n, "copy.title")} onClose$={() => (copy.open = false)}>
        {copy.result ? (
          <div>
            <p class="font-semibold text-slate-900">{tr(i18n, "copy.resultTitle")}</p>
            <ul class="mt-3 space-y-2 text-sm">
              <li class="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800">
                <span>{tr(i18n, "copy.copied", { n: copy.result.copied.length })}</span>
                <span class="font-mono text-xs">{copy.result.copied.join(", ")}</span>
              </li>
              <li class="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                <span>{tr(i18n, "copy.overwritten", { n: copy.result.overwritten.length })}</span>
                <span class="font-mono text-xs">{copy.result.overwritten.join(", ")}</span>
              </li>
              <li class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                <span>{tr(i18n, "copy.skipped", { n: copy.result.skipped.length })}</span>
                <span class="font-mono text-xs">{copy.result.skipped.join(", ")}</span>
              </li>
            </ul>
            <div class="mt-4 flex justify-end gap-2">
              <button type="button" class="btn-secondary" onClick$={() => (copy.open = false)}>
                {tr(i18n, "common.close")}
              </button>
              <Link href={`/dashboard/projects/${copy.result.target_project_id}`} class="btn-primary">
                {tr(i18n, "copy.openTarget")}
              </Link>
            </div>
          </div>
        ) : (
          <form class="space-y-4" preventdefault:submit onSubmit$={runCopy}>
            <p class="text-sm text-slate-600">{tr(i18n, "copy.intro")}</p>
            {copy.error && (
              <div
                class={[
                  "rounded-lg border px-3 py-2 text-sm",
                  copy.limitReached
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-red-200 bg-red-50 text-red-700",
                ]}
              >
                {copy.error}
              </div>
            )}
            {copy.targets.length === 0 ? (
              <p class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {tr(i18n, "copy.noTargets")}
              </p>
            ) : (
              <>
                <div>
                  <label class="label" for="ctarget">{tr(i18n, "copy.target")}</label>
                  <select
                    id="ctarget"
                    class="input"
                    value={copy.targetId}
                    onChange$={(_, el) => (copy.targetId = el.value)}
                  >
                    {copy.targets.map((p) => (
                      <option key={p.id} value={p.id} selected={p.id === copy.targetId}>
                        {`${p.name} (${p.key})`}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset>
                  <legend class="label">{tr(i18n, "copy.which")}</legend>
                  <label class="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="which" checked={copy.which === "all"} onChange$={() => (copy.which = "all")} />
                    {tr(i18n, "copy.all")}
                  </label>
                  <label class="mt-1 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="which"
                      disabled={state.selected.length === 0}
                      checked={copy.which === "selected"}
                      onChange$={() => (copy.which = "selected")}
                    />
                    {tr(i18n, "copy.selected", { n: state.selected.length })}
                  </label>
                  {state.selected.length === 0 && (
                    <p class="mt-1 text-xs text-slate-400">{tr(i18n, "copy.selectHint")}</p>
                  )}
                </fieldset>
                <label class="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={copy.includeStates}
                    onChange$={(_, el) => (copy.includeStates = el.checked)}
                  />
                  <span>
                    {tr(i18n, "copy.includeStates")}
                    <span class="block text-xs text-slate-400">{tr(i18n, "copy.includeStatesHint")}</span>
                  </span>
                </label>
                <fieldset>
                  <legend class="label">{tr(i18n, "copy.onConflict")}</legend>
                  <label class="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="conflict" checked={copy.onConflict === "skip"} onChange$={() => (copy.onConflict = "skip")} />
                    {tr(i18n, "copy.skip")}
                  </label>
                  <label class="mt-1 flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="conflict" checked={copy.onConflict === "overwrite"} onChange$={() => (copy.onConflict = "overwrite")} />
                    {tr(i18n, "copy.overwrite")}
                  </label>
                </fieldset>
              </>
            )}
            <div class="flex justify-end gap-2">
              <button type="button" class="btn-secondary" onClick$={() => (copy.open = false)}>
                {tr(i18n, "common.cancel")}
              </button>
              <button type="submit" class="btn-primary" disabled={copy.running || !copy.targetId}>
                {copy.running ? tr(i18n, "copy.running") : tr(i18n, "copy.run")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
});

export const head: DocumentHead = { title: "Flags — exp" };
