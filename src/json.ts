import { ConnectorError } from "./errors.js";
import type { QueryMap, QueryValue } from "./http.js";

export function definedQuery(
  record: Readonly<Record<string, QueryValue | undefined>>,
): QueryMap | undefined {
  const out: Record<string, QueryValue> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function definedBody(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function definedHeaders(
  record: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function fillPath(
  openApiPath: string,
  params: Readonly<Record<string, string | number>>,
): string {
  if (!openApiPath.startsWith("/")) {
    throw new ConnectorError("input", "Request path must start with /.");
  }
  const filled = openApiPath.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new ConnectorError("input", `Missing path parameter ${name}.`);
    }
    return encodeURIComponent(String(value));
  });
  if (filled.includes("{") || filled.includes("}")) {
    throw new ConnectorError("input", "Request path still contains a template marker.");
  }
  return filled.replace(/^\/+/, "");
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = entry;
    return out;
  }
  if (Array.isArray(value)) return { items: value };
  if (typeof value === "string") return { text: value };
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return { value };
  }
  return { value: null };
}
