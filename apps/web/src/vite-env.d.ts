/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Public origin of this app (e.g. https://exp.3m4.net); used in docs snippets. */
  readonly VITE_APP_URL?: string;
  /** Apps index (info.3m4.net); footer link shared by every 3m4 app. */
  readonly VITE_INFO_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_REVENUECAT_PUBLIC_KEY?: string;
  readonly VITE_BILLING_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
