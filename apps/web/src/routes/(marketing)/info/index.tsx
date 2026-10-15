import { component$, useContext } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { FeaturesContext } from "../../../lib/features";
import { tr, useI18n } from "../../../i18n";

export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const early = features["early-access"];
  const pages = [
    { href: "/info/docs", title: tr(i18n, "info.docsTitle"), body: tr(i18n, "info.docsBody") },
    {
      href: "/info/pricing",
      title: early ? tr(i18n, "info.plannedPricingTitle") : tr(i18n, "info.pricingTitle"),
      body: early ? tr(i18n, "info.plannedPricingBody") : tr(i18n, "info.pricingBody"),
    },
    { href: "/info/terms", title: tr(i18n, "info.termsTitle"), body: tr(i18n, "info.termsBody") },
    { href: "/info/privacy", title: tr(i18n, "info.privacyTitle"), body: tr(i18n, "info.privacyBody") },
  ];
  return (
    <div class="mx-auto max-w-4xl px-4 py-16">
      <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "info.title")}</h1>
      <p class="mt-2 text-slate-600">
        {tr(i18n, "info.intro")}
      </p>
      <div class="mt-8 grid gap-4 sm:grid-cols-2">
        {pages.map((p) => (
          <Link key={p.href} href={p.href} class="card p-5 hover:border-primary-300">
            <h2 class="font-semibold text-slate-900">{p.title}</h2>
            <p class="mt-1 text-sm text-slate-600">{p.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
});

export const head: DocumentHead = { title: "Info — exp" };
