import { component$, useContext } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { FeaturesContext } from "../../../lib/features";
import { tr, useI18n } from "../../../i18n";

// Supporters are added here (with their permission) as Pro/Team subscriptions
// come in. Empty until launch brings the first ones.
const sponsors: { name: string; tier: string; url: string }[] = [];

export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const early = features["early-access"];
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
        {sponsors.map((s) => (
          <a
            key={s.name}
            href={s.url}
            class="card flex items-center justify-between p-5 hover:border-primary-300"
          >
            <div class="flex items-center gap-3">
              <span class="grid h-10 w-10 place-items-center rounded-full bg-primary-100 font-bold text-primary-700">
                {s.name.charAt(0)}
              </span>
              <span class="font-semibold text-slate-900">{s.name}</span>
            </div>
            <span
              class={[
                "badge",
                s.tier === "Team"
                  ? "bg-primary-600 text-white"
                  : "bg-primary-100 text-primary-700",
              ]}
            >
              {tr(i18n, "sponsors.tierSupporter", { tier: s.tier })}
            </span>
          </a>
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
              <rect x="1" y="5" width="18" height="10" rx="5" fill="#ffffff" fill-opacity="0.35" />
              <circle cx="14" cy="10" r="3.5" fill="#ffffff" />
            </svg>
          </span>
          {tr(i18n, "sponsors.badgeLabel")}
        </div>
      </div>

      <div class="mt-10 text-center">
        {early ? (
          <Link href="/blog/what-paid-plans-will-include" class="btn-primary">
            {tr(i18n, "sponsors.readPlans")}
          </Link>
        ) : (
          <Link href="/signup" class="btn-primary">
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
        "Supporters of exp, the open-source feature-flag service. Pro/Supporter subscribers appear here with a badge.",
    },
  ],
};
