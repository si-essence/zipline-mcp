# Live check

Checked against a local official Zipline v4.8.2 process on `127.0.0.1:8099`. The database is the throwaway PGlite directory used only by that process. `scripts/live-check.mjs` speaks to `dist/index.js` over stdio. The token stays in a chmod 600 file outside this repo. The script unsets `DATABASE_URL`.

## How to run it again

```bash
unset DATABASE_URL
export ZIPLINE_URL=http://127.0.0.1:8099
export ZIPLINE_TOKEN_FILE=/path/to/api.token
npm run build
npm run live-check
```

`ZIPLINE_TOKEN` may replace the file. A missing token exits 1. The script prints pass and fail lines. It does not print the token.

## Failed boots

These attempts produced no MCP rows.

The previous session wrote a pid and left `zipline.log` with only the Node `NO_COLOR` / `FORCE_COLOR` warning. That process was dead before this session. Port 8099 was not listening. No live-check command had been run.

The first start in this session reached `server started` on `127.0.0.1:8099`, then exited. The log shows `ERR_MODULE_NOT_FOUND` for `build/offload/thumbnails.js`. Dev mode with thumbnails enabled loads that built worker, and `tsx src/server` does not emit it. Healthcheck was not up. The MCP script was not started.

A later start on the already initialized PGlite directory, with `DATABASE_URL` unset, made the server healthy and then failed before login. `start.sh` printed:

```
Waiting for http://127.0.0.1:8099/api/healthcheck
setup status HTTP 403
```

Exit code 1. `GET /api/healthcheck` was HTTP 200 and the body contained `"pass":true`. The coordinator log is `/workspace/tools/zipline/coordinator-start.log`. The coordinator then ran `stop.sh`. No live-check ran.

The same command was run again before the seed script was changed. Same two lines, exit code 1, health HTTP 200. Official `GET /api/setup` returns 200 `{ firstSetup: true }` only before the first user exists. After that it throws `ApiError` 9001, which is HTTP 403 (`src/server/routes/api/setup.ts` and `src/lib/api/errors.ts`). The seed script treated every status other than 200 and 400 as fatal, so it never called `POST /api/auth/login` or `GET /api/user/token`. The database was not reset.

## Final run

`FEATURES_THUMBNAILS_ENABLED=false` is set in the local start script. After that, `GET /api/healthcheck` returned `{"pass":true}`. The first MCP live check then finished with 34 pass and 0 fail. Exit code 0. Nothing in stdout or stderr contained the API token, the admin password, or the core secret.

What passed:

- Official `POST /api/upload` seeded one text file. The connector does not upload.
- Tool list was the six tools.
- `me` returned id, username, role, timestamps, `totpEnabled`, and `quota`. Quota was JSON `null` for this fresh super-admin. The word token was absent.
- User stats returned numeric counters, including `filesUploaded` 1.
- Instance stats returned an object that has `latest`.
- Health returned `pass` true.
- File list returned a `page` array.
- Shorten with confirm omitted and writes enabled returned a preview. A follow-up list did not contain that destination.
- Shorten with `confirm: true` and `ZIPLINE_ALLOW_WRITES` not `true` returned `blocked` true and `executed` false. The destination was still absent.
- Confirmed shorten, get, and update. Update set `enabled` false.
- Folder create, get, and update.
- Tag create, get, and update.
- File get, favourite, and metadata update. The update warning states that v4.8.2 file PATCH has no `expiresAt`.
- Add file to folder and remove file from folder.
- Invite create with `expiresAt` `never`, get, and list. The created invite's `expiresAt` was JSON `null`.
- Unknown URL id returned `[not-found]` and HTTP 404.
- Destination `not-a-url` with `confirm: true` failed in the client with MCP `-32602` before a write. The message names the destination rule.
- A wrong token on `me` returned `[unauthorized]` and HTTP 401.
- Cleanup deleted the file, folder, tag, invite, and short URL. Each cleanup reported `executed` true.

## Repeatable restart

`seed-token.mjs` now treats setup HTTP 403 as an already configured instance. It still uses `POST /api/setup` only when `firstSetup` is true, then `POST /api/auth/login` and `GET /api/user/token`. It does not call token `PATCH`, so the stored user secret is not rotated. `GET /api/user/token` encrypts that secret with a fresh IV, so the chmod 600 token file is rewritten on each start and the previous ciphertext still decrypts with the same core secret.

After that change, with `DATABASE_URL` unset:

1. Stop, then `start.sh`. Exit 0. Stdout was the health wait, `token file written`, and `Zipline listening on 127.0.0.1:8099`. The password, API token, and core secret were absent from that stdout and from `zipline.log`.
2. `npm run live-check` with `ZIPLINE_URL=http://127.0.0.1:8099` and `ZIPLINE_TOKEN_FILE` set to the token file. Exit 0. Last line `PASS  34/34`. Stdout did not contain the password, token, or core secret. Cleanup deleted the seeded file, folder, tag, invite, and short URL.
3. Stop, then `start.sh` again. Exit 0. Same stdout lines. Token file mode stayed `600`.
4. `npm run live-check` again with the same URL and token file. Exit 0. Last line `PASS  34/34`. Secret scan of stdout was clean.
5. `stop.sh`. Port 8099 was not listening afterwards. The unrelated PHP process on port 8098 was left running.

`npm run ci` in this review ran 43 tests in 9 files. Typecheck, lint, tests, and build passed. `node scripts/gen-operations.mjs --check` reported 28 mapped routes, 64 excluded, 30 tool actions, and 92 spec routes.

## Not exercised on the server

HTTP 422 and HTTP 429 were not requested from Zipline. Unit tests simulate both, and the 429 test checks that fetch runs once. Forcing a real 429 was out of scope.

File expiry was not set. Upload headers can carry `x-zipline-deletes-at`. The file tool rejects `expiresAt` and does not upload.

Thumbnail generation was off so the process could stay up under `tsx`.
