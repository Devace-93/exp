import { component$, Slot, type QRL } from "@builder.io/qwik";
import { tr, useI18n } from "../i18n";

interface Props {
  open: boolean;
  title: string;
  onClose$: QRL<() => void>;
  /** Wider dialog (e.g. tables inside). */
  wide?: boolean;
}

/** Centered dialog with a backdrop; the parent owns the `open` state. */
export const Modal = component$<Props>(({ open, title, onClose$, wide }) => {
  const i18n = useI18n();
  if (!open) return null;
  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        class="absolute inset-0 cursor-default bg-slate-900/40"
        aria-label={tr(i18n, "common.close")}
        tabIndex={-1}
        onClick$={onClose$}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        class={[
          "card relative max-h-[90vh] w-full overflow-y-auto rounded-b-none p-6 sm:rounded-b-xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        ]}
        onKeyDown$={(e) => {
          if (e.key === "Escape") onClose$();
        }}
      >
        <div class="flex items-start justify-between gap-4">
          <h2 class="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            class="btn-ghost -mr-2 -mt-1 h-8 w-8 px-0"
            aria-label={tr(i18n, "common.close")}
            onClick$={onClose$}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div class="mt-4">
          <Slot />
        </div>
      </div>
    </div>
  );
});
