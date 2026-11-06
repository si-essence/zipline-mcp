import { describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OPERATIONS } from "../src/operations.js";
import { WRITES_DISABLED } from "../src/write-gate.js";
import {
  API_TOKEN,
  FILE,
  FOLDER,
  INVITE,
  SHORT,
  TAG,
  jsonFetch,
  jsonResponse,
  runtimeFor,
} from "./harness.js";
import { connectServer } from "./mcp.js";
import { readToolText } from "./result.js";

const TOOL_NAMES = [
  "zipline_files",
  "zipline_folders",
  "zipline_info",
  "zipline_invites",
  "zipline_tags",
  "zipline_urls",
];
const WRITE_TOOLS = new Set(
  OPERATIONS.filter((operation) => operation.write).map((operation) => operation.tool),
);

const WRITE_ARGS: Record<string, Record<string, unknown>> = {
  "zipline_files:update": { action: "update", id: "file1", favorite: false, maxViews: 0 },
  "zipline_files:favorite": { action: "favorite", id: "file1", favorite: true },
  "zipline_files:delete": { action: "delete", id: "file1" },
  "zipline_folders:create": { action: "create", name: "inbox", isPublic: false },
  "zipline_folders:update": { action: "update", id: "folder1", isPublic: false },
  "zipline_folders:add": { action: "add", id: "folder1", fileId: "file1" },
  "zipline_folders:remove": { action: "remove", id: "folder1", fileId: "file1" },
  "zipline_folders:delete": { action: "delete", id: "folder1" },
  "zipline_urls:shorten": { action: "shorten", destination: "https://example.com/page" },
  "zipline_urls:update": { action: "update", id: "url1", enabled: false, maxViews: 0 },
  "zipline_urls:delete": { action: "delete", id: "url1" },
  "zipline_invites:create": { action: "create", expiresAt: "never", maxUses: 1 },
  "zipline_invites:delete": { action: "delete", id: "inv1" },
  "zipline_tags:create": { action: "create", name: "docs", color: "#09f" },
  "zipline_tags:update": { action: "update", id: "tag1", name: "docs" },
  "zipline_tags:delete": { action: "delete", id: "tag1" },
};

async function withClient(
  fetchImpl: typeof fetch,
  extra: NodeJS.ProcessEnv,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const runtime = runtimeFor(fetchImpl, extra);
  const connected = await connectServer(runtime);
  try {
    await run(connected.client);
  } finally {
    await connected.close();
  }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; json: Record<string, unknown> | null }> {
  const result = readToolText(await client.callTool({ name, arguments: args }));
  expect(result.text).not.toContain(API_TOKEN);
  if (result.isError) return { ...result, json: null };
  return { ...result, json: JSON.parse(result.text) as Record<string, unknown> };
}

