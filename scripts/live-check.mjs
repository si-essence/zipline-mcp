#!/usr/bin/env node
/**
 * Live check against a local Zipline 4.8.2. Spawns dist/index.js over stdio.
 * Reads ZIPLINE_TOKEN from env or ZIPLINE_TOKEN_FILE.
 * Unsets DATABASE_URL. Does not print the token.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

delete process.env["DATABASE_URL"];

const root = fileURLToPath(new URL("..", import.meta.url));
const tokenFile = process.env["ZIPLINE_TOKEN_FILE"];

function readToken() {
  const fromEnv = process.env["ZIPLINE_TOKEN"] ?? "";
  if (fromEnv.trim().length >= 8) return fromEnv.trim();
  if (tokenFile === undefined || tokenFile.length === 0) return "";
  try {
    return readFileSync(tokenFile, "utf8").trim();
  } catch {
    return "";
  }
}

const apiToken = readToken();
const baseUrl = process.env["ZIPLINE_URL"] ?? "http://127.0.0.1:8099";

/** @type {string[]} */
const secrets = [];
if (apiToken.length >= 8) secrets.push(apiToken);

/**
 * @param {string} text
 */
function redact(text) {
  let out = String(text);
  for (const secret of secrets) {
    out = out.split(secret).join("[redacted]");
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
  }
  out = out.replace(/(authorization:\s*)\S+/gi, "$1[redacted]");
  return out;
}

/**
 * @param {string} text
 */
function clip(text) {
  let shortened = redact(text).replace(/\s+/g, " ").trim();
  if (shortened.length > 200) shortened = `${shortened.slice(0, 197)}...`;
  return shortened;
}

const writeLine = console.log.bind(console);
const writeError = console.error.bind(console);
console.log = (line) => writeLine(redact(String(line)));
console.error = (line) => writeError(redact(String(line)));

