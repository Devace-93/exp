import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { profileUrl } from "../../../../lib/auth";
import { api, ApiRequestError } from "../../../../lib/api";
import { errorMessage, isLimitError } from "../../../../lib/errors";
import { FeaturesContext } from "../../../../lib/features";
import { tr, useI18n } from "../../../../i18n";
import type { ApiKey, ApiKeyRole, AuditEvent, RoleInfo } from "../../../../lib/types";
import roleRegistry from "../../../../../../../packages/shared/api_key_roles.json";

// Shared registry as the fallback until GET /apikeys/roles answers.
const REGISTRY_ROLES = roleRegistry.roles as Record<ApiKeyRole, RoleInfo>;
const REGISTRY_DEFAULT = roleRegistry.default_role as ApiKeyRole;

const AUDIT_ACTIONS = [
  "project.create", "project.update", "project.delete",
  "environment.create", "environment.update", "environment.delete", "environment.rotate_key",
  "flag.create", "flag.update", "flag.delete", "flag.copy",
  "flag_state.update",
  "apikey.create", "apikey.revoke",
  "auth.denied",
];

const OUTCOME_CLASS: Record<string, string> = {
  ok: "bg-green-100 text-green-800",
  denied: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
};

export default component$(() => {
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const state = useStore<{
    keys: ApiKey[];
    roles: Record<ApiKeyRole, RoleInfo>;
    loading: boolean;
    error: string;
    limitReached: boolean;
    newName: string;
    newRole: ApiKeyRole;
    roleTouched: boolean;
    creating: boolean;
    createdSecret: string; // shown once
    copied: boolean;
  }>({
    keys: [],
    roles: REGISTRY_ROLES,
    loading: true,
    error: "",
    limitReached: false,
    newName: "",
    newRole: REGISTRY_DEFAULT,
    roleTouched: false,
    creating: false,
    createdSecret: "",
    copied: false,
  });

  const audit = useStore<{
    items: AuditEvent[];
    loading: boolean;
    error: string;
    action: string;
  }>({ items: [], loading: true, error: "", action: "" });

  const loadAudit = $(async () => {
    audit.loading = true;
    audit.error = "";
    try {
      const res = await api.audit(50, audit.action);
      audit.items = res.items;
    } catch (e) {
      audit.error = errorMessage(i18n, e, "audit.loadFailed");
    } finally {
      audit.loading = false;
    }
  });

  const load = $(async () => {
    state.loading = true;
    state.error = "";
    try {
      const [keys, roles] = await Promise.all([
        api.listApiKeys(),
        api.apiKeyRoles().catch(() => null),
      ]);
      state.keys = keys;
      if (roles) {
        state.roles = roles.roles;
        // Do not clobber a role the user already picked while roles were loading.
        if (!state.roleTouched) state.newRole = roles.default_role;
      }
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.error = errorMessage(i18n, e, "keys.loadFailed");
    } finally {
      state.loading = false;
    }
    loadAudit();
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const create = $(async () => {
    if (!state.newName.trim()) return;
    state.creating = true;
    state.error = "";
    state.limitReached = false;
    try {
      const res = await api.createApiKey(state.newName.trim(), state.newRole);
      state.createdSecret = res.key;
      state.newName = "";
      load();
    } catch (e) {
      state.limitReached = isLimitError(e);
      state.error = errorMessage(i18n, e, "keys.createFailed");
    } finally {
      state.creating = false;
    }
  });

  const revoke = $(async (id: string) => {
    if (!confirm(tr(i18n, "keys.revokeConfirm"))) return;
    try {
      await api.deleteApiKey(id);
      state.keys = state.keys.filter((k) => k.id !== id);
      loadAudit();
    } catch (e) {
      state.error = errorMessage(i18n, e, "keys.revokeFailed");
    }
  });

  const copySecret = $(async () => {
    try {
      await navigator.clipboard.writeText(state.createdSecret);
      state.copied = true;
      setTimeout(() => (state.copied = false), 1500);
    } catch {
      /* ignore */
    }
  });

  const roleKeys = Object.keys(state.roles) as ApiKeyRole[];
  const currentRole = state.roles[state.newRole] ?? REGISTRY_ROLES[REGISTRY_DEFAULT];

  return (
    <div class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "keys.title")}</h1>
      {/* Identity (e-mail, password, avatar, linked logins) is managed at accounts. */}
      <p class="mt-2 text-sm text-slate-500">
        <a href={profileUrl()} class="font-medium text-primary-600 hover:underline" data-testid="profile-link">
          {tr(i18n, "nav.profile")} →
        </a>
      </p>

      {!features["public-api"] ? (
        <div class="mt-6 card p-8 text-slate-600">
          <p class="font-medium text-slate-800">{tr(i18n, "keys.unavailableTitle")}</p>
          <p class="mt-2 text-sm">{tr(i18n, "keys.unavailableBody")}</p>
        </div>
      ) : (
        <>
          <p class="mt-1 text-sm text-slate-500">
            {tr(i18n, "keys.usage")}{" "}
            <code class="rounded bg-slate-100 px-1.5 py-0.5 text-xs">X-API-Key: exp_live_…</code>
          </p>

          {state.error && (
            <div
              class={[
                "mt-4 rounded-lg border px-3 py-2 text-sm",
                state.limitReached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700",
              ]}
            >
              {state.error}{" "}
              {state.limitReached && features.billing && !features["early-access"] && (
                <Link href="/dashboard/billing" class="font-semibold underline">{tr(i18n, "limit.upgrade")}</Link>
              )}
            </div>
          )}

          {/* Secret shown once after creation */}
          {state.createdSecret && (
            <div class="mt-4 rounded-lg border border-green-300 bg-green-50 p-4">
              <p class="text-sm font-semibold text-green-800">{tr(i18n, "keys.copyNow")}</p>
              <div class="mt-2 flex items-center gap-2">
                <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-sm text-slate-800">
                  {state.createdSecret}
                </code>
                <button type="button" class="btn-secondary" onClick$={copySecret}>
                  {state.copied ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                </button>
              </div>
              <button type="button" class="btn-ghost mt-2 text-xs" onClick$={() => (state.createdSecret = "")}>
                {tr(i18n, "common.dismiss")}
              </button>
            </div>
          )}

          {/* Create form */}
          <form class="mt-6 flex flex-wrap items-end gap-3" preventdefault:submit onSubmit$={create}>
            <div class="min-w-[12rem] flex-1">
              <label class="label" for="keyname">{tr(i18n, "keys.newKeyName")}</label>
              <input
                id="keyname"
                type="text"
                placeholder={tr(i18n, "keys.namePlaceholder")}
                class="input"
                value={state.newName}
                onInput$={(_, el) => (state.newName = el.value)}
              />
            </div>
            <div>
              <label class="label" for="keyrole">{tr(i18n, "common.role")}</label>
              <select
                id="keyrole"
                class="input"
                value={state.newRole}
                onChange$={(_, el) => {
                  state.newRole = el.value as ApiKeyRole;
                  state.roleTouched = true;
                }}
              >
                {roleKeys.map((r) => (
                  <option key={r} value={r} selected={r === state.newRole}>
                    {state.roles[r].label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" class="btn-primary" disabled={state.creating}>
              {state.creating ? tr(i18n, "common.creating") : tr(i18n, "keys.createKey")}
            </button>
          </form>
          <p class="mt-2 text-xs text-slate-500">
            {currentRole.description}{" "}
            <span class="font-mono">({currentRole.scopes.join(", ")})</span>
          </p>

          {/* List */}
          <div class="mt-6 card overflow-hidden">
            {state.loading ? (
              <div class="p-8 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
            ) : state.keys.length === 0 ? (
              <div class="p-8 text-center text-sm text-slate-500">{tr(i18n, "keys.empty")}</div>
            ) : (
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th class="px-4 py-3">{tr(i18n, "common.name")}</th>
                      <th class="px-4 py-3">{tr(i18n, "keys.colPrefix")}</th>
                      <th class="px-4 py-3">{tr(i18n, "common.role")}</th>
                      <th class="px-4 py-3">{tr(i18n, "keys.colLastUsed")}</th>
                      <th class="px-4 py-3">{tr(i18n, "common.created")}</th>
                      <th class="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    {state.keys.map((k) => (
                      <tr key={k.id}>
                        <td class="px-4 py-3 font-medium text-slate-800">{k.name || "—"}</td>
                        <td class="px-4 py-3 font-mono text-xs text-slate-600">{k.prefix}…</td>
                        <td class="px-4 py-3">
                          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {state.roles[k.role]?.label ?? k.role}
                          </span>
                        </td>
                        <td class="px-4 py-3 text-slate-500">
                          {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : tr(i18n, "keys.never")}
                        </td>
                        <td class="px-4 py-3 text-slate-500">{new Date(k.created_at).toLocaleDateString()}</td>
                        <td class="px-4 py-3 text-right">
                          <button
                            type="button"
                            class="text-xs font-medium text-red-600 hover:underline"
                            onClick$={() => revoke(k.id)}
                          >
                            {tr(i18n, "keys.revoke")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Audit log */}
      <section class="mt-10">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-xl font-bold text-slate-900">{tr(i18n, "audit.title")}</h2>
            <p class="text-sm text-slate-500">{tr(i18n, "audit.intro")}</p>
          </div>
          <div>
            <label class="label" for="auditaction">{tr(i18n, "audit.filterAction")}</label>
            <select
              id="auditaction"
              class="input"
              value={audit.action}
              onChange$={(_, el) => {
                audit.action = el.value;
                loadAudit();
              }}
            >
              <option value="">{tr(i18n, "audit.allActions")}</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a} selected={a === audit.action}>{a}</option>
              ))}
            </select>
          </div>
        </div>
        <div class="mt-4 card overflow-hidden">
          {audit.loading ? (
            <div class="p-8 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
          ) : audit.error ? (
            <div class="p-8 text-center text-sm text-red-600">{audit.error}</div>
          ) : audit.items.length === 0 ? (
            <div class="p-8 text-center text-sm text-slate-500">{tr(i18n, "audit.empty")}</div>
          ) : (
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-4 py-3">{tr(i18n, "audit.colTime")}</th>
                    <th class="px-4 py-3">{tr(i18n, "audit.colActor")}</th>
                    <th class="px-4 py-3">{tr(i18n, "audit.colAction")}</th>
                    <th class="px-4 py-3">{tr(i18n, "audit.colTarget")}</th>
                    <th class="px-4 py-3">{tr(i18n, "audit.colOutcome")}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {audit.items.map((ev) => (
                    <tr key={ev.id}>
                      <td class="whitespace-nowrap px-4 py-3 text-slate-500" title={ev.ts}>
                        {new Date(ev.ts).toLocaleString()}
                      </td>
                      <td class="px-4 py-3 text-slate-700">
                        <span class="badge mr-1 bg-slate-100 text-slate-600">{ev.actor_type === "system" ? tr(i18n, "audit.system") : ev.actor_type}</span>
                        {ev.actor_label || ev.actor_id || ""}
                      </td>
                      <td class="px-4 py-3 font-mono text-xs text-slate-800">{ev.action}</td>
                      <td class="px-4 py-3 font-mono text-xs text-slate-500">
                        {ev.target_type ? `${ev.target_type} ${ev.target_id ?? ""}`.trim() : "—"}
                      </td>
                      <td class="px-4 py-3">
                        <span class={["badge", OUTCOME_CLASS[ev.outcome] ?? "bg-slate-100 text-slate-700"]}>
                          {ev.outcome === "ok"
                            ? tr(i18n, "audit.outcomeOk")
                            : ev.outcome === "denied"
                              ? tr(i18n, "audit.outcomeDenied")
                              : tr(i18n, "audit.outcomeError")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});

export const head: DocumentHead = { title: "API keys — exp" };
