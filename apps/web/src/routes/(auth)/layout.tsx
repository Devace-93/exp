import { component$, Slot } from "@builder.io/qwik";
import { Logo } from "../../components/logo";
import { LanguagePicker } from "../../components/language-picker";
import { ThemeToggle } from "../../components/theme-toggle";

/** Minimal centered layout for /login and /signup. */
export default component$(() => {
  return (
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <div class="flex items-center gap-1">
          <LanguagePicker />
          <ThemeToggle />
        </div>
      </header>
      <main class="flex flex-1 items-center justify-center px-4 py-10">
        <div class="w-full max-w-md">
          <Slot />
        </div>
      </main>
    </div>
  );
});
