import { z } from "zod";
import { brandBaseUrl, brandSecret, type BaseUrl, type Secret } from "./brand.js";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { fixedError } from "./zod-messages.js";

const invalid = fixedError("invalid");

const EnvSchema = z.object({
  ZIPLINE_TOKEN: z
    .string({ error: invalid })
    .trim()
    .min(8, { error: invalid })
    .max(4096, { error: invalid }),
  ZIPLINE_URL: z.url({ error: invalid }),
  ZIPLINE_ALLOW_WRITES: z.string({ error: invalid }).optional(),
  ZIPLINE_PER_MINUTE: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ZIPLINE_TIMEOUT_MS: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ZIPLINE_CONTACT: z
    .string({ error: invalid })
    .trim()
    .min(1, { error: invalid })
    .max(120, { error: invalid })
    .optional(),
  MCP_TRANSPORT: z.enum(["stdio", "http"], { error: invalid }).optional(),
  PORT: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ZIPLINE_CACHE_TTL_SEC: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
});

export interface Config {
  secret: Secret;
  baseUrl: BaseUrl;
  allowWrites: boolean;
  perMinute: number;
  timeoutMs: number;
  contact: string;
  transport: "stdio" | "http";
  port: number;
  cacheTtlSec: number;
  userAgent: string;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return blank(env[name]);
}

function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length === 0 ? "(root)" : issue.path.map((part) => String(part)).join(".");
      return `${path} (${issue.code})`;
    })
    .join("; ");
}

function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (raw === undefined) return fallback;
  const parsed = z.number().int().min(min).max(max).safeParse(Number(raw));
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${field} (out_of_range).`);
  }
  return parsed.data;
}

function userAgentFor(contact: string): string {
  const clean = contact
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
  return `${CONNECTOR_NAME}/${CONNECTOR_VERSION} (${clean.length > 0 ? clean : "contact@example.com"})`;
}

function normalizeBaseUrl(value: string): BaseUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (invalid_url).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (invalid_url).");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (userinfo).");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (query_or_hash).");
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api" || path.endsWith("/api")) {
    throw new ConnectorError(
      "config",
      "Invalid environment: ZIPLINE_URL (api_prefix). Pass the origin only. The client adds /api/...",
    );
  }
  if (path !== "/") {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (origin_only).");
  }
  return brandBaseUrl(url.origin);
}

export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[]): Config {
  const urlRaw = read(env, "ZIPLINE_URL");
  if (urlRaw === undefined) {
    throw new ConnectorError(
      "config",
      "Invalid environment: ZIPLINE_URL (required). Set it to the Zipline origin, for example http://127.0.0.1:8099.",
    );
  }
  const secretRaw = read(env, "ZIPLINE_TOKEN");
  if (secretRaw === undefined) {
    throw new ConnectorError(
      "config",
      "Invalid environment: ZIPLINE_TOKEN (required). Send the encrypted API token as Authorization with no Bearer prefix.",
    );
  }

  const parsed = EnvSchema.safeParse({
    ZIPLINE_TOKEN: secretRaw,
    ZIPLINE_URL: urlRaw,
    ZIPLINE_ALLOW_WRITES: read(env, "ZIPLINE_ALLOW_WRITES"),
    ZIPLINE_PER_MINUTE: read(env, "ZIPLINE_PER_MINUTE"),
    ZIPLINE_TIMEOUT_MS: read(env, "ZIPLINE_TIMEOUT_MS"),
    ZIPLINE_CONTACT: read(env, "ZIPLINE_CONTACT"),
    MCP_TRANSPORT: read(env, "MCP_TRANSPORT"),
    PORT: read(env, "PORT"),
    ZIPLINE_CACHE_TTL_SEC: read(env, "ZIPLINE_CACHE_TTL_SEC"),
  });
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${issueSummary(parsed.error)}.`);
  }

  const data = parsed.data;
  if (hasControlChar(data.ZIPLINE_TOKEN)) {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_TOKEN (control_character).");
  }
  const secret = brandSecret(data.ZIPLINE_TOKEN);
  const baseUrl = normalizeBaseUrl(data.ZIPLINE_URL);
  const contact = data.ZIPLINE_CONTACT ?? "contact@example.com";
  if (hasControlChar(contact)) {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_CONTACT (control_character).");
  }
  const userAgent = userAgentFor(contact);
  if (baseUrl.includes(secret)) {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_URL (contains_secret).");
  }
  if (contact.includes(secret) || userAgent.includes(secret)) {
    throw new ConnectorError("config", "Invalid environment: ZIPLINE_CONTACT (contains_secret).");
  }

  const envTransport = data.MCP_TRANSPORT ?? "stdio";
  const transport = argv.includes("--http") ? "http" : envTransport;
  const allowWrites = data.ZIPLINE_ALLOW_WRITES === "true";

  return {
    secret,
    baseUrl,
    allowWrites,
    perMinute: boundedInt(data.ZIPLINE_PER_MINUTE, 30, 1, 10_000, "ZIPLINE_PER_MINUTE"),
    timeoutMs: boundedInt(data.ZIPLINE_TIMEOUT_MS, 20_000, 100, 120_000, "ZIPLINE_TIMEOUT_MS"),
    contact,
    transport,
    port: boundedInt(data.PORT, 3000, 1, 65_535, "PORT"),
    cacheTtlSec: boundedInt(data.ZIPLINE_CACHE_TTL_SEC, 60, 0, 86_400, "ZIPLINE_CACHE_TTL_SEC"),
    userAgent,
  };
}
