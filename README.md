# zipline-mcp

MCP connector for a self-hosted [Zipline](https://github.com/diced/zipline) v4.8.2 instance. It speaks the official JSON API over stdio and over stateless Streamable HTTP on localhost.

Zipline is MIT software. This connector does not copy the application. It is not affiliated with diced/zipline.

`spec/api-inventory.json` is a compact extraction of every `server.get|post|put|patch|delete` on an `export const PATH` under `src/server/routes/api` in Zipline v4.8.2. It records the release version, the official `package.json` sha256, each route-file sha256, and `routeTreeSha256`. `scripts/gen-operations.mjs` maps that inventory onto tool actions or exclusions and writes `src/operations.ts` and `zipline.routes.json`. A route that is neither mapped nor excluded fails generation. Do not edit `src/operations.ts` by hand. Default generation reads only the committed inventory.

`ZIPLINE_URL` and `ZIPLINE_TOKEN` are required. There is no default origin. Each request sends `Authorization: <token>` with no Bearer prefix, matching `src/server/middleware/user.ts`.

## Setup

```bash
npm install
npm run ci
npm start
npm run start:http
```

`npm start` speaks stdio. `npm run start:http` serves Streamable HTTP at `http://127.0.0.1:3000/mcp` and `GET /health`. HTTP mode has no authentication of its own. Keep it on localhost.

```json
{
  "mcpServers": {
    "zipline": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "ZIPLINE_URL": "http://127.0.0.1:8099",
        "ZIPLINE_TOKEN": "...",
        "ZIPLINE_ALLOW_WRITES": "false"
      }
    }
  }
}
```

The token is the encrypted API token from the Zipline dashboard or `GET /api/user/token`. It is not a session cookie. The connector never prints it.

HTTP mode has no authentication of its own. Keep it on localhost. Do not put secrets in a Docker image.

```bash
docker build -t zipline-mcp .
docker run -p 127.0.0.1:3000:3000 \
  -e ZIPLINE_URL=http://127.0.0.1:8099 \
  -e ZIPLINE_TOKEN=... \
  zipline-mcp
```

Regenerate the registry from the committed inventory.

```bash
npm run gen:operations
node scripts/gen-operations.mjs --check
```

Refresh the inventory from an official v4.8.2 tree. This is the only command that reads route source.

```bash
node scripts/gen-operations.mjs --source-root /path/to/zipline --write-inventory
node scripts/gen-operations.mjs --source-root /path/to/zipline --check
```

`ZIPLINE_SOURCE_ROOT` is accepted by a write run. `--check` ignores that variable unless you also pass `--source-root`.

`scripts/live-check.mjs` talks to a real server over stdio. Set `ZIPLINE_URL`. Set `ZIPLINE_TOKEN` or `ZIPLINE_TOKEN_FILE` to a chmod 600 file outside this repo. The script unsets `DATABASE_URL`. It prints pass or fail lines only, and it redacts the token. It does not run inside `npm run ci`. A missing token is a failure.

## Config

| Variable                | Meaning                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ZIPLINE_URL`           | Required. Origin only, `http` or `https`, no userinfo, query, hash, or path. Example `http://127.0.0.1:8099`.            |
| `ZIPLINE_TOKEN`         | Required. Encrypted API token sent as `Authorization` with no Bearer prefix. Redacted in logs, errors, and tool results. |
| `ZIPLINE_ALLOW_WRITES`  | Must be the literal `true` before a confirmed write is sent.                                                             |
| `ZIPLINE_PER_MINUTE`    | Local request budget. Default 30. Cache hits do not spend it.                                                            |
| `ZIPLINE_TIMEOUT_MS`    | Upstream timeout. Default 20000.                                                                                         |
| `ZIPLINE_CACHE_TTL_SEC` | Read cache TTL. Default 60. Writes clear the cache.                                                                      |
| `ZIPLINE_CONTACT`       | Contact token in the User-Agent. Must not contain the API token.                                                         |
| `MCP_TRANSPORT`         | `stdio` or `http`. `--http` overrides.                                                                                   |
| `PORT`                  | HTTP port. Default 3000.                                                                                                 |

Invalid values are reported by field name and issue code. The rejected value is not included.

Calls go to `/api/...` paths from the operations registry. `Accept` is `application/json`. JSON writes send `Content-Type: application/json`. Redirects are refused so the token is not forwarded. There are no automatic retries.

## Safety

Reads run without a write flag. A write is sent only when `confirm` is the boolean `true` and `ZIPLINE_ALLOW_WRITES=true`. Omit `confirm`, or pass boolean `false`, and the tool returns a dry-run preview of method, path, query, headers, and body. It sends nothing. `blocked` is false on that preview, whether or not writes are enabled. `confirm: true` with writes disabled returns the same preview with `blocked` true and the reason `ZIPLINE_ALLOW_WRITES is not true. The write was not sent.` The string `"true"` is rejected.

False, zero, and null fields that you pass are kept on the wire. Omitted fields are dropped.

HTTP 401 is unauthorized. HTTP 403 is forbidden (including invite routes for a non-admin). HTTP 400 and 422 are invalid input. HTTP 404 is not found. HTTP 409 is conflict. HTTP 429 includes Retry-After when the header is present. Other failures are server, network, or timeout. Response bodies are capped at 1,000,000 bytes.

The token, Authorization header, password, and session fields are redacted in logs, errors, and tool results. Upstream JSON error bodies are parsed and those fields are replaced before the text is returned or logged. A password you sent is also stripped from the error text when it is at least 8 characters. `GET /api/user` is projected to id, username, role, timestamps, totpEnabled, and quota.

## Tools

Six tools. Each takes `action` plus the fields for that action.

| Tool              | Actions                                        | Routes                                                                           |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `zipline_files`   | list, get, update, favorite, delete            | GET `/api/user/files`, GET/PATCH/DELETE `/api/user/files/{id}`                   |
| `zipline_folders` | list, get, create, update, add, remove, delete | GET/POST `/api/user/folders`, GET/PUT/PATCH/DELETE `/api/user/folders/{id}`      |
| `zipline_urls`    | list, get, shorten, update, delete             | GET/POST `/api/user/urls`, GET/PATCH/DELETE `/api/user/urls/{id}`                |
| `zipline_invites` | list, get, create, delete                      | GET/POST `/api/auth/invites`, GET/DELETE `/api/auth/invites/{id}`                |
| `zipline_tags`    | list, get, create, update, delete              | GET/POST `/api/user/tags`, GET/PATCH/DELETE `/api/user/tags/{id}`                |
| `zipline_info`    | me, stats, instance, health                    | GET `/api/user`, GET `/api/user/stats`, GET `/api/stats`, GET `/api/healthcheck` |

`zipline_files` `list` is `GET /api/user/files` with `page` (default 1), `perpage`, `filter`, `favorite`, `sortBy`, `order`, `searchField`, `searchQuery`, and `folder`. `get` needs `id`.

`update` needs `id` and at least one of `favorite`, `maxViews`, `password`, `originalName`, `type`, `tags`, `name`, `anonymous`. `favorite` is the same PATCH with only the favourite flag. `expiresAt` is not a v4.8.2 PATCH field. Passing it is rejected. File expiry exists only on upload headers. This connector does not upload.

`zipline_folders` `add` is PUT with body `{ id: fileId }`. `remove` is DELETE with `{ delete: "file", id: fileId }`. `delete` is DELETE with `{ delete: "folder" }` and optional `childrenAction`.

`zipline_urls` `shorten` needs `destination`. Optional `maxViews`, `password`, and `domain` are sent as `x-zipline-max-views`, `x-zipline-password`, and `x-zipline-domain`.

`zipline_invites` needs an administrator or super-admin role. Create needs `expiresAt` (`never` or a duration such as `1d`).

`zipline_info` `me` returns a whitelist of profile fields. Token and session data from the API are dropped.

28 of 92 official `/api` routes are mapped. 64 are excluded (upload, browser login, admin settings, token rotation, binary download). See `zipline.routes.json`.

## Other MCP servers

[dorogoy/zipline-mcp](https://github.com/dorogoy/zipline-mcp) (MIT) registers 12 tools in `src/index.ts`. The README lists `upload_file_to_zipline`, `validate_file`, `tmp_file_manager`, `download_external_url`, `list_user_files`, `get_user_file`, `update_user_file`, `delete_user_file`, and `remote_folder_manager` with list, add, edit, info, and delete. Source also registers `batch_file_operation`, `get_usage_stats`, and a health check. `get_usage_stats` already returns quota and stats, so those reads are not unique here. `update_user_file` already supports favourite, maxViews, password, originalName, type, tags, and name. Folder tools already exist. Upload-command previews exist.

`delete_user_file` in `src/index.ts` (registration around lines 1263-1301 on the default branch read on 6 Nov 2026) calls `deleteUserFile` immediately. There is no `confirm` argument and no write-environment guard on that call. `batch_file_operation` (around lines 1540-1647) calls `deleteUserFile` and `editFolder` the same way. `src/remoteFolders.ts` sends POST, PATCH, PUT, and DELETE directly. A search of those two files found no `confirm` input and no `ALLOW_WRITES` check. The rival README does not document a global confirm plus env gate. The source is the evidence for the delete path, not the README's silence.

This connector does not add local filesystem or external URL download tools. Every write, including favourite, shorten, invite, tag, and folder changes, is sent only when `confirm` is true and `ZIPLINE_ALLOW_WRITES=true`. Omit `confirm` or pass false and the tool returns a preview and sends nothing. The extra domains, where the official API supports them, are short URLs, invites, and tags. Stats, quota, and health overlap the rival. The route inventory is pinned to v4.8.2.

## Limitations

- Zipline v4.8.2 `PATCH /api/user/files/:id` has no `expiresAt` field. The body is favorite, maxViews, password, originalName, type, tags, name, and anonymous (`src/server/routes/api/user/files/[id]/index.ts`). There is no expire action. Passing `expiresAt` on file update is a validation error. It is not dropped.
- Upload and partial upload are excluded. `POST /api/upload` accepts `x-zipline-deletes-at`. That is the upload-time expiry header. This connector does not upload, so it cannot set expiry. Seed files for live checks with the official upload API outside the tool.
- Invite routes return HTTP 403 for a non-admin token.
- `GET /api/stats` follows the instance metrics flags. An empty `latest` point is still a successful read.
- Token rotation (`GET`/`PATCH /api/user/token`) is excluded so the connector never returns a token.

## Live check

See `LIVE-CHECK.md` for the failed boots, including the HTTP 403 from `GET /api/setup` on an already configured database, and for the later live runs. Each completed live run was 34 pass and 0 fail. HTTP 422 and HTTP 429 were not produced on that server. Unit tests simulate those statuses, and the 429 test checks that fetch runs once. The live invalid-input case is rejected by Zod before any request.

`npm run ci` on 6 Nov 2026 ran 43 tests in 9 files. Typecheck, lint, test, and build passed. `node scripts/gen-operations.mjs --check` reported 28 mapped routes, 64 excluded, 30 tool actions, and 92 routes in the spec.

Run `unset DATABASE_URL`, set `ZIPLINE_URL`, and set `ZIPLINE_TOKEN` or `ZIPLINE_TOKEN_FILE`. Then run `npm run live-check`. The script never prints the API token.

## License

MIT. Zipline itself is MIT. This connector only talks to the published JSON API.
