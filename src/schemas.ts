import { z } from "zod";

export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const jsonValueSchema = z.unknown();

export const fileSchema = z
  .object({
    id: z.string(),
  })
  .loose();

export const fileListSchema = z
  .object({
    page: z.array(z.unknown()).optional(),
    total: z.number().optional(),
    pages: z.number().optional(),
  })
  .loose();

export const folderSchema = z
  .object({
    id: z.string(),
  })
  .loose();

export const urlSchema = z
  .object({
    id: z.string(),
  })
  .loose();

export const inviteSchema = z
  .object({
    id: z.string(),
  })
  .loose();

export const tagSchema = z
  .object({
    id: z.string(),
  })
  .loose();

export const healthSchema = z
  .object({
    pass: z.boolean().optional(),
    status: z.string().optional(),
  })
  .loose();

export const statsSchema = z
  .object({
    filesUploaded: z.number().optional(),
  })
  .loose();

export const instanceSchema = z
  .object({
    latest: z.unknown().optional(),
    points: z.array(z.unknown()).optional(),
  })
  .loose();

export const userEnvelopeSchema = z.unknown();

export const listSchema = z.union([z.array(z.unknown()), jsonObjectSchema]);
