import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { PLANS, fmtLimit, fmtPrice, fmtRetention } from "../../../../lib/plans";
import { api } from "../../../../lib/api";
import { capture } from "../../../../lib/analytics";
import { FeaturesContext } from "../../../../lib/features";
import { tr, useI18n } from "../../../../i18n";

// Self-host builds set VITE_BILLING_ENABLED=false → hide all purchase UI.
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED !== "false";

const PAID = ["pro", "team"] as const;

export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const state = useStore({
    annual: false,
    plan: "free",
    accountId: "",
    notice: "",
    busy: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    capture("paywall_viewed");
    api
      .me()
      .then((me) => {
        state.plan = me.account.plan;
        state.accountId = me.account.id;
      })
      .catch(() => {});
  });

  // Resolved during render so the handler captures plain strings, not the
  // i18n store. Templates with placeholders are filled inside the handler.
  const msg = {
    notConfigured: tr(i18n, "billing.notConfigured"),
    signInAgain: tr(i18n, "billing.signInAgain"),
    opening: tr(i18n, "billing.openingCheckout"),
    activating: tr(i18n, "billing.activating"),
    nowOnPlan: tr(i18n, "billing.nowOnPlan"), // {plan}
    willUpdate: tr(i18n, "billing.willUpdate"),
    cancelled: tr(i18n, "billing.cancelled"),
    checkoutFailed: tr(i18n, "billing.checkoutFailed"), // {msg}
    unknownError: tr(i18n, "billing.unknownError"),
  };

  const upgrade = $(async (plan: "pro" | "team") => {
    if (state.busy) return;
    capture("checkout_started", {
      plan,
      period: state.annual ? "annual" : "monthly",
    });

    const apiKey = import.meta.env.VITE_REVENUECAT_PUBLIC_KEY;
    if (!apiKey) {
      state.notice = msg.notConfigured;
      return;
    }

    // RevenueCat's app_user_id MUST be our account id.
    if (!state.accountId) {
      try {
        const me = await api.me();
        state.accountId = me.account.id;
      } catch {
        state.notice = msg.signInAgain;
        return;
      }
    }

    state.busy = true;
    state.notice = msg.opening;
    try {
      const { Purchases } = await import("@revenuecat/purchases-js");

      // Configure once per app_user_id; reuse the shared instance afterwards.
      let purchases!: InstanceType<typeof Purchases>;
      try {
        purchases = Purchases.getSharedInstance();
      } catch {
        purchases = Purchases.configure({ apiKey, appUserId: state.accountId });
      }

      const offerings = await purchases.getOfferings();
      // The offering identifier matches the plan id ("pro" | "team").
      const offering = offerings.all?.[plan] ?? offerings.current;
      if (!offering) throw new Error(`No RevenueCat offering found for "${plan}".`);

      const pkg = state.annual ? offering.annual : offering.monthly;
      if (!pkg) {
        throw new Error(
          `No ${state.annual ? "annual" : "monthly"} package in the "${plan}" offering.`,
        );
      }

      // Opens RevenueCat's hosted checkout (Stripe under the hood). Resolves on success.
      await purchases.purchase({ rcPackage: pkg });

      // Entitlement is granted immediately; our backend webhook flips
      // accounts.plan asynchronously, so poll /auth/me until it reflects.
      state.notice = msg.activating;
      for (let i = 0; i < 12; i++) {
        const me = await api.me();
        if (me.account.plan === plan) {
          state.plan = plan;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      state.notice =
        state.plan === plan
          ? msg.nowOnPlan.split("{plan}").join(PLANS[plan].label)
          : msg.willUpdate;
    } catch (err: any) {
      const m = String(err?.message ?? err ?? "");
      state.notice =
        /cancel/i.test(m) || err?.errorCode === "UserCancelledError"
          ? msg.cancelled
          : msg.checkoutFailed.split("{msg}").join(m || msg.unknownError);
    } finally {
      state.busy = false;
    }
  });

  if (!BILLING_ENABLED) {
    return (
      <div class="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "billing.title")}</h1>
        <div class="mt-6 card p-8 text-slate-600">
          <p class="font-medium text-slate-800">
            {tr(i18n, "billing.selfHostTitle")}
          </p>
          <p class="mt-2 text-sm">
            {tr(i18n, "billing.selfHostDisabled")} (<code>VITE_BILLING_ENABLED=false</code>).{" "}
            {tr(i18n, "billing.selfHostLimits")}
          </p>
        </div>
      </div>
    );
  }

  if (features["early-access"]) {
    return (
      <div class="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "billing.title")}</h1>
        <div class="mt-6 card p-8 text-slate-600">
          <p class="font-medium text-slate-800">
            {tr(i18n, "billing.earlyTitle")}
          </p>
          <p class="mt-2 text-sm">
            {tr(i18n, "billing.earlyBody")}
          </p>
          <Link href="/blog/what-paid-plans-will-include" class="btn-secondary mt-6">
            {tr(i18n, "billing.earlyLink")}
          </Link>
        </div>
      </div>
    );
  }

  if (!features.billing) {
    return (
      <div class="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 class="text-2xl font-bold text-slate-900">{tr(i18n, "billing.title")}</h1>
        <div class="mt-6 card p-8 text-slate-600">
          <p class="font-medium text-slate-800">
            {tr(i18n, "billing.unavailableTitle")}
          </p>
          <p class="mt-2 text-sm">
            {tr(i18n, "billing.unavailableBody")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-12">
      <div class="text-center">
        <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "billing.upgradeTitle")}</h1>
        <p class="mt-2 text-slate-600">
          {tr(i18n, "billing.onPlanPrefix")}{" "}
          <span class="font-semibold capitalize">{state.plan}</span>{" "}
          {tr(i18n, "billing.onPlanSuffix")}
        </p>
      </div>

      {/* Monthly / annual toggle */}
      <div class="mt-6 flex items-center justify-center gap-3">
        <span class={state.annual ? "text-slate-400" : "font-medium text-slate-900"}>
          {tr(i18n, "billing.monthly")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={state.annual}
          class={[
            "relative h-6 w-11 rounded-full transition",
            state.annual ? "bg-primary-600" : "bg-slate-300",
          ]}
          onClick$={() => (state.annual = !state.annual)}
        >
          <span
            class={[
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
              state.annual ? "left-[22px]" : "left-0.5",
            ]}
          />
        </button>
        <span class={state.annual ? "font-medium text-slate-900" : "text-slate-400"}>
          {tr(i18n, "billing.annual")}{" "}
          <span class="text-xs text-green-600">{tr(i18n, "billing.annualSave")}</span>
        </span>
      </div>

      {state.notice && (
        <div class="mx-auto mt-6 max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
          {state.notice}
        </div>
      )}

      <div class="mt-8 grid gap-6 sm:grid-cols-2">
        {PAID.map((key) => {
          const plan = PLANS[key];
          const price = state.annual ? plan.price_annual : plan.price_monthly;
          const current = state.plan === key;
          return (
            <div
              key={key}
              class={[
                "card flex flex-col p-6",
                key === "pro" ? "ring-2 ring-primary-600" : "",
              ]}
            >
              <h2 class="text-lg font-semibold text-slate-900">{plan.label}</h2>
              <div class="mt-2 flex items-baseline gap-1">
                <span class="text-3xl font-bold text-slate-900">
                  {fmtPrice(price, i18n)}
                </span>
                <span class="text-sm text-slate-500">
                  /{state.annual ? tr(i18n, "billing.perYear") : tr(i18n, "billing.perMonth")}
                </span>
              </div>
              <ul class="mt-5 flex-1 space-y-2 text-sm text-slate-600">
                <li>{tr(i18n, "billing.featProjects", { n: fmtLimit(plan.projects, i18n) })}</li>
                <li>{tr(i18n, "billing.featEnvs", { n: fmtLimit(plan.environments_per_project, i18n) })}</li>
                <li>{tr(i18n, "billing.featFlags", { n: fmtLimit(plan.flags_per_project, i18n) })}</li>
                <li>{tr(i18n, "billing.featEvals", { n: fmtLimit(plan.evaluations_per_month, i18n) })}</li>
                <li>{tr(i18n, "billing.featRetention", { n: fmtRetention(plan.audit_retention_days, i18n) })}</li>
                <li>{tr(i18n, "billing.featUsers", { n: fmtLimit(plan.max_users, i18n) })}</li>
              </ul>
              <button
                type="button"
                class={current ? "btn-secondary mt-6" : "btn-primary mt-6"}
                disabled={current || state.busy}
                onClick$={() => upgrade(key)}
              >
                {current
                  ? tr(i18n, "billing.currentPlan")
                  : state.busy
                    ? tr(i18n, "billing.processing")
                    : tr(i18n, "billing.upgradeTo", { plan: plan.label.split(" ")[0] })}
              </button>
            </div>
          );
        })}
      </div>

      <p class="mt-6 text-center text-xs text-slate-400">
        {tr(i18n, "billing.processedBy")} {tr(i18n, "billing.entitlementsPrefix")}{" "}
        <code>pro</code> / <code>team</code> {tr(i18n, "billing.entitlementsSuffix")}
      </p>
    </div>
  );
});

export const head: DocumentHead = { title: "Billing — exp" };
