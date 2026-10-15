import { component$, Slot } from "@builder.io/qwik";
import { MarketingNav } from "../../components/marketing-nav";
import { Footer } from "../../components/footer";

/** Public marketing chrome. */
export default component$(() => {
  return (
    <div class="flex min-h-screen flex-col">
      <MarketingNav />
      <main class="flex-1">
        <Slot />
      </main>
      <Footer />
    </div>
  );
});
