import { ConnectorError } from "./errors.js";
import type {
  FilesInput,
  FoldersInput,
  InfoInput,
  InvitesInput,
  TagsInput,
  UrlsInput,
} from "./fields.js";
import { definedBody, definedHeaders, definedQuery, fillPath, asJsonObject } from "./json.js";
import { requireOp, type Operation } from "./operations.js";
import { sanitizeMe } from "./profile.js";
import type { Runtime } from "./runtime.js";
import {
  fileListSchema,
  fileSchema,
  folderSchema,
  healthSchema,
  instanceSchema,
  inviteSchema,
  jsonValueSchema,
  listSchema,
  statsSchema,
  tagSchema,
  urlSchema,
  userEnvelopeSchema,
} from "./schemas.js";
import { withWrite, type WritePlan } from "./write-gate.js";

function requireId(id: string | undefined, label = "id"): string {
  if (id === undefined || id.length === 0) {
    throw new ConnectorError("input", `${label} is required for this action.`);
  }
  return id;
}

function qsBool(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? "true" : "false";
}

function planFor(
  operation: Operation,
  path: string,
  body: unknown,
  query: ReturnType<typeof definedQuery>,
  headers: ReturnType<typeof definedHeaders>,
): WritePlan {
  if (operation.method === "GET") {
    throw new ConnectorError("config", "Write plan cannot use GET.");
  }
  return {
    method: operation.method,
    path,
    query,
    body,
    headers,
    summary: operation.summary,
    warnings: operation.warnings,
  };
}

export async function handleFiles(
  runtime: Runtime,
  args: FilesInput,
): Promise<Record<string, unknown>> {
  if (args.action === "list") {
    const items = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_files", "list").path, {}),
        query: definedQuery({
          page: args.page ?? 1,
          perpage: args.perpage,
          filter: args.filter,
          favorite: qsBool(args.favorite),
          sortBy: args.sortBy,
          order: args.order,
          searchField: args.searchField,
          searchQuery: args.searchQuery,
          folder: args.folder,
        }),
        ttlSec: runtime.cacheTtlSec,
      },
      fileListSchema,
    );
    return asJsonObject(items);
  }
  if (args.action === "get") {
    const id = requireId(args.id);
    const file = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_files", "get").path, { id }),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      fileSchema,
    );
    return asJsonObject(file);
  }
  if (args.action === "favorite") {
    const id = requireId(args.id);
    if (args.favorite === undefined) {
      throw new ConnectorError("input", "favorite is required for action favorite.");
    }
    const operation = requireOp("zipline_files", "favorite");
    const body = { favorite: args.favorite };
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.patchJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        fileSchema,
      );
      return asJsonObject(updated);
    });
  }
  if (args.action === "update") {
    const id = requireId(args.id);
    const body = definedBody({
      favorite: args.favorite,
      maxViews: args.maxViews,
      password: args.password,
      originalName: args.originalName,
      type: args.type,
      tags: args.tags,
      name: args.name,
      anonymous: args.anonymous,
    });
    if (body === undefined) {
      throw new ConnectorError("input", "Provide at least one file field to update.");
    }
    const operation = requireOp("zipline_files", "update");
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.patchJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        fileSchema,
      );
      return asJsonObject(updated);
    });
  }
  const id = requireId(args.id);
  const operation = requireOp("zipline_files", "delete");
  const plan = planFor(
    operation,
    fillPath(operation.path, { id }),
    undefined,
    undefined,
    undefined,
  );
  return withWrite(runtime, args.confirm, plan, async () => {
    const deleted = await runtime.client.deleteJson(
      { path: plan.path, query: undefined, body: undefined, headers: undefined },
      fileSchema,
    );
    return asJsonObject(deleted);
  });
}

