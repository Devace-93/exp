/** Shared chrome: navigation, footer, language/theme controls. */
export const chrome = {
  // Shared chrome
  "nav.pricing": "Pricing",
  "nav.blog": "Blog",
  "nav.docs": "Docs",
  "nav.sponsors": "Sponsors",
  "nav.login": "Log in",
  "nav.signup": "Sign up free",
  "nav.dashboard": "Dashboard",
  "nav.logout": "Log out",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",
  "nav.projects": "Projects",
  "nav.apiKeys": "API keys",
  "nav.billing": "Billing",

  "footer.madeBy": "Made by Enrique Magallón",
  "footer.source": "Source",
  "footer.appsIndex": "More apps",
  "footer.openSource": "Open source · MIT",

  "ui.theme": "Theme",
  "ui.themeLight": "Switch to light theme",
  "ui.themeDark": "Switch to dark theme",
  "ui.language": "Language",
  "ui.search": "Search",
  "ui.close": "Close",

  // Plan/limit formatters (src/lib/plans.ts)
  "plans.unlimited": "Unlimited",
  "plans.custom": "Custom",
  "plans.days": "{n} days",
  "plans.year": "{n} year",
  "plans.years": "{n} years",
} as const;
