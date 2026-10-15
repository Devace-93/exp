/**
 * exp's OWN feature switches ("features"), mirrored from the backend (the
 * source of truth). Not to be confused with the product's "flags".
 *
 * Registry + fail-safe defaults live in `packages/shared/feature_flags.json`
 * (same pattern as plan_limits.json). Authenticated pages get resolved
 * features from `/auth/me`; anonymous pages (signup) from `GET /api/features`.
 * The UI only hides surfaces — enforcement happens in the Flask API.
 */
import { createContextId } from "@builder.io/qwik";
import registry from "../../../../packages/shared/feature_flags.json";

export type FeatureKey =
  | "site-building"
  | "signups"
  | "early-access"
  | "public-api"
  | "evaluation-api"
  | "flag-copy"
  | "billing";

export type Features = Record<FeatureKey, boolean>;

/** Fail-safe defaults from the shared registry (used until the API answers). */
export const FEATURE_DEFAULTS: Features = Object.fromEntries(
  Object.entries(registry.flags).map(([k, v]) => [k, v.default]),
) as Features;

/** Merge a server-resolved feature map over the defaults. */
export function mergeFeatures(server?: Record<string, boolean>): Features {
  return { ...FEATURE_DEFAULTS, ...(server ?? {}) };
}

/** Provided by the layouts; consume with useContext(FeaturesContext). */
export const FeaturesContext = createContextId<Features>("exp.features");
