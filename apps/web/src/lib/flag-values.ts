/**
 * Text <-> typed value conversion for the flag editors. The API validates
 * `value` against the flag kind (400 invalid_value); we pre-validate so the
 * form can show an inline error without a round-trip.
 */
import type { FlagKind, FlagValue } from "./types";
import type { CatalogKey } from "../i18n/catalog/en";

export const KINDS: FlagKind[] = ["boolean", "string", "number", "json"];

/** Flag keys the API refuses (400 reserved_key): they would shadow sub-routes. */
export const RESERVED_FLAG_KEYS = ["copy", "evaluate"];

export const KIND_LABEL: Record<FlagKind, CatalogKey> = {
  boolean: "project.kindBoolean",
  string: "project.kindString",
  number: "project.kindNumber",
  json: "project.kindJson",
};

/** Render a value for an input / code block; null → empty string. */
export function formatValue(kind: FlagKind, value: FlagValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (kind === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

export type Parsed = { ok: true; value: FlagValue } | { ok: false; error: CatalogKey };

/** Parse form text into a value of the kind; empty text means null. */
export function parseValue(kind: FlagKind, text: string): Parsed {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  switch (kind) {
    case "boolean":
      return { ok: true, value: t === "true" };
    case "string":
      return { ok: true, value: text };
    case "number": {
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, error: "project.invalidNumber" };
      return { ok: true, value: n };
    }
    case "json":
      try {
        return { ok: true, value: JSON.parse(t) as FlagValue };
      } catch {
        return { ok: false, error: "project.invalidJson" };
      }
  }
}

/** Compact one-line preview for tables and result boxes. */
export function previewValue(value: FlagValue | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") {
    const s = JSON.stringify(value);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  }
  return String(value);
}

/** Slug used as the default project key (same rule as the API). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** Trigger a browser download of a JSON document. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
