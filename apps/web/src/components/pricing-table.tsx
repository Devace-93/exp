import { component$, useContext } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { PLANS, fmtLimit, fmtPrice, fmtRetention, type PlanKey } from "../lib/plans";
import { FeaturesContext } from "../lib/features";
import { tr, useI18n } from "../i18n";

interface Props {
  /** Which plans to show (defaults to the public tiers). */
  keys?: PlanKey[];
  /** Show the annual price instead of monthly. */
  annual?: boolean;
  /** Highlight one plan as the recommended option. */
  highlight?: PlanKey;
}

/**
 * Renders pricing cards from packages/shared/plan_limits.json. While
 * `early-access` is ON the tiers are informational only: no plan can be
 * started yet, so the per-plan CTAs and the "Most popular" badge are hidden.
 */
export const PricingTable = component$<Props>(
  ({ keys = ["free", "pro", "team", "enterprise"], annual = false, highlight = "pro" }) => {
    const features = useContext(FeaturesContext);
    const i18n = useI18n();
    const early = features["early-access"];
    return (
      <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {keys.map((key) => {
          const plan = PLANS[key];
          if (!plan) return null;
          const isEnterprise = key === "enterprise";
          const price = annual ? plan.price_annual : plan.price_monthly;
          const featured = !early && key === highlight;
          return (
            <div
              key={key}
              class={[
                "card flex flex-col p-6",
                featured ? "ring-2 ring-primary-600" : "",
              ]}
            >
              {featured && (
                <span class="badge mb-3 w-fit bg-primary-100 text-primary-700">
                  {tr(i18n, "pricing.mostPopular")}
                </span>
              )}
              <h3 class="text-lg font-semibold text-slate-900">{plan.label}</h3>

              <div class="mt-3 flex items-baseline gap-1">
                <span class="text-3xl font-bold text-slate-900">
                  {fmtPrice(price, i18n)}
                </span>
                {!isEnterprise && (
                  <span class="text-sm text-slate-500">
                    {annual ? tr(i18n, "pricing.perYear") : tr(i18n, "pricing.perMonth")}
                  </span>
                )}
              </div>

              <ul class="mt-6 flex-1 space-y-2 text-sm text-slate-600">
                <li>
                  <strong>{fmtLimit(plan.projects, i18n)}</strong> {tr(i18n, "pricing.projects")}
                </li>
                <li>
                  <strong>{fmtLimit(plan.environments_per_project, i18n)}</strong>{" "}
                  {tr(i18n, "pricing.envsPerProject")}
                </li>
                <li>
                  <strong>{fmtLimit(plan.flags_per_project, i18n)}</strong>{" "}
                  {tr(i18n, "pricing.flagsPerProject")}
                </li>
                <li>
                  <strong>{fmtLimit(plan.evaluations_per_month, i18n)}</strong>{" "}
                  {tr(i18n, "pricing.evalsPerMonth")}
                </li>
                <li>
                  <strong>{fmtLimit(plan.api_keys, i18n)}</strong> {tr(i18n, "pricing.apiKeys")}
                </li>
                <li>{tr(i18n, "pricing.auditRetention", { value: fmtRetention(plan.audit_retention_days, i18n) })}</li>
                <li>
                  <strong>{fmtLimit(plan.max_users, i18n)}</strong>{" "}
                  {plan.max_users === 1 ? tr(i18n, "pricing.user") : tr(i18n, "pricing.users")}
                </li>
                <li class="capitalize">{tr(i18n, "pricing.api", { api: plan.api })}</li>
                {key === "pro" && <li>{tr(i18n, "pricing.sponsorsBadge")}</li>}
                {key === "team" && <li>{tr(i18n, "pricing.teamExtras")}</li>}
                {isEnterprise && <li>{tr(i18n, "pricing.enterpriseExtras")}</li>}
              </ul>

              {(isEnterprise || !early) && (
              <div class="mt-6">
                {isEnterprise ? (
                  <a href="mailto:enrique@3m4.net?subject=exp%20Enterprise" class="btn-secondary w-full">
                    {tr(i18n, "pricing.contactUs")}
                  </a>
                ) : key === "free" ? (
                  <Link href="/signup" class="btn-secondary w-full">
                    {tr(i18n, "pricing.getStarted")}
                  </Link>
                ) : (
                  <Link href="/signup" class="btn-primary w-full">
                    {tr(i18n, "pricing.startPlan", { plan: plan.label.split(" ")[0] })}
                  </Link>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);
