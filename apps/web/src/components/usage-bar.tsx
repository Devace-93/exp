import { component$ } from "@builder.io/qwik";
import { fmtLimit } from "../lib/plans";
import { useI18n } from "../i18n";

interface Props {
  label: string;
  used: number;
  limit: number; // -1 = unlimited
}

/** A labeled usage meter (used / limit) with a colored progress bar. */
export const UsageBar = component$<Props>(({ label, used, limit }) => {
  const i18n = useI18n();
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const danger = !unlimited && pct >= 90;
  const warn = !unlimited && pct >= 75 && !danger;
  return (
    <div>
      <div class="mb-1 flex items-center justify-between text-sm">
        <span class="font-medium text-slate-700">{label}</span>
        <span class="text-slate-500">
          {fmtLimit(used, i18n)} / {fmtLimit(limit, i18n)}
        </span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          class={[
            "h-full rounded-full transition-all",
            danger ? "bg-red-500" : warn ? "bg-amber-500" : "bg-primary-600",
          ]}
          style={{ width: unlimited ? "8%" : `${pct}%` }}
        />
      </div>
    </div>
  );
});