describe("zipline tools", () => {
  it("publishes every tool with confirm only on writes", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse({}));
    await withClient(fetchImpl, {}, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(TOOL_NAMES);
      for (const tool of listed.tools) {
        expect((tool.description ?? "").trim().length).toBeGreaterThan(40);
        const schema = JSON.stringify(tool.inputSchema);
        expect(schema).toContain("action");
        if (WRITE_TOOLS.has(tool.name)) expect(schema).toContain("confirm");
        else expect(schema).not.toContain("confirm");
      }
    });
  });

  it("lists files with false favorite query and a raw Authorization token", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expect(captured.authorization).toBe(API_TOKEN);
      expect(captured.authorization).not.toMatch(/^Bearer /i);
      return jsonResponse({ page: [{ ...FILE, name: `hello ${API_TOKEN}` }], total: 1 });
    });
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "zipline_files", {
        action: "list",
        favorite: false,
        page: 1,
      });
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result.json)).toContain("[redacted]");
      expect(calls[0]?.url).toContain("/api/user/files?");
      expect(calls[0]?.url).toContain("favorite=false");
      expect(calls[0]?.url).toContain("page=1");
    });
  });

  it("strips token and session fields from me", async () => {
    const { fetchImpl } = jsonFetch(() =>
      jsonResponse({
        token: API_TOKEN,
        user: {
          id: "u1",
          username: "admin",
          role: "SUPERADMIN",
          token: API_TOKEN,
          password: "hash",
          sessions: [{ id: "sess", token: "sess-secret-value" }],
          quota: { filesQuota: "BY_BYTES", maxBytes: "1gb", maxFiles: 10, maxUrls: 5 },
        },
      }),
    );
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "zipline_info", { action: "me" });
      expect(result.isError).toBe(false);
      expect(result.json).toMatchObject({
        id: "u1",
        username: "admin",
        role: "SUPERADMIN",
        quota: { filesQuota: "BY_BYTES", maxFiles: 10, maxUrls: 5 },
      });
      expect(JSON.stringify(result.json)).not.toContain("token");
      expect(JSON.stringify(result.json)).not.toContain("sessions");
      expect(JSON.stringify(result.json)).not.toContain("password");
      expect(JSON.stringify(result.json)).not.toContain(API_TOKEN);
    });
  });

  it("rejects expiresAt on file update instead of dropping it", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(FILE));
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "zipline_files", {
        action: "update",
        id: "file1",
        favorite: true,
        expiresAt: "1d",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("expiresAt");
      expect(calls).toHaveLength(0);
    });
  });

  it("previews and blocks every write for confirm and env combinations", async () => {
    const writes = OPERATIONS.filter((operation) => operation.write);
    expect(writes.length).toBeGreaterThan(10);
    for (const operation of writes) {
      const args = WRITE_ARGS[`${operation.tool}:${operation.action}`];
      expect(args, `${operation.tool}:${operation.action}`).toBeDefined();
      if (args === undefined) continue;

      const preview = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(preview.fetchImpl, { ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
        const result = await call(client, operation.tool, args);
        expect(result.json, operation.action).toMatchObject({
          executed: false,
          dry_run: true,
          blocked: false,
          method: operation.method,
        });
        expect(preview.calls).toHaveLength(0);
      });

      const blocked = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(blocked.fetchImpl, { ZIPLINE_ALLOW_WRITES: "false" }, async (client) => {
        const result = await call(client, operation.tool, { ...args, confirm: true });
        expect(result.json).toMatchObject({ executed: false, dry_run: true, blocked: true });
        expect(JSON.stringify(result.json)).toContain(WRITES_DISABLED);
        expect(blocked.calls).toHaveLength(0);
      });

      const omitted = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(omitted.fetchImpl, { ZIPLINE_ALLOW_WRITES: "false" }, async (client) => {
        const result = await call(client, operation.tool, args);
        expect(result.json).toMatchObject({ executed: false, blocked: false });
        expect(omitted.calls).toHaveLength(0);
      });

      const falseOn = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(falseOn.fetchImpl, { ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
        const result = await call(client, operation.tool, { ...args, confirm: false });
        expect(result.json, operation.action).toMatchObject({
          executed: false,
          dry_run: true,
          blocked: false,
          method: operation.method,
        });
        expect(falseOn.calls).toHaveLength(0);
      });

      const falseOff = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(falseOff.fetchImpl, { ZIPLINE_ALLOW_WRITES: "false" }, async (client) => {
        const result = await call(client, operation.tool, { ...args, confirm: false });
        expect(result.json, operation.action).toMatchObject({
          executed: false,
          dry_run: true,
          blocked: false,
          method: operation.method,
        });
        expect(falseOff.calls).toHaveLength(0);
      });

      const sent = jsonFetch(() => jsonResponse({ id: "x" }));
      await withClient(sent.fetchImpl, { ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
        const result = await call(client, operation.tool, { ...args, confirm: true });
        expect(result.json).toMatchObject({
          executed: true,
          dry_run: false,
          blocked: false,
        });
        expect(sent.calls).toHaveLength(1);
        expect(sent.calls[0]?.method).toBe(operation.method);
        expect(sent.calls[0]?.url).toContain(operation.path.replaceAll("{id}", ""));
      });
    }
  }, 60_000);

  it("executes confirmed writes including false and zero fields", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      if (captured.url.includes("/urls")) return jsonResponse(SHORT);
      if (captured.url.includes("/folders")) return jsonResponse(FOLDER);
      if (captured.url.includes("/tags")) return jsonResponse(TAG);
      if (captured.url.includes("/invites")) return jsonResponse(INVITE);
      return jsonResponse(FILE);
    });
    await withClient(fetchImpl, { ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
      const updated = await call(client, "zipline_files", {
        action: "update",
        id: "file1",
        favorite: false,
        maxViews: 0,
        password: null,
        confirm: true,
      });
      expect(updated.json).toMatchObject({ executed: true, dry_run: false, blocked: false });
      const patch = calls.find((item) => item.method === "PATCH" && item.url.includes("/files/"));
      expect(patch?.body).toMatchObject({ favorite: false, maxViews: 0, password: null });

      const shortened = await call(client, "zipline_urls", {
        action: "shorten",
        destination: "https://example.com/page",
        enabled: false,
        confirm: true,
      });
      expect(shortened.json).toMatchObject({ executed: true });
      const post = calls.find((item) => item.method === "POST" && item.url.includes("/urls"));
      expect(post?.body).toMatchObject({ destination: "https://example.com/page", enabled: false });
    });
  });

  it("redacts a shorten password header in the preview", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(SHORT));
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "zipline_urls", {
        action: "shorten",
        destination: "https://example.com/page",
        password: "preview-password-value",
      });
      expect(result.isError).toBe(false);
      expect(result.json).toMatchObject({ executed: false, dry_run: true });
      expect(JSON.stringify(result.json)).not.toContain("preview-password-value");
      expect(JSON.stringify(result.json)).toContain("[redacted]");
      expect(calls).toHaveLength(0);
    });
  });

  it("redacts password and token fields from simulated 401 and 422 errors", async () => {
    const password = "dummy-private-value";
    const returnedToken = "other-returned-token";
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
    const cases = [
      { status: 401, needle: "[unauthorized]" },
      { status: 422, needle: "[input]" },
    ];
    try {
      for (const item of cases) {
        const mocked = jsonFetch(() =>
          jsonResponse(
            {
              password,
              token: returnedToken,
              message: `rejected ${password}`,
            },
            item.status,
          ),
        );
        await withClient(mocked.fetchImpl, { ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
          const result = await call(client, "zipline_files", {
            action: "update",
            id: "file1",
            password,
            confirm: true,
          });
          expect(result.isError).toBe(true);
          expect(result.text).toContain(item.needle);
          expect(result.text).toContain(`HTTP ${item.status}`);
          expect(result.text).not.toContain(password);
          expect(result.text).not.toContain(returnedToken);
          expect(mocked.calls).toHaveLength(1);
        });
      }
      const joined = logs.join("\n");
      expect(joined).not.toContain(password);
      expect(joined).not.toContain(returnedToken);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects confirm as the string true without sending a write", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(SHORT));
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "zipline_urls", {
        action: "shorten",
        destination: "https://example.com/page",
        confirm: "true",
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain("confirm");
      expect(calls).toHaveLength(0);
    });
  });

  it("maps 401 404 422 429 on reads", async () => {
    const cases: { status: number; body: unknown; needle: string }[] = [
      { status: 401, body: "Invalid authorization token", needle: "[unauthorized]" },
      { status: 404, body: "not found", needle: "[not-found]" },
      { status: 422, body: { message: "invalid" }, needle: "[input]" },
      { status: 429, body: "slow", needle: "[rate-limit]" },
    ];
    for (const item of cases) {
      const mocked = jsonFetch(() => jsonResponse(item.body, item.status));
      await withClient(mocked.fetchImpl, {}, async (client) => {
        const result = await call(client, "zipline_info", { action: "stats" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain(item.needle);
        expect(result.text).not.toContain(API_TOKEN);
      });
    }
  });

  it("encodes folder ids that contain reserved path characters", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(FOLDER));
    await withClient(fetchImpl, {}, async (client) => {
      await call(client, "zipline_folders", { action: "get", id: "a/b" });
      expect(calls[0]?.url).toContain("/api/user/folders/a%2Fb");
    });
  });
});
