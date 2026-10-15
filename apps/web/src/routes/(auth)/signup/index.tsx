import { component$, useContext, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../lib/api";
import { setTokens, isAuthenticated } from "../../../lib/auth";
import { identify, capture } from "../../../lib/analytics";
import { FeaturesContext } from "../../../lib/features";
import { PLANS, fmtLimit } from "../../../lib/plans";
import { tr, useI18n } from "../../../i18n";

export default component$(() => {
  const nav = useNavigate();
  const i18n = useI18n();
  // Public features are resolved by the root layout (server-side), so the
  // invite-only state renders without a client round-trip.
  const features = useContext(FeaturesContext);
  const state = useStore({
    email: "",
    password: "",
    accountName: "",
    loading: false,
    error: "",
  });

  // Already signed in? Skip straight to the dashboard.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    if (isAuthenticated()) nav("/dashboard");
  });

  // Resolved during render so the handler captures a string, not the store.
  const msgSignupFailed = tr(i18n, "auth.signupFailed");

  const submit = $(async () => {
    state.error = "";
    state.loading = true;
    try {
      const res = await api.register(
        state.email,
        state.password,
        state.accountName || undefined,
      );
      setTokens(res.access_token, res.refresh_token);
      identify(res.user.id, res.account.id, res.account.plan);
      capture("signup", { plan: res.account.plan });
      await nav("/dashboard");
    } catch (e) {
      state.error = e instanceof ApiRequestError ? e.error.message : msgSignupFailed;
    } finally {
      state.loading = false;
    }
  });

  if (!features.signups) {
    return (
      <div class="card p-8 text-center">
        <h1 class="text-2xl font-bold text-slate-900">
          {tr(i18n, "auth.inviteOnlyTitle")}
        </h1>
        <p class="mt-3 text-sm text-slate-500">
          {tr(i18n, "auth.inviteOnlyBody")}
        </p>
        <p class="mt-6 text-sm text-slate-500">
          {tr(i18n, "auth.haveAccount")}{" "}
          <Link href="/login" class="font-medium text-primary-600 hover:underline">
            {tr(i18n, "auth.logIn")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div class="card p-8">
      <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "auth.signupTitle")}</h1>
      <p class="mt-1 text-sm text-slate-500">
        {features["early-access"]
          ? tr(i18n, "auth.earlyAccessPitch")
          : tr(i18n, "auth.freePitch", {
              projects: fmtLimit(PLANS.free.projects, i18n),
              flags: fmtLimit(PLANS.free.flags_per_project, i18n),
              evals: fmtLimit(PLANS.free.evaluations_per_month, i18n),
            })}
      </p>

      <form class="mt-6 space-y-4" preventdefault:submit onSubmit$={submit}>
        {state.error && (
          <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}
        <div>
          <label class="label" for="accountName">
            {tr(i18n, "auth.workspaceName")}{" "}
            <span class="text-slate-400">{tr(i18n, "common.optional")}</span>
          </label>
          <input
            id="accountName"
            type="text"
            class="input"
            placeholder={tr(i18n, "auth.workspacePlaceholder")}
            value={state.accountName}
            onInput$={(_, el) => (state.accountName = el.value)}
          />
        </div>
        <div>
          <label class="label" for="email">
            {tr(i18n, "common.email")}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            class="input"
            value={state.email}
            onInput$={(_, el) => (state.email = el.value)}
          />
        </div>
        <div>
          <label class="label" for="password">
            {tr(i18n, "common.password")}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            class="input"
            value={state.password}
            onInput$={(_, el) => (state.password = el.value)}
          />
          <p class="mt-1 text-xs text-slate-400">{tr(i18n, "auth.passwordHint")}</p>
        </div>
        <button type="submit" class="btn-primary w-full" disabled={state.loading}>
          {state.loading ? tr(i18n, "auth.creatingAccount") : tr(i18n, "auth.createAccount")}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-slate-500">
        {tr(i18n, "auth.haveAccount")}{" "}
        <Link href="/login" class="font-medium text-primary-600 hover:underline">
          {tr(i18n, "auth.logIn")}
        </Link>
      </p>
    </div>
  );
});

export const head: DocumentHead = { title: "Sign up — exp" };
