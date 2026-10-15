import { component$ } from "@builder.io/qwik";
import { useLocation, Link, type DocumentHead } from "@builder.io/qwik-city";
import { findPost, fmtDate } from "../../../../content/posts";
import { tr, useI18n } from "../../../../i18n";

export default component$(() => {
  const loc = useLocation();
  const i18n = useI18n();
  const slug = (loc.params.slug || "").split("/")[0];
  const post = findPost(slug);

  if (!post) {
    return (
      <article class="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "blog.notFoundTitle")}</h1>
        <p class="mt-3 text-slate-600">
          {tr(i18n, "blog.notFoundBody")} <code class="rounded bg-slate-100 px-1.5 py-0.5 text-sm">/blog/{slug}</code>.
        </p>
        <Link href="/blog" class="btn-secondary mt-8">
          {tr(i18n, "blog.backToBlog")}
        </Link>
      </article>
    );
  }

  return (
    <article class="mx-auto max-w-2xl px-4 py-16">
      <Link href="/blog" class="text-sm text-slate-500 hover:text-primary-600">
        {tr(i18n, "blog.allPosts")}
      </Link>
      <time dateTime={post.date} class="mt-6 block text-xs uppercase tracking-wide text-slate-400">
        {fmtDate(post.date)}
      </time>
      <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-900">{post.title}</h1>
      <p class="mt-4 text-lg text-slate-600">{post.summary}</p>
      <div class="mt-8 space-y-8 text-slate-700">
        {post.sections.map((s, i) => (
          <section key={i}>
            {s.heading && <h2 class="text-xl font-semibold text-slate-900">{s.heading}</h2>}
            {s.paragraphs?.map((p, j) => (
              <p key={j} class="mt-3 leading-relaxed">
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul class="mt-3 list-disc space-y-2 pl-6">
                {s.bullets.map((b, j) => (
                  <li key={j} class="leading-relaxed">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div class="mt-10 flex flex-wrap gap-3">
        <Link href="/info/pricing" class="btn-secondary">
          {tr(i18n, "blog.seeTiers")}
        </Link>
        <Link href="/signup" class="btn-primary">
          {tr(i18n, "landing.getStarted")}
        </Link>
      </div>
    </article>
  );
});

export const head: DocumentHead = ({ params }) => {
  const post = findPost((params.slug || "").split("/")[0]);
  return {
    title: post ? `${post.title} — exp Blog` : "Post not found — exp Blog",
    meta: post ? [{ name: "description", content: post.summary }] : [],
  };
};
