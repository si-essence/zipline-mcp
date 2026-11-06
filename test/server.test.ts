import { describe, expect, it } from "vitest";
import { CONNECTOR_NAME } from "../src/constants.js";
import { jsonFetch, jsonResponse, runtimeFor } from "./harness.js";
import { connectServer } from "./mcp.js";

describe("server", () => {
  it("publishes six tools on the zipline-mcp server", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse({}));
    const runtime = runtimeFor(fetchImpl);
    const { client, close } = await connectServer(runtime);
    try {
      expect(CONNECTOR_NAME).toBe("zipline-mcp");
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(6);
    } finally {
      await close();
    }
  });
});
