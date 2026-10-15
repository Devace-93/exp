import { component$, type QRL } from "@builder.io/qwik";

interface Props {
  checked: boolean;
  label: string;
  disabled?: boolean;
  /** Smaller variant for dense tables. */
  small?: boolean;
  onToggle$: QRL<(next: boolean) => void>;
}

/** Accessible on/off switch (role="switch"), the core control of the product. */
export const Switch = component$<Props>(({ checked, label, disabled, small, onToggle$ }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      class={[
        "relative inline-flex shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        small ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-primary-600" : "bg-slate-300",
      ]}
      onClick$={() => onToggle$(!checked)}
    >
      <span
        class={[
          "absolute top-0.5 rounded-full bg-white transition-all",
          small ? "h-4 w-4" : "h-5 w-5",
          checked ? (small ? "left-[18px]" : "left-[22px]") : "left-0.5",
        ]}
      />
    </button>
  );
});
