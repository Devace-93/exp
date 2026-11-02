import { component$, useContext, useVisibleTask$ } from "@builder.io/qwik";
import { Link, routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { FeaturesContext } from "../../../lib/features";
import { PAYMENTS_APP, PAYMENTS_URL } from "../../../lib/pay";
import { fetchSupporters } from "../../../lib/supporters.server";
import type { Supporter } from "../../../lib/types";
import { tr, useI18n } from "../../../i18n";

/**
 * Supporters come from payments.3m4.net (`GET /api/public/supporters?app=exp`):
 * opted-in Pro subscribers and donors, resolved on the server with a short
 * cache (see lib/supporters.server.ts). The donate button is the portal's
 * `pay.js` tag, mounted into #support.
 */
export const useSupporters = routeLoader$<Supporter[]>(() => fetchSupporters(PAYMENTS_APP));

const TIER_KEY = {
  team: "sponsors.tierTeam",
  pro: "sponsors.tierPro",
  supporter: "sponsors.tierDonor",
} as const;

function sinceLabel(since: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(since || "");
  if (!m) return since;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(lang, { year: "numeric", month: "short" });
}

export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const supporters = useSupporters();
  const early = features["early-access"];
  const sponsors = supporters.value;

  // pay.js donate button (CONTRACT.md §10). Injected on the client so it also
  // runs after client-side navigation (SSR-rendered <script> tags only
  // execute on a full page load).
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const mount = document.getElementById("support");
    if (!mount || mount.childElementCount > 0) return;
    const tag = document.createElement("script");
    tag.src = `${PAYMENTS_URL}/pay.js`;
    tag.defer = true;
    tag.dataset.app = PAYMENTS_APP;
    tag.dataset.kind = "donate";
    tag.dataset.mount = "#support";
    tag.dataset.returnTo = location.href;
    document.body.appendChild(tag);
  });

  return (
    <div class="mx-auto max-w-4xl px-4 py-16">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-slate-900">{tr(i18n, "sponsors.title")}</h1>
        <p class="mx-auto mt-3 max-w-2xl text-slate-600">
          {tr(i18n, "sponsors.intro1")}{" "}
          <Link href="/info/pricing" class="text-primary-600 hover:underline">
            {tr(i18n, "sponsors.introLink")}
          </Link>{" "}
          {early ? tr(i18n, "sponsors.intro2Early") : tr(i18n, "sponsors.intro2")}
        </p>
      </div>

      {sponsors.length === 0 && (
        <div class="mt-12 card p-10 text-center">
          <p class="font-semibold text-slate-900">
            {tr(i18n, "sponsors.emptyTitle")}
          </p>
          <p class="mt-1 text-sm text-slate-500">
            {early ? tr(i18n, "sponsors.emptyBodyEarly") : tr(i18n, "sponsors.emptyBody")}
          </p>
        </div>
      )}

      {sponsors.length > 0 && (
      <div class="mt-12 grid gap-4 sm:grid-cols-2">
        {sponsors.map((s, i) => (
          <div
            key={`${s.handle ?? s.display_name}-${i}`}
            class="card flex items-center justify-between gap-3 p-5"
          >
            <div class="flex min-w-0 items-center gap-3">
              {s.avatar_url ? (
                <img
                  src={s.avatar_url}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  class="h-10 w-10 shrink-0 rounded-full bg-primary-100 object-cover"
                />
              ) : (
                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-100 font-bold text-primary-700">
                  {(s.display_name || s.handle || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div class="min-w-0">
                <p class="truncate font-semibold text-slate-900">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener nofollow" class="hover:underline">
                      {s.display_name || s.handle}
                    </a>
                  ) : (
                    s.display_name || s.handle
                  )}
                  {s.handle && <span class="ml-1 font-normal text-slate-400">@{s.handle}</span>}
                </p>
                <p class="text-xs text-slate-500">
                  {tr(i18n, "sponsors.since", { date: sinceLabel(s.since, i18n.lang) })}
                  {s.message ? ` · “${s.message}”` : ""}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {s.source === "github" && (
                <span class="badge bg-slate-900 text-white">{tr(i18n, "sponsors.viaGithub")}</span>
              )}
              <span
                class={[
                  "badge",
                  s.tier === "team"
                    ? "bg-primary-600 text-white"
                    : s.tier === "pro"
                      ? "bg-primary-100 text-primary-700"
                      : "bg-slate-100 text-slate-600",
                ]}
              >
                {tr(i18n, TIER_KEY[s.tier] ?? "sponsors.tierDonor")}
              </span>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Badge concept */}
      <div class="mt-12 card p-6">
        <h2 class="font-semibold text-slate-900">{tr(i18n, "sponsors.badgeTitle")}</h2>
        <p class="mt-1 text-sm text-slate-600">
          {early ? tr(i18n, "sponsors.badgeBodyEarly") : tr(i18n, "sponsors.badgeBody")}
        </p>
        <div class="mt-4 inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700">
          <span class="grid h-5 w-5 place-items-center rounded bg-primary-600" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <path d="M4 3.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9.5L6 17v-3.5H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" fill="#ffffff" fill-opacity="0.92" />
            </svg>
          </span>
          {tr(i18n, "sponsors.badgeLabel")}
        </div>
      </div>

      {/* One-off support: the portal's pay.js donate button */}
      <div class="mt-10 card p-6 text-center">
        <p class="text-sm text-slate-600">{tr(i18n, "sponsors.donateIntro")}</p>
        <div id="support" class="mt-4 flex justify-center" />
        <noscript>
          <a href={`${PAYMENTS_URL}/donate?app=${PAYMENTS_APP}`} class="btn-secondary mt-4">
            {tr(i18n, "billing.donate")}
          </a>
        </noscript>
      </div>

      <div class="mt-10 text-center">
        {early ? (
          <Link href="/blog/what-paid-plans-will-include" class="btn-primary">
            {tr(i18n, "sponsors.readPlans")}
          </Link>
        ) : (
          <Link href="/dashboard/billing" class="btn-primary">
            {tr(i18n, "sponsors.become")}
          </Link>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Sponsors — exp",
  meta: [
    {
      name: "description",
      content:
        "Supporters of exp, the open-source feature-flag service. Pro/Supporter subscribers and donors appear here with a badge.",
    },
  ],
};
