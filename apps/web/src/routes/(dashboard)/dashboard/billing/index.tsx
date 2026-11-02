import {
  component$,
  useContext,
  useStore,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { PLANS, PRICE_KEYS, fmtLimit, fmtPrice, fmtRetention } from "../../../../lib/plans";
import { api } from "../../../../lib/api";
import { pay } from "../../../../lib/pay";
import type { BillingSubscription } from "../../../../lib/types";
import { capture } from "../../../../lib/analytics";
import { FeaturesContext } from "../../../../lib/features";
import { tr, useI18n } from "../../../../i18n";

// Self-host builds set VITE_BILLING_ENABLED=false → hide all purchase UI.
const BILLING_ENABLED = import.meta.env.VITE_BILLING_ENABLED !== "false";

const PAID = ["pro", "team"] as const;

/**
 * Billing: the plan comes from `/auth/me` + `/billing/status`; buying and
 * managing happen at payments.3m4.net (hosted checkout, Stripe's Customer
 * Portal). exp's backend flips `account.plan` when the portal's signed
 * webhook lands, so after a purchase we poll `/auth/me` until it reflects.
 */
export default component$(() => {
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const state = useStore({
    annual: false,
    plan: "free",
    subscription: null as BillingSubscription | null,
    notice: "",
    busy: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    capture("paywall_viewed");
    api
      .billingStatus()
      .then((status) => {
        state.plan = status.plan;
        state.subscription = status.subscription;
      })
      .catch(() =>
        api
          .me()
          .then((me) => (state.plan = me.account.plan))
          .catch(() => {}),
      );
  });

  // Resolved during render so the handler captures plain strings, not the
  // i18n store. Templates with placeholders are filled inside the handler.
  const msg = {
    opening: tr(i18n, "billing.openingCheckout"),
    activating: tr(i18n, "billing.activating"),
    nowOnPlan: tr(i18n, "billing.nowOnPlan"), // {plan}
    willUpdate: tr(i18n, "billing.willUpdate"),
    cancelled: tr(i18n, "billing.cancelled"),
    checkoutFailed: tr(i18n, "billing.checkoutFailed"), // {msg}
    unknownError: tr(i18n, "billing.unknownError"),
    notPurchasable: tr(i18n, "billing.notPurchasable"),
    donateThanks: tr(i18n, "billing.donateThanks"),
  };

  const upgrade = $(async (plan: "pro" | "team") => {
    if (state.busy) return;
    const period = state.annual ? "annual" : "monthly";
    capture("checkout_started", { plan, period });

    const price = PRICE_KEYS[plan]?.[period];
    if (!price) {
      state.notice = msg.notPurchasable;
      return;
    }

    state.busy = true;
    state.notice = msg.opening;
    try {
      // Opens the portal's /subscribe in a popup (login gate + Stripe Checkout
      // happen there). Resolves on the success page's postMessage or when the
      // portal's entitlements change; the backend webhook is the source of truth.
      await pay().open("subscription", { price, returnTo: location.href });

      state.notice = msg.activating;
      for (let i = 0; i < 12; i++) {
        const me = await api.me();
        if (me.account.plan === plan) {
          state.plan = plan;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (state.plan === plan) {
        state.notice = msg.nowOnPlan.split("{plan}").join(PLANS[plan].label);
        api.billingStatus().then((s) => (state.subscription = s.subscription)).catch(() => {});
      } else {
        state.notice = msg.willUpdate;
      }
    } catch (err: any) {
      const m = String(err?.message ?? err ?? "");
      state.notice = /cancel|timeout/i.test(m)
        ? msg.cancelled
        : msg.checkoutFailed.split("{msg}").join(m || msg.unknownError);
    } finally {
      state.busy = false;
    }
  });

  const manage = $(() => {
    capture("portal_opened", { plan: state.plan });
    location.assign(pay().portalUrl(location.href));
  });

  const donate = $(async () => {
    capture("donate_started", { from: "billing" });
    try {
      await pay().open("donation", { returnTo: location.href });
      state.notice = msg.donateThanks;
    } catch {
      /* closed without paying: nothing to say */
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

  const sub = state.subscription;
  const periodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString(i18n.lang, { dateStyle: "medium" })
    : "";

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

      {/* Existing subscription: Stripe's Customer Portal via payments /me */}
      {sub && sub.active && (
        <div class="mx-auto mt-6 flex max-w-xl flex-col items-center gap-3 card p-5 text-center sm:flex-row sm:justify-between sm:text-left">
          <div class="text-sm text-slate-600">
            <p class="font-medium text-slate-800">
              {PLANS[state.plan as keyof typeof PLANS]?.label ?? state.plan}
              {sub.period ? ` · ${tr(i18n, sub.period === "annual" ? "billing.annual" : "billing.monthly")}` : ""}
            </p>
            {periodEnd && <p>{tr(i18n, "billing.periodEnd", { date: periodEnd })}</p>}
            {!sub.will_renew && <p class="text-amber-700">{tr(i18n, "billing.cancelsAtEnd")}</p>}
            <p class="mt-1 text-xs text-slate-400">{tr(i18n, "billing.manageHint")}</p>
          </div>
          <button type="button" class="btn-secondary shrink-0" onClick$={manage}>
            {tr(i18n, "billing.manage")}
          </button>
        </div>
      )}

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
          const purchasable = !!PRICE_KEYS[key];
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
              {current && sub?.active ? (
                <button type="button" class="btn-secondary mt-6" onClick$={manage}>
                  {tr(i18n, "billing.manage")}
                </button>
              ) : (
                <button
                  type="button"
                  class={current ? "btn-secondary mt-6" : "btn-primary mt-6"}
                  disabled={current || state.busy || !purchasable}
                  title={purchasable ? undefined : tr(i18n, "billing.notPurchasable")}
                  onClick$={() => upgrade(key)}
                >
                  {current
                    ? tr(i18n, "billing.currentPlan")
                    : state.busy
                      ? tr(i18n, "billing.processing")
                      : tr(i18n, "billing.upgradeTo", { plan: plan.label.split(" ")[0] })}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div class="mt-8 text-center">
        <button type="button" class="btn-secondary" onClick$={donate}>
          ☕ {tr(i18n, "billing.donate")}
        </button>
      </div>

      <p class="mt-6 text-center text-xs text-slate-400">
        {tr(i18n, "billing.processedBy")} {tr(i18n, "billing.entitlementsPrefix")}{" "}
        <code>pro</code> / <code>team</code> {tr(i18n, "billing.entitlementsSuffix")}
      </p>
    </div>
  );
});

export const head: DocumentHead = { title: "Billing — exp" };
