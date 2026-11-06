import { describe, expect, it } from "vitest";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "../src/constants.js";
import { loadConfig } from "../src/config.js";
import { ConnectorError } from "../src/errors.js";

const SECRET = "super-secret/key+value=99";
const URL = "http://127.0.0.1:8098";

function messageOf(error: unknown): string {
  expect(error).toBeInstanceOf(ConnectorError);
  if (!(error instanceof ConnectorError)) throw error;
  return error.message;
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("loadConfig", () => {
  it("requires ZIPLINE_URL and ZIPLINE_TOKEN", () => {
    const missingUrl = messageOf(catchError(() => loadConfig({}, [])));
    expect(missingUrl).toContain("ZIPLINE_URL");
    expect(missingUrl).toContain("required");
    const missingSecret = messageOf(catchError(() => loadConfig({ ZIPLINE_URL: URL }, [])));
    expect(missingSecret).toContain("ZIPLINE_TOKEN");
    expect(missingSecret).toContain("required");
    expect(missingSecret).not.toContain(SECRET);
  });

  it("applies defaults when the URL and token are set", () => {
    const config = loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET }, []);
    expect(config.secret).toBe(SECRET);
    expect(config.baseUrl).toBe(URL);
    expect(config.allowWrites).toBe(false);
    expect(config.perMinute).toBe(30);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.contact).toBe("contact@example.com");
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3000);
    expect(config.cacheTtlSec).toBe(60);
    expect(config.userAgent).toBe(`${CONNECTOR_NAME}/${CONNECTOR_VERSION} (contact@example.com)`);
  });

  it("lets --http override the transport", () => {
    expect(
      loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET, MCP_TRANSPORT: "stdio" }, [
        "node",
        "app",
        "--http",
      ]).transport,
    ).toBe("http");
  });

  it("enables writes only when ZIPLINE_ALLOW_WRITES is the literal true", () => {
    expect(
      loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET, ZIPLINE_ALLOW_WRITES: "true" }, [])
        .allowWrites,
    ).toBe(true);
    expect(
      loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET, ZIPLINE_ALLOW_WRITES: "TRUE" }, [])
        .allowWrites,
    ).toBe(false);
    expect(
      loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET, ZIPLINE_ALLOW_WRITES: "1" }, [])
        .allowWrites,
    ).toBe(false);
  });

  it("reports invalid fields without the rejected value or the token", () => {
    const message = messageOf(
      catchError(() =>
        loadConfig(
          {
            ZIPLINE_URL: URL,
            ZIPLINE_TOKEN: SECRET,
            PORT: "nope",
            MCP_TRANSPORT: "sse",
          },
          [],
        ),
      ),
    );
    expect(message).toContain("PORT");
    expect(message).toContain("MCP_TRANSPORT");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("nope");
    expect(message).not.toContain("sse");
  });

  it("rejects a base url or contact that contains the token", () => {
    const inUrl = messageOf(
      catchError(() =>
        loadConfig(
          { ZIPLINE_TOKEN: "example.invalid", ZIPLINE_URL: "https://example.invalid" },
          [],
        ),
      ),
    );
    expect(inUrl).toContain("contains_secret");
    expect(inUrl).not.toContain("example.invalid");

    const inContact = messageOf(
      catchError(() =>
        loadConfig({ ZIPLINE_URL: URL, ZIPLINE_TOKEN: SECRET, ZIPLINE_CONTACT: SECRET }, []),
      ),
    );
    expect(inContact).toContain("ZIPLINE_CONTACT");
    expect(inContact).not.toContain(SECRET);
  });

  it("rejects userinfo, query strings, and an api prefix on the base url", () => {
    const userinfo = messageOf(
      catchError(() =>
        loadConfig({ ZIPLINE_URL: "https://user:pass@example.invalid", ZIPLINE_TOKEN: SECRET }, []),
      ),
    );
    expect(userinfo).toContain("userinfo");
    expect(userinfo).not.toContain("pass");

    const query = messageOf(
      catchError(() =>
        loadConfig(
          {
            ZIPLINE_URL: `https://example.invalid/v1?token=${SECRET}`,
            ZIPLINE_TOKEN: SECRET,
          },
          [],
        ),
      ),
    );
    expect(query).toContain("ZIPLINE_URL");
    expect(query).not.toContain(SECRET);

    const prefix = messageOf(
      catchError(() =>
        loadConfig({ ZIPLINE_URL: "http://127.0.0.1:8098/api", ZIPLINE_TOKEN: SECRET }, []),
      ),
    );
    expect(prefix).toContain("api_prefix");
  });
});
