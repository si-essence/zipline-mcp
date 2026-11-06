#!/usr/bin/env node
/**
 * Generate zipline.routes.json and src/operations.ts from spec/api-inventory.json.
 * The inventory is a compact extraction of diced/zipline v4.8.2 route files
 * (PATH plus server.get|post|put|patch|delete) with file hashes. Default runs
 * do not read an external source tree.
 *
 * Refresh the inventory from a local official tree:
 *   node scripts/gen-operations.mjs --source-root /path/to/zipline --write-inventory
 * ZIPLINE_SOURCE_ROOT is the same as --source-root.
 * node scripts/gen-operations.mjs --check compares generated files to disk.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "spec", "api-inventory.json");
const routesPath = join(root, "zipline.routes.json");
const outPath = join(root, "src", "operations.ts");
const PINNED_VERSION = "4.8.2";

/**
 * @typedef {{
 *   tool: string,
 *   action: string,
 *   write: boolean,
 *   destructive: boolean,
 *   kind?: "json" | "empty",
 *   summary: string,
 *   warning?: string,
 *   query?: { name: string, required: boolean }[],
 *   body?: { name: string, type: string, required: boolean }[],
 *   headers?: { name: string, type: string, required: boolean }[],
 * }} MapEntry
 */

/** @type {Record<string, MapEntry>} */
const MAP = {
  "GET /api/user/files": {
    tool: "zipline_files",
    action: "list",
    write: false,
    destructive: false,
    summary: "List or search files for the authenticated user.",
    query: [
      { name: "page", required: false },
      { name: "perpage", required: false },
      { name: "filter", required: false },
      { name: "favorite", required: false },
      { name: "sortBy", required: false },
      { name: "order", required: false },
      { name: "searchField", required: false },
      { name: "searchQuery", required: false },
      { name: "id", required: false },
      { name: "folder", required: false },
    ],
  },
  "GET /api/user/files/{id}": {
    tool: "zipline_files",
    action: "get",
    write: false,
    destructive: false,
    summary: "Read one file by id or short name.",
  },
  "PATCH /api/user/files/{id}": {
    tool: "zipline_files",
    action: "update",
    write: true,
    destructive: false,
    summary: "Update file metadata. expiresAt is not a v4.8.2 PATCH field.",
    warning:
      "Zipline v4.8.2 PATCH /api/user/files/:id has no expiresAt. Favourite, maxViews, password, originalName, type, tags, name, and anonymous are supported.",
    body: [
      { name: "favorite", type: "boolean", required: false },
      { name: "maxViews", type: "number", required: false },
      { name: "password", type: "string", required: false },
      { name: "originalName", type: "string", required: false },
      { name: "type", type: "string", required: false },
      { name: "tags", type: "array", required: false },
      { name: "name", type: "string", required: false },
      { name: "anonymous", type: "boolean", required: false },
    ],
  },
  "DELETE /api/user/files/{id}": {
    tool: "zipline_files",
    action: "delete",
    write: true,
    destructive: true,
    summary: "Delete a file.",
    warning: "This deletes the file and its stored bytes.",
  },
  "GET /api/user/folders": {
    tool: "zipline_folders",
    action: "list",
    write: false,
    destructive: false,
    summary: "List folders for the authenticated user.",
    query: [
      { name: "noincl", required: false },
      { name: "parentId", required: false },
      { name: "root", required: false },
    ],
  },
  "POST /api/user/folders": {
    tool: "zipline_folders",
    action: "create",
    write: true,
    destructive: false,
    summary: "Create a folder.",
    body: [
      { name: "name", type: "string", required: true },
      { name: "isPublic", type: "boolean", required: false },
      { name: "files", type: "array", required: false },
      { name: "parentId", type: "string", required: false },
    ],
  },
  "GET /api/user/folders/{id}": {
    tool: "zipline_folders",
    action: "get",
    write: false,
    destructive: false,
    summary: "Read one folder by id.",
    query: [{ name: "noincl", required: false }],
  },
  "PUT /api/user/folders/{id}": {
    tool: "zipline_folders",
    action: "add",
    write: true,
    destructive: false,
    summary: "Add a file to a folder.",
    body: [{ name: "id", type: "string", required: true }],
  },
  "PATCH /api/user/folders/{id}": {
    tool: "zipline_folders",
    action: "update",
    write: true,
    destructive: false,
    summary: "Update folder name, visibility, uploads, or parent.",
    body: [
      { name: "isPublic", type: "boolean", required: false },
      { name: "name", type: "string", required: false },
      { name: "allowUploads", type: "boolean", required: false },
      { name: "parentId", type: "string", required: false },
    ],
  },
  "DELETE /api/user/folders/{id}": {
    tool: "zipline_folders",
    action: "delete",
    write: true,
    destructive: true,
    summary: "Delete a folder or remove a file from it.",
    warning: "Body delete=folder removes the folder. delete=file removes one file from the folder.",
    body: [
      { name: "delete", type: "string", required: true },
      { name: "id", type: "string", required: false },
      { name: "childrenAction", type: "string", required: false },
      { name: "targetFolderId", type: "string", required: false },
    ],
  },
  "GET /api/user/urls": {
    tool: "zipline_urls",
    action: "list",
    write: false,
    destructive: false,
    summary: "List or search shortened URLs.",
    query: [
      { name: "searchField", required: false },
      { name: "searchQuery", required: false },
    ],
  },
  "POST /api/user/urls": {
    tool: "zipline_urls",
    action: "shorten",
    write: true,
    destructive: false,
    summary: "Create a shortened URL.",
    body: [
      { name: "destination", type: "string", required: true },
      { name: "vanity", type: "string", required: false },
      { name: "enabled", type: "boolean", required: false },
    ],
    headers: [
      { name: "x-zipline-max-views", type: "string", required: false },
      { name: "x-zipline-password", type: "string", required: false },
      { name: "x-zipline-domain", type: "string", required: false },
    ],
  },
  "GET /api/user/urls/{id}": {
    tool: "zipline_urls",
    action: "get",
    write: false,
    destructive: false,
    summary: "Read one shortened URL by id.",
  },
  "PATCH /api/user/urls/{id}": {
    tool: "zipline_urls",
    action: "update",
    write: true,
    destructive: false,
    summary: "Update a shortened URL.",
    body: [
      { name: "password", type: "string", required: false },
      { name: "vanity", type: "string", required: false },
      { name: "maxViews", type: "number", required: false },
      { name: "destination", type: "string", required: false },
      { name: "enabled", type: "boolean", required: false },
    ],
  },
  "DELETE /api/user/urls/{id}": {
    tool: "zipline_urls",
    action: "delete",
    write: true,
    destructive: true,
    summary: "Delete a shortened URL.",
    warning: "This deletes the short URL.",
  },
  "GET /api/auth/invites": {
    tool: "zipline_invites",
    action: "list",
    write: false,
    destructive: false,
    summary: "List invite codes. Administrator role required.",
  },
  "POST /api/auth/invites": {
    tool: "zipline_invites",
    action: "create",
    write: true,
    destructive: false,
    summary: "Create an invite code. Administrator role required.",
    body: [
      { name: "expiresAt", type: "string", required: true },
      { name: "maxUses", type: "number", required: false },
    ],
  },
  "GET /api/auth/invites/{id}": {
    tool: "zipline_invites",
    action: "get",
    write: false,
    destructive: false,
    summary: "Read one invite by id or code. Administrator role required.",
  },
  "DELETE /api/auth/invites/{id}": {
    tool: "zipline_invites",
    action: "delete",
    write: true,
    destructive: true,
    summary: "Delete an invite. Administrator role required.",
    warning: "This deletes the invite code.",
  },
  "GET /api/user/tags": {
    tool: "zipline_tags",
    action: "list",
    write: false,
    destructive: false,
    summary: "List tags owned by the authenticated user.",
  },
  "POST /api/user/tags": {
    tool: "zipline_tags",
    action: "create",
    write: true,
    destructive: false,
    summary: "Create a tag.",
    body: [
      { name: "name", type: "string", required: true },
      { name: "color", type: "string", required: true },
    ],
  },
  "GET /api/user/tags/{id}": {
    tool: "zipline_tags",
    action: "get",
    write: false,
    destructive: false,
    summary: "Read one tag by id.",
  },
  "PATCH /api/user/tags/{id}": {
    tool: "zipline_tags",
    action: "update",
    write: true,
    destructive: false,
    summary: "Update a tag name or color.",
    body: [
      { name: "name", type: "string", required: false },
      { name: "color", type: "string", required: false },
    ],
  },
  "DELETE /api/user/tags/{id}": {
    tool: "zipline_tags",
    action: "delete",
    write: true,
    destructive: true,
    summary: "Delete a tag.",
    warning: "This deletes the tag. Files stay.",
  },
  "GET /api/user": {
    tool: "zipline_info",
    action: "me",
    write: false,
    destructive: false,
    summary: "Read the authenticated user, role, and quota. Token fields are stripped.",
  },
  "GET /api/user/stats": {
    tool: "zipline_info",
    action: "stats",
    write: false,
    destructive: false,
    summary: "Read the authenticated user's file and URL counters.",
  },
  "GET /api/stats": {
    tool: "zipline_info",
    action: "instance",
    write: false,
    destructive: false,
    summary: "Read instance metrics. May be admin-only depending on server settings.",
    query: [
      { name: "from", required: false },
      { name: "to", required: false },
      { name: "all", required: false },
    ],
  },
  "GET /api/healthcheck": {
    tool: "zipline_info",
    action: "health",
    write: false,
    destructive: false,
    summary: "Read the instance healthcheck.",
  },
};

