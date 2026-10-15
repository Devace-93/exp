/**
 * Reference catalog (English), assembled from one file per surface so people
 * can work on them independently:
 *   en/chrome.ts     nav, footer, controls
 *   en/marketing.ts  public pages
 *   en/app.ts        auth + dashboard
 * Every other language file (`<base>.ts`, optional `<base>-<COUNTRY>.ts`
 * overrides) exports a Partial<Catalog>; missing keys fall back here.
 * Interpolation: `{name}` placeholders are replaced by `tr(i18n, key, { name })`.
 */
import { app } from "./en/app";
import { chrome } from "./en/chrome";
import { marketing } from "./en/marketing";

const en = { ...chrome, ...marketing, ...app } as const;

export type CatalogKey = keyof typeof en;
export type Catalog = Record<CatalogKey, string>;
export type PartialCatalog = Partial<Catalog>;
export default en;
