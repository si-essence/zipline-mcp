import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolDescription, toolName } from "./brand.js";
import { CONNECTOR_NAME, CONNECTOR_TITLE, CONNECTOR_VERSION } from "./constants.js";
import {
  filesInput,
  foldersInput,
  infoInput,
  invitesInput,
  tagsInput,
  urlsInput,
} from "./fields.js";
import {
  handleFiles,
  handleFolders,
  handleInfo,
  handleInvites,
  handleTags,
  handleUrls,
} from "./handlers.js";
import { toolIsWrite } from "./operations.js";
import type { Runtime } from "./runtime.js";
import {
  READ_ONLY_REMOTE,
  WRITE_DESTRUCTIVE,
  registerConnectorTool,
  type ToolAnnotations,
  type ToolContext,
} from "./tools.js";

export function createServer(runtime: Runtime): McpServer {
  const server = new McpServer({
    name: CONNECTOR_NAME,
    title: CONNECTOR_TITLE,
    version: CONNECTOR_VERSION,
  });
  const ctx: ToolContext = { secrets: runtime.secrets, logger: runtime.logger };

  registerConnectorTool(
    server,
    {
      name: toolName("zipline_files"),
      description: toolDescription(
        "List, get, update, favourite, and delete Zipline files. List uses page, perpage, filter, favorite, sortBy, order, searchField, searchQuery, and folder. Writes run only when confirm is true and ZIPLINE_ALLOW_WRITES=true. Omit confirm or pass false for a preview that sends nothing. expiresAt is not a v4.8.2 file PATCH field and is rejected. Actions: list, get, update, favorite, delete.",
      ),
      inputSchema: filesInput,
      annotations: annotationsFor("zipline_files"),
      handler: (args) => handleFiles(runtime, args),
    },
    ctx,
  );
  registerConnectorTool(
    server,
    {
      name: toolName("zipline_folders"),
      description: toolDescription(
        "List, get, create, update, add a file to, remove a file from, and delete Zipline folders. Writes run only when confirm is true and ZIPLINE_ALLOW_WRITES=true. Omit confirm or pass false for a preview that sends nothing. Actions: list, get, create, update, add, remove, delete.",
      ),
      inputSchema: foldersInput,
      annotations: annotationsFor("zipline_folders"),
      handler: (args) => handleFolders(runtime, args),
    },
    ctx,
  );
  registerConnectorTool(
    server,
    {
      name: toolName("zipline_urls"),
      description: toolDescription(
        "List, get, shorten, update, and delete Zipline short URLs. Shorten sends destination in JSON and optional maxViews, password, and domain as x-zipline headers. Writes run only when confirm is true and ZIPLINE_ALLOW_WRITES=true. Omit confirm or pass false for a preview that sends nothing. Actions: list, get, shorten, update, delete.",
      ),
      inputSchema: urlsInput,
      annotations: annotationsFor("zipline_urls"),
      handler: (args) => handleUrls(runtime, args),
    },
    ctx,
  );
  registerConnectorTool(
    server,
    {
      name: toolName("zipline_invites"),
      description: toolDescription(
        "List, get, create, and delete Zipline invite codes. Administrator role required. Create needs expiresAt (never or a duration such as 1d). Writes run only when confirm is true and ZIPLINE_ALLOW_WRITES=true. Omit confirm or pass false for a preview that sends nothing. Actions: list, get, create, delete.",
      ),
      inputSchema: invitesInput,
      annotations: annotationsFor("zipline_invites"),
      handler: (args) => handleInvites(runtime, args),
    },
    ctx,
  );
  registerConnectorTool(
    server,
    {
      name: toolName("zipline_tags"),
      description: toolDescription(
        "List, get, create, update, and delete Zipline tags. Create needs name and a hex color. Writes run only when confirm is true and ZIPLINE_ALLOW_WRITES=true. Omit confirm or pass false for a preview that sends nothing. Actions: list, get, create, update, delete.",
      ),
      inputSchema: tagsInput,
      annotations: annotationsFor("zipline_tags"),
      handler: (args) => handleTags(runtime, args),
    },
    ctx,
  );
  registerConnectorTool(
    server,
    {
      name: toolName("zipline_info"),
      description: toolDescription(
        "Read the authenticated user and quota (me), per-user stats, instance metrics, and healthcheck. me strips token, password, and session fields. Actions: me, stats, instance, health.",
      ),
      inputSchema: infoInput,
      annotations: READ_ONLY_REMOTE,
      handler: (args) => handleInfo(runtime, args),
    },
    ctx,
  );

  return server;
}

function annotationsFor(tool: string): ToolAnnotations {
  if (!toolIsWrite(tool)) return READ_ONLY_REMOTE;
  return WRITE_DESTRUCTIVE;
}
