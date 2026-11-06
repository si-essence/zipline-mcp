import { z } from "zod";
import { fixedError } from "./zod-messages.js";

const confirmError = fixedError("confirm must be a boolean");

/** Boolean true executes. Omit and false are dry-runs. The string "true" fails Zod. */
export const confirmField = z
  .boolean({ error: confirmError })
  .optional()
  .describe(
    "Boolean true runs the write when ZIPLINE_ALLOW_WRITES is true. Omit it or pass false for a dry-run preview that sends nothing. The string true is rejected.",
  );