export async function handleFolders(
  runtime: Runtime,
  args: FoldersInput,
): Promise<Record<string, unknown>> {
  if (args.action === "list") {
    const items = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_folders", "list").path, {}),
        query: definedQuery({
          noincl: qsBool(args.noincl),
          parentId: args.parentId === null ? undefined : args.parentId,
          root: qsBool(args.root),
        }),
        ttlSec: runtime.cacheTtlSec,
      },
      listSchema,
    );
    return asJsonObject(items);
  }
  if (args.action === "get") {
    const id = requireId(args.id);
    const folder = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_folders", "get").path, { id }),
        query: definedQuery({ noincl: qsBool(args.noincl) }),
        ttlSec: runtime.cacheTtlSec,
      },
      folderSchema,
    );
    return asJsonObject(folder);
  }
  if (args.action === "create") {
    if (args.name === undefined) {
      throw new ConnectorError("input", "name is required for action create.");
    }
    const operation = requireOp("zipline_folders", "create");
    const body = definedBody({
      name: args.name,
      isPublic: args.isPublic,
      files: args.files,
      parentId: args.parentId === null ? undefined : args.parentId,
    });
    const plan = planFor(operation, fillPath(operation.path, {}), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const created = await runtime.client.postJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        folderSchema,
      );
      return asJsonObject(created);
    });
  }
  if (args.action === "update") {
    const id = requireId(args.id);
    const body = definedBody({
      isPublic: args.isPublic,
      name: args.name,
      allowUploads: args.allowUploads,
      parentId: args.parentId,
    });
    if (body === undefined) {
      throw new ConnectorError("input", "Provide at least one folder field to update.");
    }
    const operation = requireOp("zipline_folders", "update");
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.patchJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        folderSchema,
      );
      return asJsonObject(updated);
    });
  }
  if (args.action === "add") {
    const id = requireId(args.id);
    const fileId = requireId(args.fileId, "fileId");
    const operation = requireOp("zipline_folders", "add");
    const body = { id: fileId };
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.putJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        folderSchema,
      );
      return asJsonObject(updated);
    });
  }
  if (args.action === "remove") {
    const id = requireId(args.id);
    const fileId = requireId(args.fileId, "fileId");
    const operation = requireOp("zipline_folders", "remove");
    const body = { delete: "file", id: fileId };
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.deleteJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        jsonValueSchema,
      );
      return asJsonObject(updated);
    });
  }
  const id = requireId(args.id);
  const operation = requireOp("zipline_folders", "delete");
  const body = definedBody({
    delete: args.deleteMode ?? "folder",
    childrenAction: args.childrenAction,
    targetFolderId: args.targetFolderId,
  });
  const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
  return withWrite(runtime, args.confirm, plan, async () => {
    const deleted = await runtime.client.deleteJson(
      { path: plan.path, query: undefined, body, headers: undefined },
      jsonValueSchema,
    );
    return asJsonObject(deleted);
  });
}

export async function handleUrls(
  runtime: Runtime,
  args: UrlsInput,
): Promise<Record<string, unknown>> {
  if (args.action === "list") {
    const items = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_urls", "list").path, {}),
        query: definedQuery({
          searchField: args.searchField,
          searchQuery: args.searchQuery,
        }),
        ttlSec: runtime.cacheTtlSec,
      },
      listSchema,
    );
    return asJsonObject(items);
  }
  if (args.action === "get") {
    const id = requireId(args.id);
    const url = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_urls", "get").path, { id }),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      urlSchema,
    );
    return asJsonObject(url);
  }
  if (args.action === "shorten") {
    if (args.destination === undefined) {
      throw new ConnectorError("input", "destination is required for action shorten.");
    }
    const operation = requireOp("zipline_urls", "shorten");
    const body = definedBody({
      destination: args.destination,
      vanity: args.vanity,
      enabled: args.enabled,
    });
    const headers = definedHeaders({
      "x-zipline-max-views":
        args.maxViews === undefined || args.maxViews === 0 ? undefined : String(args.maxViews),
      "x-zipline-password":
        args.password === undefined || args.password === null ? undefined : args.password,
      "x-zipline-domain": args.domain,
    });
    const plan = planFor(operation, fillPath(operation.path, {}), body, undefined, headers);
    return withWrite(runtime, args.confirm, plan, async () => {
      const created = await runtime.client.postJson(
        { path: plan.path, query: undefined, body, headers },
        urlSchema,
      );
      return asJsonObject(created);
    });
  }
  if (args.action === "update") {
    const id = requireId(args.id);
    const body = definedBody({
      password: args.password,
      vanity: args.vanity,
      maxViews: args.maxViews,
      destination: args.destination,
      enabled: args.enabled,
    });
    if (body === undefined) {
      throw new ConnectorError("input", "Provide at least one URL field to update.");
    }
    const operation = requireOp("zipline_urls", "update");
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.patchJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        urlSchema,
      );
      return asJsonObject(updated);
    });
  }
  const id = requireId(args.id);
  const operation = requireOp("zipline_urls", "delete");
  const plan = planFor(
    operation,
    fillPath(operation.path, { id }),
    undefined,
    undefined,
    undefined,
  );
  return withWrite(runtime, args.confirm, plan, async () => {
    const deleted = await runtime.client.deleteJson(
      { path: plan.path, query: undefined, body: undefined, headers: undefined },
      urlSchema,
    );
    return asJsonObject(deleted);
  });
}