/** Extra caller verbs that reuse a mapped route. */
const ALIASES = [
  {
    key: "PATCH /api/user/files/{id}",
    action: "favorite",
    summary: "Set or clear the favourite flag on a file.",
    body: [{ name: "favorite", type: "boolean", required: true }],
  },
  {
    key: "DELETE /api/user/folders/{id}",
    action: "remove",
    summary: "Remove a file from a folder without deleting the folder.",
    body: [
      { name: "delete", type: "string", required: true },
      { name: "id", type: "string", required: true },
    ],
  },
];

/** @type {Record<string, string>} */
const EXCLUDE = {
  "GET /api/setup":
    "First-time setup probe. Browser admin lifecycle, not a documented agent file or URL operation.",
  "POST /api/setup":
    "Creates the first SUPERADMIN. Browser setup, not an ongoing instance-management tool.",
  "GET /api/version":
    "Queries GitHub for release metadata. Out of scope for a local instance connector.",
  "GET /api/auth/logout": "Browser logout. Session cookies are out of scope.",
  "POST /api/auth/login": "Browser login. Session cookies are out of scope.",
  "POST /api/auth/register": "Public registration. Invite-gated signup is not an agent write.",
  "GET /api/auth/webauthn/options": "Passkey authentication options. Browser auth lifecycle.",
  "POST /api/auth/webauthn": "Passkey ceremony. Browser auth lifecycle.",
  "GET /api/auth/invites/web": "Public invite landing used by the register page.",
  "GET /api/auth/oauth": "OAuth provider listing. Browser auth lifecycle.",
  "DELETE /api/auth/oauth": "Unlink OAuth. Account lifecycle, not file or URL management.",
  "GET /api/auth/oauth/discord": "OAuth redirect. Browser auth lifecycle.",
  "GET /api/auth/oauth/github": "OAuth redirect. Browser auth lifecycle.",
  "GET /api/auth/oauth/google": "OAuth redirect. Browser auth lifecycle.",
  "GET /api/auth/oauth/oidc": "OAuth redirect. Browser auth lifecycle.",
  "POST /api/upload":
    "Multipart upload. Local filesystem tools are out of scope. File expiry exists only on this route via x-zipline-deletes-at, so expire is omitted.",
  "POST /api/upload/partial":
    "Chunked upload continuation. Local filesystem tools are out of scope.",
  "GET /api/user/files/{id}/raw": "Binary file download. Not a JSON management operation.",
  "POST /api/user/files/{id}/password":
    "Public password unlock for a protected file. Not owner metadata update.",
  "GET /api/user/files/incomplete": "Incomplete chunked-upload listing. Upload lifecycle.",
  "DELETE /api/user/files/incomplete": "Incomplete chunked-upload cleanup. Upload lifecycle.",
  "PATCH /api/user/files/transaction":
    "Bulk favorite or folder transaction. Single-file tools cover the same fields.",
  "DELETE /api/user/files/transaction": "Bulk delete. Single-file delete is the published write.",
  "GET /api/user/folders/{id}/export": "Zip export of a folder. Binary download, not JSON CRUD.",
  "POST /api/user/urls/{id}/password":
    "Public password unlock for a protected URL. Not owner metadata update.",
  "GET /api/user/token": "Returns the encrypted API token. The connector never returns tokens.",
  "PATCH /api/user/token": "Rotates the API token. The connector never returns or rotates tokens.",
  "GET /api/user/sessions": "Lists login sessions. Session data is redacted and out of scope.",
  "DELETE /api/user/sessions": "Revokes login sessions. Account lifecycle.",
  "PATCH /api/user":
    "Updates username, password, avatar, and view settings. Returns a token cookie. Account lifecycle.",
  "GET /api/user/avatar": "Raw avatar bytes. Not JSON management.",
  "GET /api/user/recent": "Dashboard recent-files widget. Covered by zipline_files list.",
  "GET /api/user/activity": "User activity log. Not in the published tool set.",
  "GET /api/user/export": "User data export listing. Account lifecycle.",
  "POST /api/user/export": "Starts a user data export. Account lifecycle.",
  "DELETE /api/user/export": "Deletes a user data export. Account lifecycle.",
  "GET /api/user/mfa/totp": "TOTP enrollment. Account lifecycle.",
  "POST /api/user/mfa/totp": "TOTP enrollment. Account lifecycle.",
  "DELETE /api/user/mfa/totp": "TOTP removal. Account lifecycle.",
  "GET /api/user/mfa/passkey": "Passkey listing. Account lifecycle.",
  "GET /api/user/mfa/passkey/options": "Passkey registration options. Account lifecycle.",
  "POST /api/user/mfa/passkey": "Passkey registration. Account lifecycle.",
  "DELETE /api/user/mfa/passkey": "Passkey removal. Account lifecycle.",
  "GET /api/users": "Admin user listing. User admin lifecycle is out of scope.",
  "POST /api/users": "Admin user create. User admin lifecycle is out of scope.",
  "GET /api/users/{id}": "Admin user read. User admin lifecycle is out of scope.",
  "PATCH /api/users/{id}": "Admin user update including quota writes. Super-admin lifecycle.",
  "DELETE /api/users/{id}": "Admin user delete. User admin lifecycle is out of scope.",
  "GET /api/users/{id}/tags":
    "Admin view of another user's tags. Covered for self via zipline_tags.",
  "GET /api/server/public": "Public server settings for the login page.",
  "GET /api/server/folder/{id}": "Public folder view. Not authenticated folder CRUD.",
  "GET /api/server/themes": "Theme listing. Server admin UI.",
  "GET /api/server/status": "Admin process status. Server admin lifecycle.",
  "GET /api/server/settings": "Full server settings. Super-admin lifecycle.",
  "PATCH /api/server/settings": "Mutate server settings. Super-admin lifecycle.",
  "GET /api/server/settings/web": "Web-safe settings subset for the dashboard.",
  "POST /api/server/thumbnails": "Admin thumbnail rebuild. Server admin lifecycle.",
  "POST /api/server/requery_size": "Admin storage requery. Server admin lifecycle.",
  "GET /api/server/clear_zeros": "Admin zero-byte scan. Server admin lifecycle.",
  "DELETE /api/server/clear_zeros": "Admin zero-byte delete. Server admin lifecycle.",
  "DELETE /api/server/clear_temp": "Admin temp cleanup. Server admin lifecycle.",
  "GET /api/server/export": "Server export listing. Server admin lifecycle.",
  "POST /api/server/import/v3": "v3 importer. Migration lifecycle.",
  "POST /api/server/import/v4": "v4 importer. Migration lifecycle.",
};

