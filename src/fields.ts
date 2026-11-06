import { z } from "zod";
import { confirmField } from "./confirm.js";
import { fixedError } from "./zod-messages.js";

export { confirmField };

const actionError = fixedError("action must be a published Zipline operation for this tool");
const idError = fixedError("id must be a non-empty string");
const nameError = fixedError("name must be 1 to 128 characters");
const colorError = fixedError("color must be a CSS hex color such as #09f or #0099ff");
const urlError = fixedError("destination must be an http or https URL up to 2048 characters");
const pageError = fixedError("page must be an integer from 1 to 1000000");
const perpageError = fixedError("perpage must be an integer from 1 to 200");
const maxViewsError = fixedError("maxViews must be an integer from 0 to 1000000000");
const maxUsesError = fixedError("maxUses must be an integer from 1 to 1000000");
const expiresError = fixedError("expiresAt must be never or a duration such as 1d, 2h, or 30m");
const childrenError = fixedError("childrenAction must be root, folder, cascade, or cascade-files");
const folderDeleteError = fixedError("deleteMode must be file or folder");
const searchFieldError = fixedError("searchField must be name, originalName, type, tags, or id");
const urlSearchError = fixedError("searchField must be destination, vanity, or code");
const filterError = fixedError("filter must be dashboard, none, or all");
const sortError = fixedError(
  "sortBy must be id, createdAt, updatedAt, deletesAt, name, originalName, size, type, views, or favorite",
);
const orderError = fixedError("order must be asc or desc");

export const idField = z.string().trim().min(1, { error: idError }).max(128, { error: idError });

export function optionalText(max: number, label: string) {
  const error = fixedError(`${label} must be at most ${max} characters`);
  return z.string().max(max, { error }).optional();
}

export function actionField(actions: [string, ...string[]]): z.ZodType<string> {
  return z.enum(actions, { error: actionError }).describe("Zipline operation to call.");
}

const httpUrl = z
  .string()
  .trim()
  .min(1, { error: urlError })
  .max(2048, { error: urlError })
  .check(
    z.refine(
      (value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      },
      { error: urlError },
    ),
  );

const boolQuery = z.boolean().optional();

export const filesInput = z
  .object({
    action: actionField(["list", "get", "update", "favorite", "delete"]),
    id: idField.optional().describe("File id or name for get, update, favorite, and delete."),
    page: z
      .number()
      .int()
      .min(1, { error: pageError })
      .max(1_000_000, { error: pageError })
      .optional(),
    perpage: z
      .number()
      .int()
      .min(1, { error: perpageError })
      .max(200, { error: perpageError })
      .optional(),
    filter: z.enum(["dashboard", "none", "all"], { error: filterError }).optional(),
    favorite: z
      .boolean()
      .optional()
      .describe("Filter list by favourite, or set favourite on update."),
    sortBy: z
      .enum(
        [
          "id",
          "createdAt",
          "updatedAt",
          "deletesAt",
          "name",
          "originalName",
          "size",
          "type",
          "views",
          "favorite",
        ],
        { error: sortError },
      )
      .optional(),
    order: z.enum(["asc", "desc"], { error: orderError }).optional(),
    searchField: z
      .enum(["name", "originalName", "type", "tags", "id"], { error: searchFieldError })
      .optional(),
    searchQuery: optionalText(500, "searchQuery"),
    folder: idField.optional().describe("Folder id to filter the file list."),
    maxViews: z
      .number()
      .int()
      .min(0, { error: maxViewsError })
      .max(1_000_000_000, { error: maxViewsError })
      .optional(),
    password: z.string().max(512).nullable().optional(),
    originalName: optionalText(255, "originalName"),
    type: optionalText(255, "type"),
    tags: z.array(idField).max(50).optional(),
    name: optionalText(255, "name"),
    anonymous: z.boolean().optional(),
    confirm: confirmField,
  })
  .strict();

export const foldersInput = z
  .object({
    action: actionField(["list", "get", "create", "update", "add", "remove", "delete"]),
    id: idField.optional().describe("Folder id for get, update, add, remove, and delete."),
    fileId: idField.optional().describe("File id for add and remove."),
    name: z.string().trim().min(1, { error: nameError }).max(128, { error: nameError }).optional(),
    isPublic: boolQuery,
    allowUploads: z.boolean().optional(),
    parentId: z.string().trim().min(1).max(128).nullable().optional(),
    files: z.array(idField).max(100).optional(),
    noincl: z.boolean().optional(),
    root: z.boolean().optional(),
    childrenAction: z
      .enum(["root", "folder", "cascade", "cascade-files"], { error: childrenError })
      .optional(),
    targetFolderId: idField.optional(),
    deleteMode: z.enum(["file", "folder"], { error: folderDeleteError }).optional(),
    confirm: confirmField,
  })
  .strict();

export const urlsInput = z
  .object({
    action: actionField(["list", "get", "shorten", "update", "delete"]),
    id: idField.optional(),
    destination: httpUrl.optional(),
    vanity: z.string().trim().min(1).max(100).nullable().optional(),
    enabled: z.boolean().optional(),
    password: z.string().max(512).nullable().optional(),
    maxViews: z
      .number()
      .int()
      .min(0, { error: maxViewsError })
      .max(1_000_000_000, { error: maxViewsError })
      .optional(),
    domain: optionalText(255, "domain"),
    searchField: z.enum(["destination", "vanity", "code"], { error: urlSearchError }).optional(),
    searchQuery: optionalText(500, "searchQuery"),
    confirm: confirmField,
  })
  .strict();

export const invitesInput = z
  .object({
    action: actionField(["list", "get", "create", "delete"]),
    id: idField.optional(),
    expiresAt: z
      .string()
      .trim()
      .min(1, { error: expiresError })
      .max(64, { error: expiresError })
      .regex(/^(never|[0-9]+[smhdw])$/i, { error: expiresError })
      .optional(),
    maxUses: z
      .number()
      .int()
      .min(1, { error: maxUsesError })
      .max(1_000_000, { error: maxUsesError })
      .optional(),
    confirm: confirmField,
  })
  .strict();

export const tagsInput = z
  .object({
    action: actionField(["list", "get", "create", "update", "delete"]),
    id: idField.optional(),
    name: z.string().trim().min(1, { error: nameError }).max(128, { error: nameError }).optional(),
    color: z
      .string()
      .regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { error: colorError })
      .optional(),
    confirm: confirmField,
  })
  .strict();

export const infoInput = z
  .object({
    action: actionField(["me", "stats", "instance", "health"]),
    from: optionalText(40, "from"),
    to: optionalText(40, "to"),
    all: z.boolean().optional(),
  })
  .strict();

export type FilesInput = z.output<typeof filesInput>;
export type FoldersInput = z.output<typeof foldersInput>;
export type UrlsInput = z.output<typeof urlsInput>;
export type InvitesInput = z.output<typeof invitesInput>;
export type TagsInput = z.output<typeof tagsInput>;
export type InfoInput = z.output<typeof infoInput>;
