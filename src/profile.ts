import { redactUnknown } from "./redact.js";

const USER_KEYS = ["id", "username", "role", "createdAt", "updatedAt", "totpEnabled"] as const;
const QUOTA_KEYS = ["id", "filesQuota", "maxBytes", "maxFiles", "maxUrls"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pick(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = value[key];
  }
  return out;
}

export function sanitizeQuota(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  return pick(value, QUOTA_KEYS);
}

export function sanitizeUser(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out = pick(value, USER_KEYS);
  if (Object.prototype.hasOwnProperty.call(value, "quota")) {
    out["quota"] = sanitizeQuota(value["quota"]);
  }
  return out;
}

export function sanitizeMe(payload: unknown, secrets: readonly string[]): Record<string, unknown> {
  const source = isRecord(payload) ? payload : {};
  const user = isRecord(source["user"]) ? source["user"] : source;
  const safe = sanitizeUser(user) ?? {};
  return redactUnknown(safe, secrets) as Record<string, unknown>;
}
