/**
 * Error → user-facing message. 402 `limit_reached` gets a specific line per
 * `error.which` (projects | environments | flags | api_keys); every other API
 * error shows the backend message; anything else (network) the fallback.
 */
import { ApiRequestError } from "./api";
import { translate, type I18nState } from "../i18n";
import type { CatalogKey } from "../i18n/catalog/en";

const LIMIT_KEYS: Record<string, CatalogKey> = {
  projects: "limit.projects",
  environments: "limit.environments",
  flags: "limit.flags",
  api_keys: "limit.api_keys",
};

export function isLimitError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError && e.status === 402;
}

export function errorMessage(i18n: I18nState, e: unknown, fallback: CatalogKey): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 402) {
      const key = (e.error.which && LIMIT_KEYS[e.error.which]) || "limit.generic";
      return translate(i18n, key);
    }
    return e.error.message || translate(i18n, fallback);
  }
  return translate(i18n, fallback);
}
