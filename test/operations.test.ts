import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXCLUSIONS, OPERATIONS, SOURCE_VERSION, toolNames } from "../src/operations.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface InventoryFile {
  path: string;
  sha256: string;
}

interface InventoryRoute {
  method: string;
  path: string;
  operationId: string;
  sourceFile: string;
}

interface Inventory {
  project: string;
  version: string;
  license: string;
  packageJsonSha256: string;
  routeTreeSha256: string;
  files: InventoryFile[];
  routes: InventoryRoute[];
}

function loadInventory(): Inventory {
  return JSON.parse(
    readFileSync(new URL("../spec/api-inventory.json", import.meta.url), "utf8"),
  ) as Inventory;
}

function treeHash(files: InventoryFile[], routes: InventoryRoute[]): string {
  const lines = [
    ...files.map((file) => `${file.path} ${file.sha256}`),
    ...routes.map((route) => `${route.method} ${route.path} ${route.sourceFile}`),
  ];
  return createHash("sha256")
    .update(`${lines.join("\n")}\n`)
    .digest("hex");
}

function keyOf(row: { method: string; path: string }): string {
  return `${row.method} ${row.path}`;
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (entry.endsWith(".mjs") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("route coverage", () => {
  const inventory = loadInventory();
  const routes = JSON.parse(
    readFileSync(new URL("../zipline.routes.json", import.meta.url), "utf8"),
  ) as {
    source: {
      version: string;
      license: string;
      routeTreeSha256: string;
      files: InventoryFile[];
    };
    operations: {
      method: string;
      path: string;
      operationId: string;
      exclude?: boolean;
      reason?: string;
      tool?: string;
      action?: string;
    }[];
  };

  it("maps or excludes every extracted v4.8.2 api route", () => {
    expect(SOURCE_VERSION).toBe("4.8.2");
    expect(inventory.project).toBe("diced/zipline");
    expect(inventory.version).toBe("4.8.2");
    expect(inventory.license).toBe("MIT");
    expect(inventory.packageJsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(treeHash(inventory.files, inventory.routes)).toBe(inventory.routeTreeSha256);
    expect(inventory.routes).toHaveLength(92);
    expect(routes.source.version).toBe("4.8.2");
    expect(routes.source.license).toBe("MIT");
    expect(routes.source.routeTreeSha256).toBe(inventory.routeTreeSha256);
    expect(routes.source.files.length).toBeGreaterThan(40);
    for (const file of inventory.files) {
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.path.startsWith("src/server/routes/api/")).toBe(true);
    }

    const specKeys = inventory.routes.map((op) => keyOf(op)).sort();
    const routeKeys = routes.operations.map((op) => keyOf(op)).sort();
    expect(routeKeys).toEqual(specKeys);
    expect(inventory.routes.length).toBeGreaterThan(80);

    const mapped = routes.operations.filter((op) => op.exclude !== true);
    const excluded = routes.operations.filter((op) => op.exclude === true);
    const registryRoutes = [...new Set(OPERATIONS.map((op) => keyOf(op)))].sort();
    expect(registryRoutes).toEqual(mapped.map((op) => keyOf(op)).sort());
    expect(EXCLUSIONS.map((op) => keyOf(op)).sort()).toEqual(
      excluded.map((op) => keyOf(op)).sort(),
    );
    expect(mapped.length + excluded.length).toBe(inventory.routes.length);
    const covered = new Set([...registryRoutes, ...EXCLUSIONS.map((op) => keyOf(op))]);
    const unmapped = inventory.routes.filter((op) => !covered.has(keyOf(op)));
    expect(unmapped).toEqual([]);
    expect(mapped.length).toBe(28);
    expect(EXCLUSIONS.length).toBe(64);
    expect(OPERATIONS).toHaveLength(30);
    for (const row of excluded) {
      expect(row.reason !== undefined && row.reason.length > 20).toBe(true);
    }
    expect(mapped.some((row) => row.operationId === "PATCH /api/user/files/{id}")).toBe(true);
    expect(excluded.some((row) => row.path.includes("/upload"))).toBe(true);
  });

  it("keeps action names unique and stable against the generator", () => {
    const seen = new Set<string>();
    for (const operation of OPERATIONS) {
      const id = `${operation.tool}:${operation.action}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
      expect(operation.action).toMatch(/^[a-z0-9_]+$/);
      expect(operation.path.startsWith("/api/")).toBe(true);
    }
    expect(toolNames()).toEqual([
      "zipline_files",
      "zipline_folders",
      "zipline_info",
      "zipline_invites",
      "zipline_tags",
      "zipline_urls",
    ]);
  });

  it("checks the generator against the committed inventory and no external tree", () => {
    const env = { ...process.env };
    delete env["ZIPLINE_SOURCE_ROOT"];
    delete env["DATABASE_URL"];
    const result = spawnSync(process.execPath, ["scripts/gen-operations.mjs", "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it("does not hardcode an absolute workspace path in scripts, tests, or src", () => {
    const banned = ["/work", "space"].join("");
    const files = [
      ...walkSources(join(repoRoot, "scripts")),
      ...walkSources(join(repoRoot, "test")),
      ...walkSources(join(repoRoot, "src")),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8").includes(banned), file).toBe(false);
    }
  });
});
