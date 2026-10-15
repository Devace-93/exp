import { component$, $, useContext } from "@builder.io/qwik";
import { Link, useLocation, useNavigate } from "@builder.io/qwik-city";
import { Logo } from "./logo";
import { getRefreshToken, clearTokens } from "../lib/auth";
import { api } from "../lib/api";
import { resetAnalytics } from "../lib/analytics";
import { FeaturesContext, type FeatureKey } from "../lib/features";
import { tr, useI18n } from "../i18n";
import type { CatalogKey } from "../i18n/catalog/en";
import { LanguagePicker } from "./language-picker";
import { ThemeToggle } from "./theme-toggle";

const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED !== "false";

const items: { href: string; label: CatalogKey; feature?: FeatureKey }[] = [
  { href: "/dashboard", label: "nav.projects" },
  { href: "/dashboard/settings", label: "nav.apiKeys", feature: "public-api" },
  { href: "/dashboard/billing", label: "nav.billing", feature: "billing" },
];

export const DashboardNav = component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();

  const visible = items.filter((it) => {
    if (it.feature && !features[it.feature]) return false;
    if (it.href === "/dashboard/billing" && (!BILLING_ENABLED || features["early-access"])) return false;
    return true;
  });

  const logout = $(async () => {
    const rt = getRefreshToken();
    if (rt) {
      try {
        await api.logout(rt);
      } catch {
        /* best-effort */
      }
    }
    clearTokens();
    resetAnalytics();
    await nav("/login");
  });

  const path = loc.url.pathname.replace(/\/$/, "") || "/dashboard";

  return (
    <header class="border-b border-slate-200 bg-white">
      <nav class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div class="flex items-center gap-3 sm:gap-8">
          <Logo href="/dashboard" />
          <div class="flex items-center gap-1">
            {visible.map((it) => {
              const active =
                path === it.href ||
                (it.href === "/dashboard" && path.startsWith("/dashboard/projects"));
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  class={[
                    "rounded-lg px-3 py-1.5 text-sm font-medium",
                    active
                      ? "bg-primary-50 text-primary-700"
                      : "text-slate-600 hover:bg-slate-100",
                  ]}
                >
                  {tr(i18n, it.label)}
                </Link>
              );
            })}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <LanguagePicker />
          <ThemeToggle />
          <button type="button" class="btn-secondary ml-1" onClick$={logout}>
            {tr(i18n, "nav.logout")}
          </button>
        </div>
      </nav>
    </header>
  );
});