let failed = 0;
let passed = 0;
/** @type {string[]} */
const rows = [];

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  if (ok) passed += 1;
  else failed += 1;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${clip(detail)}`);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function resultId(value) {
  if (!isRecord(value)) return undefined;
  const result = value["result"];
  const source = isRecord(result) ? result : value;
  const id = source["id"];
  return typeof id === "string" ? id : undefined;
}

/**
 * @param {import("@modelcontextprotocol/sdk/client/index.js").Client} client
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function call(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const block = Array.isArray(result.content) ? result.content[0] : undefined;
    const text = block && typeof block === "object" && "text" in block ? String(block.text) : "";
    assertNoSecret(text);
    /** @type {Record<string, unknown> | null} */
    let json = null;
    try {
      const parsed = JSON.parse(text);
      json = isRecord(parsed) ? parsed : null;
    } catch {
      json = null;
    }
    return { isError: result.isError === true, text, json };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assertNoSecret(text);
    return { isError: true, text, json: null };
  }
}

/**
 * @param {string} text
 */
function assertNoSecret(text) {
  for (const secret of secrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      throw new Error("secret leaked into tool output");
    }
  }
}

/**
 * @param {Record<string, string | undefined>} extra
 */
function childEnv(extra) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "DATABASE_URL") continue;
    if (key === "ZIPLINE_TOKEN" || key === "ZIPLINE_URL" || key === "ZIPLINE_ALLOW_WRITES")
      continue;
    env[key] = value;
  }
  delete env["DATABASE_URL"];
  env["ZIPLINE_URL"] = baseUrl;
  env["ZIPLINE_TOKEN"] = apiToken;
  env["ZIPLINE_CACHE_TTL_SEC"] = "0";
  env["ZIPLINE_PER_MINUTE"] = "120";
  env["ZIPLINE_ALLOW_WRITES"] = "true";
  env["MCP_TRANSPORT"] = "stdio";
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * @param {Record<string, string | undefined>} extra
 * @param {(client: import("@modelcontextprotocol/sdk/client/index.js").Client) => Promise<void>} run
 */
async function withServer(extra, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: root,
    env: childEnv(extra),
    stderr: "pipe",
  });
  const client = new Client({ name: "live-check", version: "0" });
  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

/**
 * @param {string} destination
 */
async function countUrls(destination) {
  const res = await fetch(`${baseUrl}/api/user/urls`, {
    headers: { authorization: apiToken, accept: "application/json" },
    redirect: "manual",
  });
  const text = await res.text();
  assertNoSecret(text);
  if (!res.ok) return -1;
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [];
  return items.filter((item) => isRecord(item) && item["destination"] === destination).length;
}

/**
 * @returns {Promise<string | undefined>}
 */
async function seedFile() {
  const form = new FormData();
  form.append("file", new Blob(["zipline-mcp live fixture\n"], { type: "text/plain" }), "live.txt");
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { authorization: apiToken },
    body: form,
    redirect: "manual",
  });
  const text = await res.text();
  assertNoSecret(text);
  if (!res.ok) return undefined;
  const parsed = JSON.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed["files"])) return undefined;
  const first = parsed["files"][0];
  return isRecord(first) && typeof first["id"] === "string" ? first["id"] : undefined;
}

async function main() {
  if (baseUrl.trim().length === 0) {
    writeLine("SKIP  live-check  ZIPLINE_URL is unset.");
    return;
  }
  if (apiToken.length < 8) {
    writeError("FAIL  live-check  Set ZIPLINE_TOKEN or ZIPLINE_TOKEN_FILE. No token is printed.");
    process.exit(1);
  }

  const stamp = Date.now()
    .toString(36)
    .replace(/[^a-z0-9]/gi, "");
  const destination = `https://example.com/zipline-mcp-${stamp}`;
  const folderName = `mcp-${stamp}`;
  const tagName = `mcp${stamp}`;
  const tagColor = "#09f";

  /** @type {string | undefined} */
  let urlId;
  /** @type {string | undefined} */
  let folderId;
  /** @type {string | undefined} */
  let tagId;
  /** @type {string | undefined} */
  let inviteId;
  /** @type {string | undefined} */
  let fileId;

  try {
    fileId = await seedFile();
    record(
      "seed file via POST /api/upload",
      fileId !== undefined,
      fileId ? "seeded" : "upload failed",
    );

    await withServer({ ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      record(
        "tool list",
        names.join(",") ===
          "zipline_files,zipline_folders,zipline_info,zipline_invites,zipline_tags,zipline_urls",
        `tools=${names.join(",")}`,
      );

      const me = await call(client, "zipline_info", { action: "me" });
      record(
        "me quota",
        me.isError === false &&
          typeof me.json?.["id"] === "string" &&
          typeof me.json?.["username"] === "string" &&
          !JSON.stringify(me.json).includes("token"),
        clip(me.text),
      );

      const stats = await call(client, "zipline_info", { action: "stats" });
      record(
        "user stats",
        stats.isError === false && typeof stats.json?.["filesUploaded"] === "number",
        clip(stats.text),
      );

      const instance = await call(client, "zipline_info", { action: "instance" });
      record(
        "instance stats",
        instance.isError === false &&
          Object.prototype.hasOwnProperty.call(instance.json ?? {}, "latest"),
        clip(instance.text),
      );

      const health = await call(client, "zipline_info", { action: "health" });
      record(
        "health",
        health.isError === false && health.json?.["pass"] === true,
        clip(health.text),
      );

      const files = await call(client, "zipline_files", { action: "list", page: 1 });
      record(
        "list files",
        files.isError === false && Array.isArray(files.json?.["page"]),
        clip(files.text),
      );

      const preview = await call(client, "zipline_urls", {
        action: "shorten",
        destination,
      });
      const afterPreview = await countUrls(destination);
      record(
        "shorten preview",
        preview.isError === false &&
          preview.json?.["executed"] === false &&
          preview.json?.["dry_run"] === true &&
          preview.json?.["blocked"] === false &&
          afterPreview === 0,
        clip(preview.text),
      );
    });

    await withServer({ ZIPLINE_ALLOW_WRITES: "false" }, async (client) => {
      const blocked = await call(client, "zipline_urls", {
        action: "shorten",
        destination,
        confirm: true,
      });
      const afterGuard = await countUrls(destination);
      record(
        "guarded shorten",
        blocked.isError === false &&
          blocked.json?.["blocked"] === true &&
          blocked.json?.["executed"] === false &&
          afterGuard === 0,
        clip(blocked.text),
      );
    });

    await withServer({ ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
      const created = await call(client, "zipline_urls", {
        action: "shorten",
        destination,
        enabled: true,
        confirm: true,
      });
      urlId = resultId(created.json);
      record(
        "confirmed shorten",
        created.isError === false && created.json?.["executed"] === true && urlId !== undefined,
        clip(created.text),
      );

      if (urlId !== undefined) {
        const got = await call(client, "zipline_urls", { action: "get", id: urlId });
        record("get url", got.isError === false && got.json?.["id"] === urlId, clip(got.text));

        const updated = await call(client, "zipline_urls", {
          action: "update",
          id: urlId,
          enabled: false,
          maxViews: 0,
          confirm: true,
        });
        const updatedResult = isRecord(updated.json?.["result"]) ? updated.json["result"] : {};
        record(
          "update url",
          updated.isError === false &&
            updated.json?.["executed"] === true &&
            updatedResult["enabled"] === false,
          clip(updated.text),
        );
      } else {
        record("get url", false, "shorten did not return an id");
        record("update url", false, "shorten did not return an id");
      }

      const folder = await call(client, "zipline_folders", {
        action: "create",
        name: folderName,
        isPublic: false,
        confirm: true,
      });
      folderId = resultId(folder.json);
      record(
        "create folder",
        folder.isError === false && folder.json?.["executed"] === true && folderId !== undefined,
        clip(folder.text),
      );

      if (folderId !== undefined) {
        const gotFolder = await call(client, "zipline_folders", { action: "get", id: folderId });
        record(
          "get folder",
          gotFolder.isError === false && gotFolder.json?.["id"] === folderId,
          clip(gotFolder.text),
        );
        const updatedFolder = await call(client, "zipline_folders", {
          action: "update",
          id: folderId,
          isPublic: true,
          confirm: true,
        });
        record(
          "update folder",
          updatedFolder.isError === false && updatedFolder.json?.["executed"] === true,
          clip(updatedFolder.text),
        );
      } else {
        record("get folder", false, "create did not return an id");
        record("update folder", false, "create did not return an id");
      }

      const tag = await call(client, "zipline_tags", {
        action: "create",
        name: tagName,
        color: tagColor,
        confirm: true,
      });
      tagId = resultId(tag.json);
      record(
        "create tag",
        tag.isError === false && tag.json?.["executed"] === true && tagId !== undefined,
        clip(tag.text),
      );

      if (tagId !== undefined) {
        const gotTag = await call(client, "zipline_tags", { action: "get", id: tagId });
        record(
          "get tag",
          gotTag.isError === false && gotTag.json?.["id"] === tagId,
          clip(gotTag.text),
        );
        const updatedTag = await call(client, "zipline_tags", {
          action: "update",
          id: tagId,
          color: "#00ff00",
          confirm: true,
        });
        record(
          "update tag",
          updatedTag.isError === false && updatedTag.json?.["executed"] === true,
          clip(updatedTag.text),
        );
      } else {
        record("get tag", false, "create did not return an id");
        record("update tag", false, "create did not return an id");
      }

      if (fileId !== undefined) {
        const gotFile = await call(client, "zipline_files", { action: "get", id: fileId });
        record(
          "get file",
          gotFile.isError === false && gotFile.json?.["id"] === fileId,
          clip(gotFile.text),
        );
        const fav = await call(client, "zipline_files", {
          action: "favorite",
          id: fileId,
          favorite: true,
          confirm: true,
        });
        const favResult = isRecord(fav.json?.["result"]) ? fav.json["result"] : {};
        record(
          "favorite file",
          fav.isError === false &&
            fav.json?.["executed"] === true &&
            favResult["favorite"] === true,
          clip(fav.text),
        );
        const updatedFile = await call(client, "zipline_files", {
          action: "update",
          id: fileId,
          maxViews: 0,
          originalName: "live-renamed.txt",
          confirm: true,
        });
        record(
          "update file",
          updatedFile.isError === false && updatedFile.json?.["executed"] === true,
          clip(updatedFile.text),
        );
        if (folderId !== undefined) {
          const added = await call(client, "zipline_folders", {
            action: "add",
            id: folderId,
            fileId,
            confirm: true,
          });
          record(
            "add file to folder",
            added.isError === false && added.json?.["executed"] === true,
            clip(added.text),
          );
          const removed = await call(client, "zipline_folders", {
            action: "remove",
            id: folderId,
            fileId,
            confirm: true,
          });
          record(
            "remove file from folder",
            removed.isError === false && removed.json?.["executed"] === true,
            clip(removed.text),
          );
        }
      } else {
        record("get file", false, "seed failed");
        record("favorite file", false, "seed failed");
        record("update file", false, "seed failed");
      }

      const invite = await call(client, "zipline_invites", {
        action: "create",
        expiresAt: "never",
        maxUses: 1,
        confirm: true,
      });
      inviteId = resultId(invite.json);
      record(
        "create invite",
        invite.isError === false && invite.json?.["executed"] === true && inviteId !== undefined,
        clip(invite.text),
      );
      if (inviteId !== undefined) {
        const gotInvite = await call(client, "zipline_invites", { action: "get", id: inviteId });
        record(
          "get invite",
          gotInvite.isError === false && gotInvite.json?.["id"] === inviteId,
          clip(gotInvite.text),
        );
        const listedInvites = await call(client, "zipline_invites", { action: "list" });
        const inviteItems = Array.isArray(listedInvites.json?.["items"])
          ? listedInvites.json["items"]
          : [];
        record(
          "list invites",
          listedInvites.isError === false &&
            inviteItems.some((item) => isRecord(item) && item["id"] === inviteId),
          clip(listedInvites.text),
        );
      } else {
        record("get invite", false, "create did not return an id");
        record("list invites", false, "create did not return an id");
      }

      const missing = await call(client, "zipline_urls", {
        action: "get",
        id: "does-not-exist-404",
      });
      record(
        "unknown id 404",
        missing.isError === true && missing.text.includes("[not-found]"),
        clip(missing.text),
      );

      const badInput = await call(client, "zipline_urls", {
        action: "shorten",
        destination: "not-a-url",
        confirm: true,
      });
      record(
        "invalid input",
        badInput.isError === true &&
          (badInput.text.includes("[input]") ||
            badInput.text.includes("Invalid arguments") ||
            badInput.text.includes("-32602")),
        clip(badInput.text),
      );
    });

    await withServer(
      { ZIPLINE_ALLOW_WRITES: "false", ZIPLINE_TOKEN: "wrong-token-value-xxxxx" },
      async (client) => {
        const unauthorized = await call(client, "zipline_info", { action: "me" });
        record(
          "bad token 401",
          unauthorized.isError === true && unauthorized.text.includes("[unauthorized]"),
          clip(unauthorized.text),
        );
      },
    );
  } finally {
    await withServer({ ZIPLINE_ALLOW_WRITES: "true" }, async (client) => {
      if (fileId !== undefined) {
        const deletedFile = await call(client, "zipline_files", {
          action: "delete",
          id: fileId,
          confirm: true,
        });
        record(
          "cleanup file",
          deletedFile.isError === false && deletedFile.json?.["executed"] === true,
          clip(deletedFile.text),
        );
      }
      if (folderId !== undefined) {
        const deletedFolder = await call(client, "zipline_folders", {
          action: "delete",
          id: folderId,
          confirm: true,
        });
        record(
          "cleanup folder",
          deletedFolder.isError === false && deletedFolder.json?.["executed"] === true,
          clip(deletedFolder.text),
        );
      }
      if (tagId !== undefined) {
        const deletedTag = await call(client, "zipline_tags", {
          action: "delete",
          id: tagId,
          confirm: true,
        });
        record(
          "cleanup tag",
          deletedTag.isError === false && deletedTag.json?.["executed"] === true,
          clip(deletedTag.text),
        );
      }
      if (inviteId !== undefined) {
        const deletedInvite = await call(client, "zipline_invites", {
          action: "delete",
          id: inviteId,
          confirm: true,
        });
        record(
          "cleanup invite",
          deletedInvite.isError === false && deletedInvite.json?.["executed"] === true,
          clip(deletedInvite.text),
        );
      }
      if (urlId !== undefined) {
        const deletedUrl = await call(client, "zipline_urls", {
          action: "delete",
          id: urlId,
          confirm: true,
        });
        record(
          "cleanup url",
          deletedUrl.isError === false && deletedUrl.json?.["executed"] === true,
          clip(deletedUrl.text),
        );
      }
    });
  }

  for (const row of rows) writeLine(row);
  writeLine(`${failed === 0 ? "PASS" : "FAIL"}  ${passed}/${passed + failed}`);
  if (failed > 0) process.exit(1);
}

await main();
