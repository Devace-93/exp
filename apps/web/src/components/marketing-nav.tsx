import { component$, useContext, useSignal, useTask$, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link, useLocation, useNavigate } from "@builder.io/qwik-city";
import { Logo } from "./logo";
import { getSession, loginUrl, logout as accountsLogout, profileUrl, signupUrl, type SessionUser } from "../lib/auth";
import { resetAnalytics } from "../lib/analytics";
import { FeaturesContext } from "../lib/features";
import { tr, useI18n } from "../i18n";
import { LanguagePicker } from "./language-picker";
import { ThemeToggle } from "./theme-toggle";

/**
 * Public nav. The session is the accounts cookie, so the signed-in state is
 * resolved client-side after hydration (one call to accounts): until then
 * neither button set is rendered, which avoids a "Log in" flash for a
 * signed-in visitor. Log in / Sign up go to the hosted accounts pages.
 */
export const MarketingNav = component$(() => {
  const nav = useNavigate();
  const loc = useLocation();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  // null = unknown (SSR / before hydration), boolean = resolved.
  const authed = useSignal<boolean | null>(null);
  const user = useSignal<SessionUser | null>(null);
  const menuOpen = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    user.value = await getSession();
    authed.value = user.value !== null;
  });

  // Close the mobile menu whenever the route changes.
  useTask$(({ track }) => {
    track(() => loc.url.pathname);
    menuOpen.value = false;
  });

  const links = [
    ...(!features["early-access"] ? [{ href: "/info/pricing", label: tr(i18n, "nav.pricing") }] : []),
    { href: "/info/docs", label: tr(i18n, "nav.docs") },
    { href: "/blog", label: tr(i18n, "nav.blog") },
    { href: "/sponsors", label: tr(i18n, "nav.sponsors") },
  ];

  const logout = $(async () => {
    try {
      await accountsLogout(); // revokes the session for every 3m4 app
    } catch {
      /* best-effort */
    }
    resetAnalytics();
    authed.value = false;
    user.value = null;
    await nav("/");
  });

  return (
    <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
      <nav class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Logo />
        <div class="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} class="hover:text-primary-600">
              {l.label}
            </Link>
          ))}
        </div>
        <div class="flex min-h-[2.5rem] items-center gap-2" data-auth-state={String(authed.value)}>
          <div class="hidden items-center gap-1 sm:flex">
            <LanguagePicker />
            <ThemeToggle />
          </div>
          {authed.value === true && (
            <>
              {user.value && (
                <a
                  href={profileUrl()}
                  class="hidden items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 md:flex"
                  title={tr(i18n, "nav.profile")}
                >
                  {user.value.avatar_url && (
                    <img src={user.value.avatar_url} alt="" width="24" height="24" class="h-6 w-6 rounded-full object-cover" />
                  )}
                  <span>@{user.value.handle}</span>
                </a>
              )}
              <button type="button" class="btn-ghost hidden md:inline-flex" onClick$={logout}>
                {tr(i18n, "nav.logout")}
              </button>
              <Link href="/dashboard" class="btn-primary">
                {tr(i18n, "nav.dashboard")}
              </Link>
            </>
          )}
          {authed.value === false && (
            <>
              <a href={loginUrl(`${loc.url.origin}/dashboard`)} class="btn-ghost hidden md:inline-flex">
                {tr(i18n, "nav.login")}
              </a>
              <a href={signupUrl(`${loc.url.origin}/dashboard`)} class="btn-primary">
                {tr(i18n, "nav.signup")}
              </a>
            </>
          )}
          {/* Mobile menu toggle */}
          <button
            type="button"
            class="btn-ghost -mr-2 px-2 md:hidden"
            aria-label={menuOpen.value ? tr(i18n, "nav.closeMenu") : tr(i18n, "nav.openMenu")}
            aria-expanded={menuOpen.value}
            aria-controls="mobile-menu"
            onClick$={() => (menuOpen.value = !menuOpen.value)}
          >
            {menuOpen.value ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu panel */}
      <div
        id="mobile-menu"
        class="border-t border-slate-200 bg-white md:hidden"
        hidden={!menuOpen.value}
      >
        <div class="mx-auto flex max-w-6xl flex-col px-4 py-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              class="rounded-lg px-2 py-3 text-base font-medium text-slate-700 hover:bg-slate-50"
            >
              {l.label}
            </Link>
          ))}
          <div class="my-2 border-t border-slate-100" />
          <div class="flex items-center gap-2 px-2 py-2 sm:hidden">
            <LanguagePicker />
            <ThemeToggle />
          </div>
          {authed.value === true && (
            <>
              <Link href="/dashboard" class="rounded-lg px-2 py-3 text-base font-medium text-slate-700 hover:bg-slate-50">
                {tr(i18n, "nav.dashboard")}
              </Link>
              <button
                type="button"
                class="rounded-lg px-2 py-3 text-left text-base font-medium text-slate-700 hover:bg-slate-50"
                onClick$={logout}
              >
                {tr(i18n, "nav.logout")}
              </button>
            </>
          )}
          {authed.value === false && (
            <>
              <a href={loginUrl(`${loc.url.origin}/dashboard`)} class="rounded-lg px-2 py-3 text-base font-medium text-slate-700 hover:bg-slate-50">
                {tr(i18n, "nav.login")}
              </a>
              <a href={signupUrl(`${loc.url.origin}/dashboard`)} class="rounded-lg px-2 py-3 text-base font-medium text-primary-600 hover:bg-slate-50">
                {tr(i18n, "nav.signup")}
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
});
