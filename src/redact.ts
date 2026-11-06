const REDACTED = "[redacted]";
const MIN_SECRET_LENGTH = 8;
const MAX_DEPTH = 32;

/**
 * Replace known secrets, their URL-encoded forms, and common credential query params.
 * Secrets shorter than 8 characters are ignored so ordinary words are left alone.
 * Config rejects API tokens shorter than that.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  const seen = new Set<string>();
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < MIN_SECRET_LENGTH || seen.has(value)) continue;
    seen.add(value);
    out = out.split(value).join(REDACTED);
    const encoded = encodeURIComponent(value);
    if (encoded !== value) out = out.split(encoded).join(REDACTED);
  }
  out = out.replace(
    /([?&#](?:api_key|apikey|api-key|access_token|token|key)=)[^&\s#]+/gi,
    `$1${REDACTED}`,
  );
  out = out.replace(/(authorization:\s*(?:bearer\s+|basic\s+)?)(\S+)/gi, `$1${REDACTED}`);
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED);
  return out;
}

const SENSITIVE_FIELD =
  /(secret|token|password|authorization|jwt|api[_-]?key|session|sessions|cookie|core[_-]?secret)/i;

export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "[url]");
}

/** String values under sensitive keys, long enough to replace without eating ordinary words. */
export function suppliedSecrets(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  collectSupplied(value, found, seen, 0);
  return found;
}

function collectSupplied(value: unknown, found: string[], seen: Set<string>, depth: number): void {
  if (depth > MAX_DEPTH || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSupplied(item, found, seen, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key) && typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length >= MIN_SECRET_LENGTH && !seen.has(trimmed)) {
        seen.add(trimmed);
        found.push(trimmed);
      }
    }
    collectSupplied(entry, found, seen, depth + 1);
  }
}

export function redactUnknown(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return redact(value, secrets);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return redact(value.toString(), secrets);
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, secrets, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const safeKey = redact(key, secrets);
      if (SENSITIVE_FIELD.test(key)) {
        out[safeKey] = REDACTED;
        continue;
      }
      out[safeKey] = redactUnknown(entry, secrets, depth + 1);
    }
    return out;
  }
  return REDACTED;
}

export function redactRecord(
  value: Readonly<Record<string, unknown>>,
  secrets: readonly string[],
): Record<string, unknown> {
  const redacted = redactUnknown(value, secrets);
  if (redacted === null || typeof redacted !== "object" || Array.isArray(redacted)) {
    return { error: "Tool result could not be redacted." };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(redacted)) {
    out[key] = entry;
  }
  return out;
}
