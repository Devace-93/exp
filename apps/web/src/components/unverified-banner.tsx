import { component$ } from "@builder.io/qwik";
import { verifyUrl } from "../lib/auth";
import { tr, useI18n } from "../i18n";

/**
 * Shown at the top of the dashboard while the accounts identity has not
 * confirmed its e-mail: the API answers 403 `email_unverified` to everything
 * but /auth/me until then. The resend lives on the accounts verify page.
 */
export const UnverifiedBanner = component$<{ email: string }>(({ email }) => {
  const i18n = useI18n();
  return (
    <div
      class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
      role="status"
      data-testid="unverified-banner"
    >
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>{tr(i18n, "auth.unverifiedBanner", { email })}</span>
        <a href={verifyUrl()} class="font-medium underline hover:no-underline" data-testid="resend-verification">
          {tr(i18n, "auth.resendAt")}
        </a>
      </div>
    </div>
  );
});
