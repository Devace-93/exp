/**
 * Blog content. Plain data for now (no CMS, no markdown pipeline): a post is a
 * list of sections rendered by routes/(marketing)/blog/[...slug]. Newest first.
 */
export interface PostSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface Post {
  slug: string;
  title: string;
  date: string; // ISO date
  summary: string;
  sections: PostSection[];
}

export const POSTS: Post[] = [
  {
    slug: "what-paid-plans-will-include",
    title: "Launching exp in early access: everything is free for now. Here is what paid plans will include later.",
    date: "2026-10-15",
    summary:
      "exp is a feature-flag service for projects, people and AI agents, and it is in early access. Every account gets the full product at no cost while we finish the pieces that cost real money to run. This post explains what exp is, what will eventually sit behind paid plans, and what stays free.",
    sections: [
      {
        paragraphs: [
          "exp is the second app in the 3m4 family, after the URL shortener. It does one thing: feature flags. Each project gets production, staging and development environments; each flag has a kind (boolean, string, number or JSON), a default value and one state per environment with enabled, value and rollout percentage. Your app reads everything with one request and an environment key; people manage flags from the dashboard, scripts through the REST API with role-scoped keys, and AI agents through the MCP server.",
          "The hosted version at exp.3m4.net is in early access. During early access every account gets the full product: unlimited projects, environments, flags and evaluations, the management API, and the MCP server. No card, no trial clock.",
          "We would rather learn what people actually use before drawing lines around it. Plans will come, and this post is the honest preview of where those lines will be.",
        ],
      },
      {
        heading: "What stays free",
        bullets: [
          "Self-hosting. The whole stack is MIT licensed and always will be; a self-hosted instance has no limits beyond the ones you configure.",
          "A free hosted tier with a few projects, three environments each, a sensible number of flags per project and a monthly budget of evaluations.",
          "Every flag kind, percentage rollouts, the preview evaluation, copying flags between projects, and project export.",
          "Basic API access with scoped API keys, and the MCP server for AI agents.",
        ],
      },
      {
        heading: "What will move under paid plans",
        paragraphs: [
          "The things that cost money to run at scale, or that mostly matter to teams and businesses:",
        ],
        bullets: [
          "Higher counts: more projects, more environments per project, more flags per project and more API keys.",
          "Bigger monthly evaluation budgets. Over-budget evaluations keep being served — the API never breaks a running app — but the dashboard will show the overage.",
          "Longer audit-log retention (a year or more instead of a rolling week).",
          "Team seats, roles and priority support.",
          "Enterprise: SSO, SLA and custom limits.",
        ],
      },
      {
        heading: "What happens when plans arrive",
        paragraphs: [
          "Flags never stop evaluating. Whatever plan you end up on, every environment key you created keeps answering.",
          "We will announce the change here and by email before any limit applies to an existing account, with enough notice to export your projects or pick a plan.",
          "The planned tiers are already listed on the pricing page so there are no surprises. Prices and limits there are our current intent, not a contract, and may still change before launch.",
        ],
      },
      {
        heading: "Questions or opinions?",
        paragraphs: [
          "Early access exists to collect them. Open an issue on GitHub or reply to the welcome email. Telling us which of the items above you would pay for, and which you would not, directly shapes the final plans.",
        ],
      },
    ],
  },
];

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