function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkTs(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function openApiPath(path) {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Canonical hash of file hashes plus method, path, and source file.
 * @param {{ path: string, sha256: string }[]} files
 * @param {{ method: string, path: string, sourceFile: string }[]} routes
 */
export function routeTreeSha256(files, routes) {
  const lines = [
    ...files.map((file) => `${file.path} ${file.sha256}`),
    ...routes.map((route) => `${route.method} ${route.path} ${route.sourceFile}`),
  ];
  return sha256(`${lines.join("\n")}\n`);
}

/**
 * Walk official route files. Used only when --source-root or ZIPLINE_SOURCE_ROOT is set.
 * @param {string} sourceRoot
 */
export function extractInventory(sourceRoot) {
  const packagePath = join(sourceRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  if (packageJson.version !== PINNED_VERSION) {
    throw new Error(`Expected zipline ${PINNED_VERSION}, found ${String(packageJson.version)}`);
  }
  if (packageJson.license !== "MIT") {
    throw new Error(`Expected MIT license, found ${String(packageJson.license)}`);
  }
  const apiRoot = join(sourceRoot, "src/server/routes/api");
  const files = walkTs(apiRoot)
    .sort()
    .map((file) => ({
      path: relative(sourceRoot, file).replaceAll("\\", "/"),
      sha256: sha256(readFileSync(file)),
    }));
  /** @type {{ method: string, path: string, operationId: string, sourceFile: string }[]} */
  const routes = [];
  const seen = new Set();
  for (const file of walkTs(apiRoot)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const pathMatch = source.match(/export const PATH = '([^']+)'/);
    if (pathMatch === null || pathMatch[1] === undefined) {
      throw new Error(`Missing PATH export in ${file}`);
    }
    const declared = openApiPath(pathMatch[1]);
    const re =
      /server\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(PATH(?:\s*\+\s*'[^']+')?|'[^']+')/g;
    let match;
    let found = false;
    while ((match = re.exec(source)) !== null) {
      const verb = match[1];
      const target = match[2];
      if (verb === undefined || target === undefined) continue;
      let rawPath;
      if (target === "PATH") {
        rawPath = declared;
      } else if (target.startsWith("PATH")) {
        const extra = target.match(/PATH\s*\+\s*'([^']+)'/);
        rawPath = openApiPath(`${pathMatch[1]}${extra?.[1] ?? ""}`);
      } else {
        rawPath = openApiPath(target.slice(1, -1));
      }
      const method = verb.toUpperCase();
      const operationId = `${method} ${rawPath}`;
      if (seen.has(operationId)) {
        throw new Error(`Duplicate Zipline route ${operationId} in ${file}`);
      }
      seen.add(operationId);
      routes.push({
        method,
        path: rawPath,
        operationId,
        sourceFile: relative(sourceRoot, file).replaceAll("\\", "/"),
      });
      found = true;
    }
    if (!found) {
      throw new Error(`No HTTP methods registered in ${file}`);
    }
  }
  routes.sort((a, b) => a.operationId.localeCompare(b.operationId));
  return {
    project: "diced/zipline",
    version: PINNED_VERSION,
    license: "MIT",
    root: "src/server/routes/api",
    packageJsonSha256: sha256(readFileSync(packagePath)),
    routeTreeSha256: routeTreeSha256(files, routes),
    extractor:
      "scripts/gen-operations.mjs reads export const PATH and server.get|post|put|patch|delete",
    files,
    routes,
  };
}

/**
 * @param {ReturnType<typeof extractInventory>} inventory
 */
function assertInventory(inventory) {
  if (inventory.version !== PINNED_VERSION) {
    throw new Error(`spec version ${String(inventory.version)} is not ${PINNED_VERSION}`);
  }
  if (inventory.license !== "MIT") {
    throw new Error("spec license must be MIT");
  }
  if (!/^[a-f0-9]{64}$/.test(inventory.routeTreeSha256)) {
    throw new Error("spec routeTreeSha256 is missing");
  }
  if (!/^[a-f0-9]{64}$/.test(inventory.packageJsonSha256)) {
    throw new Error("spec packageJsonSha256 is missing");
  }
  if (!Array.isArray(inventory.files) || inventory.files.length < 40) {
    throw new Error("spec file list is too small");
  }
  if (!Array.isArray(inventory.routes) || inventory.routes.length < 80) {
    throw new Error("spec route list is too small");
  }
  for (const file of inventory.files) {
    if (!file.path.startsWith("src/server/routes/api/") || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Bad inventory file record ${String(file.path)}`);
    }
  }
  const expected = routeTreeSha256(inventory.files, inventory.routes);
  if (expected !== inventory.routeTreeSha256) {
    throw new Error("routeTreeSha256 does not match the committed files and routes");
  }
  return inventory;
}

export function loadInventory() {
  return assertInventory(JSON.parse(readFileSync(specPath, "utf8")));
}

export function listSpecOperations() {
  return loadInventory().routes;
}

function pathParamsOf(path) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
}

/**
 * @param {{ method: string, path: string, operationId: string }} operation
 * @param {MapEntry} mapped
 * @param {string} [action]
 * @param {string} [summary]
 * @param {MapEntry["body"]} [body]
 */
function buildRow(operation, mapped, action, summary, body) {
  const pathParams = pathParamsOf(operation.path);
  const query = mapped.query ?? [];
  const bodyFields = body ?? mapped.body ?? [];
  const headers = mapped.headers ?? [];
  const fields = [
    ...pathParams.map((name) => ({ name, type: "string", required: true, in: "path" })),
    ...query.map((item) => ({
      name: item.name,
      type: "string",
      required: item.required,
      in: "query",
    })),
  ];
  return {
    method: operation.method,
    path: operation.path,
    routeId: operation.operationId,
    operationId:
      action === undefined ? operation.operationId : `${operation.operationId} ${action}`,
    tool: mapped.tool,
    action: action ?? mapped.action,
    write: mapped.write,
    destructive: mapped.destructive,
    kind: mapped.kind ?? "json",
    summary: summary ?? mapped.summary,
    pathParams,
    queryParams: query.map((item) => item.name),
    fields,
    bodyFields,
    headerFields: headers,
    warnings: mapped.warning === undefined ? [] : [mapped.warning],
  };
}

export function planOperations(operations) {
  const known = new Set(operations.map((operation) => `${operation.method} ${operation.path}`));
  for (const key of Object.keys(MAP)) {
    if (!known.has(key)) {
      throw new Error(`Mapped route is not in the extracted inventory: ${key}`);
    }
  }
  for (const key of Object.keys(EXCLUDE)) {
    if (!known.has(key)) {
      throw new Error(`Excluded route is not in the extracted inventory: ${key}`);
    }
  }
  for (const alias of ALIASES) {
    if (!known.has(alias.key)) {
      throw new Error(`Alias route is not in the extracted inventory: ${alias.key}`);
    }
  }
  /** @type {ReturnType<typeof buildRow>[]} */
  const rows = [];
  /** @type {{ method: string, path: string, routeId: string, operationId: string, reason: string }[]} */
  const exclusions = [];
  const pairs = new Set();
  const missing = [];
  for (const operation of operations) {
    const key = `${operation.method} ${operation.path}`;
    const mapped = MAP[key];
    const reason = EXCLUDE[key];
    if (mapped !== undefined && reason !== undefined) {
      throw new Error(`Route ${key} is both mapped and excluded.`);
    }
    if (mapped === undefined && reason === undefined) {
      missing.push(key);
      continue;
    }
    if (reason !== undefined) {
      if (reason.length < 20) throw new Error(`Exclusion reason too short for ${key}`);
      exclusions.push({
        method: operation.method,
        path: operation.path,
        routeId: operation.operationId,
        operationId: operation.operationId,
        reason,
      });
      continue;
    }
    const pair = `${mapped.tool}:${mapped.action}`;
    if (pairs.has(pair)) throw new Error(`Duplicate tool action ${pair}`);
    pairs.add(pair);
    rows.push(buildRow(operation, mapped));
    for (const alias of ALIASES.filter((item) => item.key === key)) {
      const aliasPair = `${mapped.tool}:${alias.action}`;
      if (pairs.has(aliasPair)) throw new Error(`Duplicate tool action ${aliasPair}`);
      pairs.add(aliasPair);
      rows.push(buildRow(operation, mapped, alias.action, alias.summary, alias.body));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Unmapped Zipline routes (map or exclude each): ${missing.join(", ")}`);
  }
  return { rows, exclusions };
}

function tsString(value) {
  return JSON.stringify(value);
}

function emitFields(fields, withIn) {
  return fields
    .map((field) => {
      const loc = withIn && field.in !== undefined ? `, in: ${tsString(field.in)}` : "";
      return `{ name: ${tsString(field.name)}, type: ${tsString(field.type)}, required: ${field.required}${loc} }`;
    })
    .join(", ");
}

function emitRow(row) {
  const warnings = row.warnings.map((item) => tsString(item)).join(", ");
  return `  row(${tsString(row.method)}, ${tsString(row.path)}, ${tsString(row.tool)}, {
    action: ${tsString(row.action)},
    routeId: ${tsString(row.routeId)},
    operationId: ${tsString(row.operationId)},
    write: ${row.write},
    destructive: ${row.destructive},
    kind: ${tsString(row.kind)},
    summary: ${tsString(row.summary)},
    pathParams: [${row.pathParams.map((name) => tsString(name)).join(", ")}],
    queryParams: [${row.queryParams.map((name) => tsString(name)).join(", ")}],
    fields: [${emitFields(row.fields, true)}],
    bodyFields: [${emitFields(row.bodyFields, false)}],
    headerFields: [${emitFields(row.headerFields, false)}],
    warnings: [${warnings}],
  })`;
}

function emitExclusions(exclusions) {
  return exclusions
    .map(
      (row) => `  {
    method: ${tsString(row.method)},
    path: ${tsString(row.path)},
    routeId: ${tsString(row.routeId)},
    operationId: ${tsString(row.operationId)},
    reason: ${tsString(row.reason)},
  }`,
    )
    .join(",\n");
}

function emitOperations(rows, exclusions) {
  return `/** Generated by scripts/gen-operations.mjs from diced/zipline v4.8.2 routes. Do not edit by hand. */

import { ConnectorError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ResponseKind = "json" | "empty";

export interface FieldSchema {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly in?: "path" | "query";
}

export interface Operation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly routeId: string;
  readonly tool: string;
  readonly action: string;
  readonly operationId: string;
  readonly write: boolean;
  readonly destructive: boolean;
  readonly kind: ResponseKind;
  readonly summary: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly fields: readonly FieldSchema[];
  readonly bodyFields: readonly FieldSchema[];
  readonly headerFields: readonly FieldSchema[];
  readonly warnings: readonly string[];
}

export interface ExcludedOperation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly routeId: string;
  readonly operationId: string;
  readonly reason: string;
}

function row(
  method: HttpMethod,
  path: string,
  tool: string,
  options: {
    action: string;
    routeId: string;
    operationId: string;
    write: boolean;
    destructive: boolean;
    kind: ResponseKind;
    summary: string;
    pathParams: readonly string[];
    queryParams: readonly string[];
    fields: readonly FieldSchema[];
    bodyFields: readonly FieldSchema[];
    headerFields: readonly FieldSchema[];
    warnings: readonly string[];
  },
): Operation {
  return {
    method,
    path,
    tool,
    action: options.action,
    routeId: options.routeId,
    operationId: options.operationId,
    write: options.write,
    destructive: options.destructive,
    kind: options.kind,
    summary: options.summary,
    pathParams: options.pathParams,
    queryParams: options.queryParams,
    fields: options.fields,
    bodyFields: options.bodyFields,
    headerFields: options.headerFields,
    warnings: options.warnings,
  };
}

export const SOURCE_VERSION = ${tsString(PINNED_VERSION)};

export const OPERATIONS: readonly Operation[] = [
${rows.map((row) => emitRow(row)).join(",\n")},
];

export const EXCLUSIONS: readonly ExcludedOperation[] = [
${emitExclusions(exclusions)},
];

export function toolNames(): string[] {
  return [...new Set(OPERATIONS.map((operation) => operation.tool))].sort();
}

export function operationsForTool(name: string): Operation[] {
  return OPERATIONS.filter((operation) => operation.tool === name);
}

export function toolIsWrite(name: string): boolean {
  return OPERATIONS.some((operation) => operation.tool === name && operation.write);
}

export function requireOp(tool: string, action: string): Operation {
  const found = OPERATIONS.find(
    (operation) => operation.tool === tool && operation.action === action,
  );
  if (found === undefined) {
    throw new ConnectorError("input", \`Unknown Zipline operation \${tool} \${action}.\`);
  }
  return found;
}
`;
}

function readFlag(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function catalog(inventory, plan) {
  return {
    source: {
      project: inventory.project,
      version: inventory.version,
      license: inventory.license,
      root: inventory.root,
      packageJsonSha256: inventory.packageJsonSha256,
      routeTreeSha256: inventory.routeTreeSha256,
      files: inventory.files,
    },
    operations: inventory.routes.map((operation) => {
      const row = plan.rows.find((item) => item.routeId === operation.operationId);
      const excluded = plan.exclusions.find((item) => item.operationId === operation.operationId);
      if (row !== undefined) {
        return {
          method: operation.method,
          path: operation.path,
          operationId: operation.operationId,
          sourceFile: operation.sourceFile,
          exclude: false,
          tool: row.tool,
          action: row.action,
          write: row.write,
          destructive: row.destructive,
          summary: row.summary,
        };
      }
      if (excluded !== undefined) {
        return {
          method: operation.method,
          path: operation.path,
          operationId: operation.operationId,
          sourceFile: operation.sourceFile,
          exclude: true,
          reason: excluded.reason,
        };
      }
      throw new Error(`Missing plan for ${operation.operationId}`);
    }),
  };
}

function main() {
  const writeInventory = process.argv.includes("--write-inventory");
  const check = process.argv.includes("--check");
  // --check ignores ZIPLINE_SOURCE_ROOT so a public test run never reads an external tree.
  // Pass --source-root to compare a checkout to the committed inventory.
  const sourceRoot =
    readFlag("--source-root") ?? (check ? undefined : process.env["ZIPLINE_SOURCE_ROOT"]);
  let inventory;
  if (sourceRoot !== undefined && sourceRoot.length > 0) {
    const extracted = extractInventory(sourceRoot);
    if (writeInventory) {
      mkdirSync(join(root, "spec"), { recursive: true });
      writeFileSync(specPath, `${JSON.stringify(extracted, null, 2)}\n`);
      inventory = extracted;
    } else {
      inventory = loadInventory();
      if (inventory.routeTreeSha256 !== extracted.routeTreeSha256) {
        throw new Error(
          "Extracted route tree does not match spec/api-inventory.json. Review the diff, then re-run with --write-inventory.",
        );
      }
      if (inventory.packageJsonSha256 !== extracted.packageJsonSha256) {
        throw new Error("package.json hash does not match spec/api-inventory.json");
      }
    }
  } else if (writeInventory) {
    throw new Error("--write-inventory needs --source-root or ZIPLINE_SOURCE_ROOT");
  } else {
    inventory = loadInventory();
  }
  const spec = inventory.routes;
  const plan = planOperations(spec);
  const mappedKeys = new Set(plan.rows.map((row) => `${row.method} ${row.path}`));
  if (!mappedKeys.has("PATCH /api/user/files/{id}")) {
    throw new Error("file PATCH must be mapped");
  }
  const routesJson = `${JSON.stringify(catalog(inventory, plan), null, 2)}\n`;
  const operationsTs = emitOperations(plan.rows, plan.exclusions);
  if (check) {
    const routesNow = readFileSync(routesPath, "utf8");
    const operationsNow = readFileSync(outPath, "utf8");
    if (routesNow !== routesJson || operationsNow !== operationsTs) {
      throw new Error(
        "Generated registry does not match spec/api-inventory.json. Run npm run gen:operations.",
      );
    }
  } else {
    writeFileSync(routesPath, routesJson);
    writeFileSync(outPath, operationsTs);
  }
  const mappedCount = catalog(inventory, plan).operations.filter(
    (row) => row.exclude !== true,
  ).length;
  process.stderr.write(
    `zipline v${inventory.version}: ${mappedCount} mapped routes, ${plan.exclusions.length} excluded, ${plan.rows.length} tool actions (aliases included), spec ${spec.length}, routeTree ${inventory.routeTreeSha256}\n`,
  );
}

const invoked =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  main();
}
