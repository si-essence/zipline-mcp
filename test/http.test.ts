import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConnectorError } from "../src/errors.js";
import { API_TOKEN, jsonResponse, requestUrl, runtimeFor } from "./harness.js";

describe("HttpClient", () => {
  it("sends the raw Authorization token with no Bearer prefix and never puts it in the URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(API_TOKEN);
      expect(headers.get("authorization")).not.toMatch(/^Bearer /i);
      expect(requestUrl(input)).not.toContain(API_TOKEN);
      expect(init?.redirect).toBe("manual");
      expect(headers.get("accept")).toBe("application/json");
      return Promise.resolve(jsonResponse({ pass: true }));
    });
    const runtime = runtimeFor(fetchImpl);
    const body = await runtime.client.getJson(
      { path: "api/healthcheck", query: undefined, ttlSec: 0 },
      z.object({ pass: z.boolean() }),
    );
    expect(body).toEqual({ pass: true });
  });

  it("encodes path segments and preserves false query values", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      expect(requestUrl(input)).toContain("/api/user/files/a%2Fb");
      expect(requestUrl(input)).toContain("favorite=false");
      expect(requestUrl(input)).toContain("page=1");
      return Promise.resolve(jsonResponse({ page: [] }));
    });
    const runtime = runtimeFor(fetchImpl);
    await runtime.client.getJson(
      {
        path: "api/user/files/a%2Fb",
        query: { favorite: false, page: 1 },
        ttlSec: 0,
      },
      z.unknown(),
    );
  });

  it("caches a read and does not spend a second request until TTL expires", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ pass: true })));
    let now = 0;
    const runtime = runtimeFor(fetchImpl, { ZIPLINE_CACHE_TTL_SEC: "30" }, () => now);
    const schema = z.object({ pass: z.boolean() });
    const first = await runtime.client.getJson(
      { path: "api/healthcheck", query: undefined, ttlSec: 30 },
      schema,
    );
    const second = await runtime.client.getJson(
      { path: "api/healthcheck", query: undefined, ttlSec: 30 },
      schema,
    );
    expect(first).toEqual({ pass: true });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 31_000;
    await runtime.client.getJson({ path: "api/healthcheck", query: undefined, ttlSec: 30 }, schema);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 400, 401, 403, 404, 409, 422, and 429 and does not retry", async () => {
    const cases: { status: number; body: unknown; code: string }[] = [
      { status: 400, body: "Invalid", code: "input" },
      { status: 401, body: "Invalid authorization token", code: "unauthorized" },
      { status: 403, body: "forbidden", code: "forbidden" },
      { status: 404, body: "not found", code: "not_found" },
      { status: 409, body: { message: "conflict" }, code: "conflict" },
      { status: 422, body: { message: "invalid" }, code: "input" },
      { status: 429, body: "slow", code: "rate_limit" },
    ];
    for (const item of cases) {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse(
            item.body,
            item.status,
            item.status === 429 ? { "retry-after": "3" } : undefined,
          ),
        ),
      );
      const runtime = runtimeFor(fetchImpl);
      try {
        await runtime.client.getJson(
          { path: "api/user/files", query: undefined, ttlSec: 0 },
          z.unknown(),
        );
        throw new Error(`expected ${item.code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorError);
        if (!(error instanceof ConnectorError)) throw error;
        expect(error.code).toBe(item.code);
        expect(error.message).not.toContain(API_TOKEN);
        if (item.status === 429) expect(error.retryAfterSeconds).toBe(3);
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses redirects so the token is not forwarded", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        }),
      ),
    );
    const runtime = runtimeFor(fetchImpl);
    await expect(
      runtime.client.getJson({ path: "api/user", query: undefined, ttlSec: 0 }, z.unknown()),
    ).rejects.toMatchObject({ code: "upstream" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts password and token fields from upstream JSON errors once", async () => {
    const password = "dummy-private-value";
    const returnedToken = "other-returned-token";
    const shortPassword = "tiny-pw";
    const cases = [
      { status: 401, code: "unauthorized" },
      { status: 422, code: "input" },
      { status: 500, code: "upstream" },
    ];
    for (const item of cases) {
      const logs: string[] = [];
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse(
            {
              password,
              token: returnedToken,
              nested: { password: shortPassword },
              message: `rejected ${password}`,
            },
            item.status,
          ),
        ),
      );
      const runtime = runtimeFor(fetchImpl);
      runtime.logger.error = (message) => {
        logs.push(message);
      };
      try {
        await runtime.client.patchJson(
          {
            path: "api/user/files/file1",
            query: undefined,
            body: { password, note: { password: shortPassword } },
            headers: { "x-zipline-password": password },
          },
          z.unknown(),
        );
        throw new Error(`expected ${item.code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorError);
        if (!(error instanceof ConnectorError)) throw error;
        expect(error.code).toBe(item.code);
        expect(error.message).toContain(`HTTP ${item.status}`);
        expect(error.message).not.toContain(password);
        expect(error.message).not.toContain(returnedToken);
        expect(error.message).not.toContain(shortPassword);
        expect(error.message).toContain("[redacted]");
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(logs.join("\n")).not.toContain(password);
      expect(logs.join("\n")).not.toContain(returnedToken);
      expect(logs.join("\n")).not.toContain(shortPassword);
    }
  });

  it("redacts a secret that a network error tried to echo", async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new Error(`connect failed ${API_TOKEN} ${encodeURIComponent(API_TOKEN)}`);
    });
    const runtime = runtimeFor(fetchImpl);
    runtime.logger.error = (message) => logs.push(message);
    try {
      await runtime.client.getJson({ path: "api/user", query: undefined, ttlSec: 0 }, z.unknown());
      throw new Error("expected network error");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError);
      if (!(error instanceof ConnectorError)) throw error;
      expect(error.code).toBe("network");
      expect(error.message).not.toContain(API_TOKEN);
      expect(error.message).toContain("[redacted]");
    }
    expect(logs.join("\n")).not.toContain(API_TOKEN);
  });
});
