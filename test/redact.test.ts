import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { redact, redactUnknown } from "../src/redact.js";
import { createRuntime } from "../src/runtime.js";
import { connectServer } from "./mcp.js";
import { readToolText } from "./result.js";
import { API_TOKEN } from "./harness.js";

const ENCODED = encodeURIComponent(API_TOKEN);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function assertNoKey(label: string, text: string): void {
  expect(text, label).not.toContain(API_TOKEN);
  expect(text, label).not.toContain(ENCODED);
}

describe("redact", () => {
  it("strips the token, its url encoding, query params, and Authorization values", () => {
    const raw = [
      `key=${API_TOKEN}`,
      `encoded=${ENCODED}`,
      `https://upstream.test/lookup?token=${API_TOKEN}&x=1`,
      `Authorization: ${API_TOKEN}`,
      `Authorization: Bearer ${API_TOKEN}`,
    ].join("\n");
    const cleaned = redact(raw, [API_TOKEN]);
    assertNoKey("redact", cleaned);
    expect(cleaned).toContain("token=[redacted]");
    expect(cleaned).toContain("Authorization: [redacted]");
    expect(cleaned).toContain("Bearer [redacted]");
  });

  it("redacts nested token and password fields even when the value is unknown", () => {
    const cleaned = JSON.stringify(
      redactUnknown({ token: "abcd1234secret", password: "hunter2xx", title: `see ${API_TOKEN}` }, [
        API_TOKEN,
      ]),
    );
    assertNoKey("nested", cleaned);
    expect(cleaned).toContain("[redacted]");
    expect(cleaned).not.toContain("abcd1234secret");
    expect(cleaned).not.toContain("hunter2xx");
  });

  it("redacts logger lines", () => {
    const lines: string[] = [];
    const logger = createLogger([API_TOKEN], (line) => {
      lines.push(line);
    });
    logger.error(`upstream said ${API_TOKEN}`);
    assertNoKey("logger", lines.join("\n"));
    expect(lines.join("\n")).toContain("[redacted]");
  });

  it("keeps the token out of tool output, errors, and logs", async () => {
    const logs: string[] = [];
    const consoleLines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleLines.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    });
    const rawFailure = `connect failed ${API_TOKEN} ${ENCODED}`;

    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      assertNoKey("request url", url);
      const header = new Headers(init?.headers).get("authorization");
      expect(header).toBe(API_TOKEN);
      call += 1;
      if (call === 1) {
        return Promise.resolve(
          Response.json({
            user: { id: "u1", username: "admin", role: "USER", token: API_TOKEN },
            token: API_TOKEN,
          }),
        );
      }
      return Promise.reject(new Error(rawFailure));
    });

    const runtime = createRuntime(
      loadConfig(
        {
          ZIPLINE_TOKEN: API_TOKEN,
          ZIPLINE_URL: "https://zipline.test",
          ZIPLINE_CACHE_TTL_SEC: "0",
        },
        [],
      ),
      {
        fetchImpl,
        logger: createLogger([API_TOKEN], (line) => {
          logs.push(line);
        }),
      },
    );
    const { client, close } = await connectServer(runtime);
    try {
      const ok = readToolText(
        await client.callTool({ name: "zipline_info", arguments: { action: "me" } }),
      );
      const bad = readToolText(
        await client.callTool({ name: "zipline_info", arguments: { action: "stats" } }),
      );

      expect(ok.isError).toBe(false);
      expect(ok.text).toContain("admin");
      assertNoKey("success output", ok.text);
      expect(ok.text).not.toContain('"token"');

      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("[redacted]");
      assertNoKey("error output", bad.text);

      expect(logs.length).toBeGreaterThan(0);
      assertNoKey("logs", logs.join("\n"));
      assertNoKey("stderr", consoleLines.join("\n"));
    } finally {
      spy.mockRestore();
      await close();
    }
  });
});
