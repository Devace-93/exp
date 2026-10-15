import { component$, useContext } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { FeaturesContext } from "../lib/features";
import { tr, useI18n } from "../i18n";

/**
 * Shown wherever plans or limits would otherwise appear while the
 * `early-access` feature is ON. Renders nothing when it is OFF.
 */
export const EarlyAccessBanner = component$<{ compact?: boolean }>(({ compact }) => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  if (!features["early-access"]) return null;
  return (
    <div
      class={[
        "rounded-lg border border-primary-200 bg-primary-50 text-primary-900",
        compact ? "px-3 py-2 text-sm" : "px-4 py-3",
      ]}
      role="status"
    >
      <span class="font-semibold">{tr(i18n, "early.bannerTitle")}</span>{" "}
      {tr(i18n, "early.bannerText")}{" "}
      <Link href="/blog/what-paid-plans-will-include" class="font-medium underline">
        {tr(i18n, "early.bannerLink")}
      </Link>
    </div>
  );
});
