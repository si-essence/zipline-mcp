import { loadConfig } from "../src/config.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

export const API_TOKEN = "super-secret/key+value=99";
export const BASE = "https://zipline.test";

export function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ZIPLINE_URL: BASE,
    ZIPLINE_TOKEN: API_TOKEN,
    ZIPLINE_CACHE_TTL_SEC: "0",
    ZIPLINE_ALLOW_WRITES: "true",
    ...extra,
  };
}

export function runtimeFor(
  fetchImpl: typeof fetch,
  extra: NodeJS.ProcessEnv = {},
  now?: () => number,
): Runtime {
  return createRuntime(loadConfig(env(extra), []), {
    fetchImpl,
    ...(now === undefined ? {} : { now }),
  });
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export interface CapturedRequest {
  method: string;
  url: string;
  authorization: string | null;
  accept: string | null;
  contentType: string | null;
  extraHeaders: Record<string, string>;
  redirect: RequestRedirect | undefined;
  body: unknown;
}

export function capturedFrom(input: RequestInfo | URL, init?: RequestInit): CapturedRequest {
  const headers = new Headers(init?.headers);
  let body: unknown;
  if (init?.body === undefined) body = undefined;
  else if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      body = init.body;
    }
  } else body = init.body;
  const extraHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    extraHeaders[key] = value;
  });
  return {
    method: init?.method ?? "GET",
    url: requestUrl(input),
    authorization: headers.get("authorization"),
    accept: headers.get("accept"),
    contentType: headers.get("content-type"),
    extraHeaders,
    redirect: init?.redirect,
    body,
  };
}

export function jsonFetch(impl: (captured: CapturedRequest) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const captured = capturedFrom(input, init);
    calls.push(captured);
    return Promise.resolve(impl(captured));
  };
  return { fetchImpl, calls };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  const extra = headers ?? {};
  if (body === null || body === undefined) {
    return new Response(null, { status, headers: extra });
  }
  if (typeof body === "string") {
    return new Response(body, {
      status,
      headers: { "content-type": "text/plain", ...extra },
    });
  }
  return Response.json(body, { status, headers: extra });
}

export const FILE = {
  id: "file1",
  name: "abc123.txt",
  originalName: "note.txt",
  favorite: false,
  maxViews: 0,
};

export const FOLDER = { id: "folder1", name: "inbox", public: false };
export const SHORT = {
  id: "url1",
  destination: "https://example.com/page",
  code: "abc",
  vanity: null,
};
export const INVITE = { id: "inv1", code: "invite01", maxUses: 1 };
export const TAG = { id: "tag1", name: "docs", color: "#09f" };
