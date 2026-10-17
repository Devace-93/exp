import {
  component$,
  Slot,
  useContextProvider,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import { DashboardNav } from "../../components/dashboard-nav";
import { Footer } from "../../components/footer";
import { UnverifiedBanner } from "../../components/unverified-banner";
import { getSession, loginUrl } from "../../lib/auth";
import type { SessionUser } from "../../lib/auth";
import { api } from "../../lib/api";
import { FeaturesContext, FEATURE_DEFAULTS, mergeFeatures } from "../../lib/features";
import { tr, useI18n } from "../../i18n";

/**
 * Authed area chrome + route guard. The session is the accounts cookie, so
 * the guard runs client-side: visitors without one are sent to the hosted
 * login page (and come back here), and protected content is never rendered
 * for them. Unverified identities see the dashboard behind a banner — the API
 * answers 403 `email_unverified` to everything but /auth/me until they confirm.
 *
 * Also resolves exp's features (from /auth/me) BEFORE rendering children, so
 * gated pages never flicker. On any error we fall back to the shared-registry
 * defaults — feature resolution must never lock a user out of the dashboard.
 */
export default component$(() => {
  const i18n = useI18n();
  const ready = useSignal(false);
  const user = useSignal<SessionUser | null>(null);
  const features = useStore({ ...FEATURE_DEFAULTS });
  useContextProvider(FeaturesContext, features);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const me = await getSession();
    if (!me) {
      location.assign(loginUrl());
      return;
    }
    user.value = me;
    try {
      const tenant = await api.me();
      Object.assign(features, mergeFeatures(tenant.features));
    } catch {
      /* keep defaults; pages surface their own load errors */
    }
    ready.value = true;
  });

  return (
    <div class="flex min-h-screen flex-col bg-slate-50">
      <DashboardNav user={user.value} />
      {user.value && !user.value.email_verified && <UnverifiedBanner email={user.value.email} />}
      <main class="flex-1">
        {ready.value ? (
          <Slot />
        ) : (
          <div class="grid place-items-center py-24 text-sm text-slate-400">
            {tr(i18n, "common.loading")}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
});