export async function handleInvites(
  runtime: Runtime,
  args: InvitesInput,
): Promise<Record<string, unknown>> {
  if (args.action === "list") {
    const items = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_invites", "list").path, {}),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      listSchema,
    );
    return asJsonObject(items);
  }
  if (args.action === "get") {
    const id = requireId(args.id);
    const invite = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_invites", "get").path, { id }),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      inviteSchema,
    );
    return asJsonObject(invite);
  }
  if (args.action === "create") {
    if (args.expiresAt === undefined) {
      throw new ConnectorError("input", "expiresAt is required for action create.");
    }
    const operation = requireOp("zipline_invites", "create");
    const body = definedBody({
      expiresAt: args.expiresAt,
      maxUses: args.maxUses,
    });
    const plan = planFor(operation, fillPath(operation.path, {}), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const created = await runtime.client.postJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        inviteSchema,
      );
      return asJsonObject(created);
    });
  }
  const id = requireId(args.id);
  const operation = requireOp("zipline_invites", "delete");
  const plan = planFor(
    operation,
    fillPath(operation.path, { id }),
    undefined,
    undefined,
    undefined,
  );
  return withWrite(runtime, args.confirm, plan, async () => {
    const deleted = await runtime.client.deleteJson(
      { path: plan.path, query: undefined, body: undefined, headers: undefined },
      inviteSchema,
    );
    return asJsonObject(deleted);
  });
}

export async function handleTags(
  runtime: Runtime,
  args: TagsInput,
): Promise<Record<string, unknown>> {
  if (args.action === "list") {
    const items = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_tags", "list").path, {}),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      listSchema,
    );
    return asJsonObject(items);
  }
  if (args.action === "get") {
    const id = requireId(args.id);
    const tag = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_tags", "get").path, { id }),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      tagSchema,
    );
    return asJsonObject(tag);
  }
  if (args.action === "create") {
    if (args.name === undefined || args.color === undefined) {
      throw new ConnectorError("input", "name and color are required for action create.");
    }
    const operation = requireOp("zipline_tags", "create");
    const body = { name: args.name, color: args.color };
    const plan = planFor(operation, fillPath(operation.path, {}), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const created = await runtime.client.postJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        tagSchema,
      );
      return asJsonObject(created);
    });
  }
  if (args.action === "update") {
    const id = requireId(args.id);
    const body = definedBody({ name: args.name, color: args.color });
    if (body === undefined) {
      throw new ConnectorError("input", "Provide name or color to update a tag.");
    }
    const operation = requireOp("zipline_tags", "update");
    const plan = planFor(operation, fillPath(operation.path, { id }), body, undefined, undefined);
    return withWrite(runtime, args.confirm, plan, async () => {
      const updated = await runtime.client.patchJson(
        { path: plan.path, query: undefined, body, headers: undefined },
        tagSchema,
      );
      return asJsonObject(updated);
    });
  }
  const id = requireId(args.id);
  const operation = requireOp("zipline_tags", "delete");
  const plan = planFor(
    operation,
    fillPath(operation.path, { id }),
    undefined,
    undefined,
    undefined,
  );
  return withWrite(runtime, args.confirm, plan, async () => {
    const deleted = await runtime.client.deleteJson(
      { path: plan.path, query: undefined, body: undefined, headers: undefined },
      jsonValueSchema,
    );
    return asJsonObject(deleted);
  });
}

export async function handleInfo(
  runtime: Runtime,
  args: InfoInput,
): Promise<Record<string, unknown>> {
  if (args.action === "me") {
    const payload = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_info", "me").path, {}),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      userEnvelopeSchema,
    );
    return sanitizeMe(payload, runtime.secrets);
  }
  if (args.action === "stats") {
    const stats = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_info", "stats").path, {}),
        query: undefined,
        ttlSec: runtime.cacheTtlSec,
      },
      statsSchema,
    );
    return asJsonObject(stats);
  }
  if (args.action === "instance") {
    const stats = await runtime.client.getJson(
      {
        path: fillPath(requireOp("zipline_info", "instance").path, {}),
        query: definedQuery({
          from: args.from,
          to: args.to,
          all: qsBool(args.all),
        }),
        ttlSec: runtime.cacheTtlSec,
      },
      instanceSchema,
    );
    return asJsonObject(stats);
  }
  const health = await runtime.client.getJson(
    {
      path: fillPath(requireOp("zipline_info", "health").path, {}),
      query: undefined,
      ttlSec: runtime.cacheTtlSec,
    },
    healthSchema,
  );
  return asJsonObject(health);
}
