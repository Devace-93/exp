import { component$, useContext, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../lib/api";
import { setTokens, isAuthenticated } from "../../../lib/auth";
import { identify } from "../../../lib/analytics";
import { FeaturesContext } from "../../../lib/features";
import { tr, useI18n } from "../../../i18n";

/** Login is never gated by a feature; only the sign-up link follows `signups`. */
export default component$(() => {
  const nav = useNavigate();
  const i18n = useI18n();
  const features = useContext(FeaturesContext);
  const state = useStore({
    email: "",
    password: "",
    loading: false,
    error: "",
  });

  // Already signed in? Skip straight to the dashboard.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    if (isAuthenticated()) nav("/dashboard");
  });

  // Resolved during render so the handler captures a string, not the store.
  const msgLoginFailed = tr(i18n, "auth.loginFailed");

  const submit = $(async () => {
    state.error = "";
    state.loading = true;
    try {
      const res = await api.login(state.email, state.password);
      setTokens(res.access_token, res.refresh_token);
      identify(res.user.id, res.account.id, res.account.plan);
      await nav("/dashboard");
    } catch (e) {
      state.error = e instanceof ApiRequestError ? e.error.message : msgLoginFailed;
    } finally {
      state.loading = false;
    }
  });

  return (
    <div class="card p-8">
      <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "auth.loginTitle")}</h1>
      <p class="mt-1 text-sm text-slate-500">{tr(i18n, "auth.loginSubtitle")}</p>

      <form
        class="mt-6 space-y-4"
        preventdefault:submit
        onSubmit$={submit}
      >
        {state.error && (
          <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        )}
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
            autoComplete="current-password"
            class="input"
            value={state.password}
            onInput$={(_, el) => (state.password = el.value)}
          />
        </div>
        <button type="submit" class="btn-primary w-full" disabled={state.loading}>
          {state.loading ? tr(i18n, "auth.loggingIn") : tr(i18n, "auth.loginTitle")}
        </button>
      </form>

      {features.signups && (
        <p class="mt-6 text-center text-sm text-slate-500">
          {tr(i18n, "auth.noAccount")}{" "}
          <Link href="/signup" class="font-medium text-primary-600 hover:underline">
            {tr(i18n, "auth.signUp")}
          </Link>
        </p>
      )}
    </div>
  );
});

export const head: DocumentHead = { title: "Log in — exp" };
