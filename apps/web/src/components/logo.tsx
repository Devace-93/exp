import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

/** Wordmark for exp (violet toggle mark + "exp") — links home. */
export const Logo = component$<{ href?: string }>(({ href = "/" }) => {
  return (
    <Link href={href} class="flex items-center gap-2 font-bold tracking-tight">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-primary-600" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* toggle switch, ON */}
          <rect x="1" y="5" width="18" height="10" rx="5" fill="#ffffff" fill-opacity="0.35" />
          <circle cx="14" cy="10" r="3.5" fill="#ffffff" />
        </svg>
      </span>
      <span class="text-lg text-slate-900">
        <span class="text-primary-600">exp</span>
      </span>
    </Link>
  );
});
