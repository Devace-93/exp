/**
 * Marketing pages: landing, blog (chrome only, post bodies stay in
 * src/content/posts.ts), pricing/info/docs, sponsors, early-access banner.
 * Prefix keys by page: `landing.*`, `blog.*`, `pricing.*`, `info.*`,
 * `docs.*`, `sponsors.*`, `early.*`, `building.*`.
 * Strings that wrap markup are split into parts (e.g. `*Title` + `*Body`,
 * `*Text` + `*Link`); the page re-assembles them around the element.
 */
export const marketing = {
  // Landing — hero
  "landing.badge": "Open source · MIT · Self-hostable",
  "landing.heroTitle": "Feature flags for",
  "landing.heroTitleAccent": "projects, people and AI agents",
  "landing.heroBody":
    "exp gives every project its own environments and flags: toggle, roll out to a percentage, or serve typed values. Read them from your app with one request, and manage them from the dashboard, the REST API or an MCP server.",
  "landing.getStarted": "Get started free",
  "landing.whyFree": "Why it's free right now",
  "landing.seePricing": "See pricing",
  "landing.readDocs": "Read the docs",
  "landing.earlyNote": "Early access: every account gets full access, free. Plans come later, with notice.",
  "landing.freeNote":
    "Free plan: {projects} projects, {flags} flags per project & {evals} evaluations / month. No card required.",

  // Landing — how it works
  "landing.howTitle": "How it works",
  "landing.step1Title": "1. Create a project",
  "landing.step1Body":
    "Each project comes with production, staging and development environments, each with its own client key.",
  "landing.step2Title": "2. Add flags",
  "landing.step2Body":
    "Boolean, string, number or JSON flags. Set enabled, value and rollout percentage per environment.",
  "landing.step3Title": "3. Evaluate from your app",
  "landing.step3Body":
    "One GET with the environment key returns every flag resolved for a user. Deterministic rollouts, no SDK required.",

  // Landing — evaluation API panel
  "landing.evalTitle": "A tiny evaluation API",
  "landing.evalBody":
    "No SDK, no polling library: your app sends the environment client key and an optional distinct_id, and gets back every flag already resolved. Rollouts hash the flag key and the user id, so the same user always lands on the same side.",
  "landing.evalPanelRequest": "Request",
  "landing.evalPanelResponse": "Response",
  "landing.evalNote": "Environment keys only evaluate — they can never change a flag.",

  // Landing — copy flags highlight
  "landing.copyTitle": "Copy flags between projects",
  "landing.copyBody":
    "Spinning up a second app, a white-label client or a new region? Copy the flag definitions — and optionally their per-environment states — from one project to another in one transaction.",
  "landing.copyBullet1": "Pick all flags or just a few.",
  "landing.copyBullet2": "States land on the environment with the same key; missing ones get the default state.",
  "landing.copyBullet3": "Choose skip or overwrite on conflicts, and see exactly what was copied.",

  // Landing — MCP section
  "landing.mcpBadge": "Model Context Protocol",
  "landing.mcpTitle": "Let your AI agent manage flags",
  "landing.mcpIntro":
    "exp ships an MCP server. Connect it to Claude Code, Claude Desktop, Cursor or any MCP host and ask things like",
  "landing.mcpExample1": "“enable new-checkout for 25% of staging”",
  "landing.mcpOr": "or",
  "landing.mcpExample2": "“copy the flags from web-app to mobile-app”",
  "landing.mcpBullet1Title": "Role-scoped keys.",
  "landing.mcpBullet1Body":
    "A viewer key never even sees the delete tool; editor and admin unlock more. Enforced by the API too.",
  "landing.mcpBullet2Title": "Human in the loop.",
  "landing.mcpBullet2Body": "Destructive actions ask you to confirm before anything happens.",
  "landing.mcpBullet3Title": "Audit trail.",
  "landing.mcpBullet3Body": "Every change and every refused call is logged, server-side and agent-side.",
  "landing.mcpBullet4Title": "Local or remote.",
  "landing.mcpBullet4Body1": "Run it over stdio with",
  "landing.mcpBullet4Npm": "npm",
  "landing.mcpBullet4Body2": "or point your host at",
  "landing.mcpBullet4Body3": "with your key.",
  "landing.mcpPanelLocal": "Claude Code · local (npm)",
  "landing.mcpPanelRemote": "Claude Code · remote (nothing to install)",
  "landing.mcpPanelJson": "Any MCP host (JSON)",
  "landing.mcpKeyNote": "Create a key with the role you want under",
  "landing.mcpKeyLink": "Dashboard → API keys",

  // Landing — self-host callout + closing CTA
  "landing.selfhostTitle": "Self-host it (MIT, open source)",
  "landing.selfhostBody1":
    "The entire stack — Flask API, MCP server and this Qwik app — is MIT-licensed. Run it on your own VPS with one",
  "landing.selfhostBody2": ". No billing code, no limits beyond what you configure.",
  "landing.viewGithub": "View on GitHub",
  "landing.ctaTitle": "Ship behind a flag today",
  "landing.ctaBody": "Create a project, grab an environment key and evaluate your first flag in under five minutes.",

  // Blog (chrome only)
  "blog.title": "Blog",
  "blog.intro": "Product updates, engineering notes and release-management tips.",
  "blog.comingSoon": "Coming soon.",
  "blog.readMore": "Read more →",
  "blog.allPosts": "← All posts",
  "blog.notFoundTitle": "Post not found",
  "blog.notFoundBody": "There is no post at",
  "blog.backToBlog": "Back to Blog",
  "blog.seeTiers": "See the planned tiers",

  // Info index
  "info.title": "Info",
  "info.intro": "Reference pages for exp. More will land here over time.",
  "info.pricingTitle": "Pricing",
  "info.pricingBody": "Plans, limits and prices.",
  "info.plannedPricingTitle": "Planned pricing",
  "info.plannedPricingBody": "The tiers we intend to introduce after early access.",
  "info.docsTitle": "Docs",
  "info.docsBody": "REST quick reference, evaluation semantics and MCP setup.",
  "info.termsTitle": "Terms",
  "info.termsBody": "Terms of service (coming soon).",
  "info.privacyTitle": "Privacy",
  "info.privacyBody": "What we store and what we never store (coming soon).",
  "info.comingSoon": "This page is coming soon.",
  "info.backToInfo": "Back to Info",

  // Pricing page
  "pricing.title": "Simple, honest pricing",
  "pricing.titlePlanned": "Planned pricing",
  "pricing.intro":
    "Start free. Upgrade when you need more projects, flags, evaluations or longer audit retention. Self-host for unlimited everything.",
  "pricing.introPlanned":
    "These are the tiers we intend to introduce after early access. Nothing here applies yet.",
  "pricing.earlyTitle": "Right now every account has full access, free.",
  "pricing.earlyBody":
    "Unlimited projects, environments, flags and evaluations, the API and the MCP server. When plans arrive we will announce it on the blog and by email before any limit applies to an existing account. Prices and limits below may still change.",
  "pricing.earlyCta": "Read what paid plans will include",
  "pricing.enterpriseTitle": "Need custom limits, SSO or an SLA?",
  "pricing.enterpriseBody": "Enterprise plans are tailored to your team.",
  "pricing.contactUs": "Contact us",
  "pricing.footnote":
    "All prices in USD. Annual billing saves ~20%. Project, environment, flag and key counts are hard limits; evaluations over the monthly budget keep being served — we only report the overage.",
  "pricing.footnoteEarly": "None of this is enforced during early access.",

  // Pricing table (plan labels come from packages/shared/plan_limits.json)
  "pricing.mostPopular": "Most popular",
  "pricing.perMonth": "/mo",
  "pricing.perYear": "/yr",
  "pricing.projects": "projects",
  "pricing.envsPerProject": "environments / project",
  "pricing.flagsPerProject": "flags / project",
  "pricing.evalsPerMonth": "evaluations / mo",
  "pricing.apiKeys": "API keys",
  "pricing.auditRetention": "{value} audit retention",
  "pricing.user": "user",
  "pricing.users": "users",
  "pricing.api": "{api} API",
  "pricing.sponsorsBadge": "/sponsors badge",
  "pricing.teamExtras": "Roles + priority support",
  "pricing.enterpriseExtras": "SSO, SLA, custom limits",
  "pricing.getStarted": "Get started",
  "pricing.startPlan": "Start {plan}",

  // Docs (REST quick reference)
  "docs.title": "Docs",
  "docs.intro":
    "A quick reference for the exp REST API. The full contract — every endpoint, object and error — lives in the repository.",
  "docs.fullContract": "Read the full contract (CONTRACT.md)",
  "docs.baseUrl": "Base URL",
  "docs.authTitle": "Authentication",
  "docs.authBody": "Three kinds of credentials, each for one job:",
  "docs.authDashboard": "Dashboard sessions: JWT bearer tokens issued by /auth/login. Hold every scope.",
  "docs.authApiKey":
    "Management API: API keys with a role (viewer / editor / admin). Header X-API-Key: exp_live_… (or Authorization: Bearer).",
  "docs.authEnvKey":
    "Evaluation API: environment client keys. Header X-Environment-Key: exp_env_…. They identify one (project, environment) and can only evaluate.",
  "docs.projectsTitle": "Projects & environments",
  "docs.projectsBody":
    "A project owns environments and flags. Creating one seeds production, staging and development and returns their client keys once.",
  "docs.flagsTitle": "Flags",
  "docs.flagsBody":
    "A flag has a key, a kind (boolean, string, number, json), a default value, tags and one state per environment. Archived flags are kept but never evaluated.",
  "docs.statesTitle": "States",
  "docs.statesBody":
    "A state is enabled + value + rollout_percent for one flag in one environment. Set it with PUT; the response is the whole flag.",
  "docs.copyTitle": "Copy flags",
  "docs.copyBody":
    "Copies flag definitions (and optionally their states) into another project of the same account. One transaction: if the target would exceed its flag limit nothing is copied.",
  "docs.evalTitle": "Evaluation semantics",
  "docs.evalBody": "For one flag in one environment, the evaluation API answers like this:",
  "docs.evalRule1": "State enabled == false → off.",
  "docs.evalRule2":
    "rollout_percent < 100: bucket = first 8 hex chars of sha256(\"<flag_key>:<distinct_id>\") as an integer, modulo 100. In when bucket < rollout_percent. Without distinct_id the request is out unless rollout_percent == 100.",
  "docs.evalRule3": "On → boolean: value = true; other kinds: value = state.value ?? flag.default_value.",
  "docs.evalRule4": "Off → boolean: value = false; other kinds: value = null.",
  "docs.evalPreview":
    "The dashboard and the management API expose the same logic as a preview (GET /projects/:id/flags/evaluate), which is neither metered nor rate-limited as evaluation.",
  "docs.errorsTitle": "Errors & limits",
  "docs.errorsBody":
    "Errors are JSON: { \"error\": { \"code\", \"message\" } }. Creating past a plan limit answers 402 limit_reached with error.which = projects | environments | flags | api_keys. Evaluations over the monthly budget are still served.",
  "docs.mcpTitle": "MCP (AI agents)",
  "docs.mcpBody":
    "The MCP server exposes the management API as tools, filtered by the role of the key you connect with. Destructive tools ask for confirmation.",
  "docs.mcpLocal": "Local (stdio, npm)",
  "docs.mcpRemote": "Remote (Streamable HTTP)",
  "docs.colMethod": "Method",
  "docs.colPath": "Path",
  "docs.colScope": "Scope",
  "docs.colNotes": "Notes",

  // Sponsors
  "sponsors.title": "Sponsors",
  "sponsors.intro1": "exp is open source (MIT). Every",
  "sponsors.introLink": "Pro / Supporter",
  "sponsors.intro2": "subscriber helps keep it free to self-host — and gets a badge and a spot on this page.",
  "sponsors.intro2Early":
    "subscriber will help keep it free to self-host — and will get a badge and a spot on this page.",
  "sponsors.emptyTitle": "Your name could be the first on this page.",
  "sponsors.emptyBody": "Every Pro / Supporter subscriber gets a spot here and an embeddable badge.",
  "sponsors.emptyBodyEarly":
    "Supporter subscriptions open together with paid plans, after early access. Until then every account is free.",
  "sponsors.tierSupporter": "{tier} supporter",
  "sponsors.badgeTitle": "The supporter badge",
  "sponsors.badgeBody": "Pro supporters get an embeddable badge for their site or README:",
  "sponsors.badgeBodyEarly": "Pro supporters will get an embeddable badge for their site or README:",
  "sponsors.badgeLabel": "exp Supporter",
  "sponsors.readPlans": "Read about the upcoming plans",
  "sponsors.become": "Become a supporter",

  // Early-access banner
  "early.bannerTitle": "Early access.",
  "early.bannerText":
    "Every account has full access at no cost right now. Plans and limits will be introduced later, with notice before anything changes.",
  "early.bannerLink": "What paid plans will include",

  // Site-building curtain
  "building.title": "We're building exp",
  "building.body":
    "Feature flags for projects, people and AI agents. The site isn't open yet — but the evaluation API and the MCP server keep answering just fine.",
  "building.footer": "exp.3m4.net · coming soon",
} as const;
