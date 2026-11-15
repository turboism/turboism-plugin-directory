import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  formatFrameworkRequirement,
  formatPluginVersionLabel,
  frameworkFloorOf,
  getDirectoryPluginBySlug,
  getDirectoryPlugins,
  getDirectoryListingPlugins,
  loadDirectorySnapshot,
  normalizeCatalogLocale,
  projectCatalogToDirectory,
  resolveLocalizedPlugin,
  serveLegacyPlugins,
} from "../../lib/directory.ts";
import { deployPair, makeCatalog, makePlugin, makePopulatedDirectoryCatalog, makeRelease } from "./fixtures.mjs";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-directory-"));
}

test("lib/directory.json is retired and current committed generation loads cleanly", async () => {
  assert.equal(existsSync(path.join(process.cwd(), "lib", "directory.json")), false);
  const snapshot = loadDirectorySnapshot();
  const generationId = readFileSync(path.join(process.cwd(), "public", "api", "v2", "current"), "utf8");
  const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "public", "api", "v2", "generations", generationId, "catalog.json"), "utf8"));
  assert.equal(snapshot.generationId, generationId);
  assert.equal(snapshot.catalogVersion, catalog.catalogVersion);
  assert.ok(snapshot.plugins.length > 0);

  const response = serveLegacyPlugins();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=86400");
  const data = await response.json();
  assert.equal(data.length, snapshot.plugins.length);
});

test("populated signed generation projects latest active releases, 5 locales with fallbacks, Cubism versions, SHA-256, and download URLs", async () => {
  const dir = tempDir();
  try {
    deployPair(dir, {
      catalog: makePopulatedDirectoryCatalog(),
      keyId: "turboism-official-v1",
      purpose: "production",
      generationId: "00000001",
    });
    const storage = { dir, trustedKeysFile: path.join(dir, "trusted-keys.json") };
    const snapshot = loadDirectorySnapshot(storage);
    assert.equal(snapshot.generationId, "00000001");
    assert.equal(snapshot.catalogVersion, 3);
    assert.equal(snapshot.plugins.length, 2);
    assert.deepEqual(snapshot.availableCategories, ["integration", "workflow"]);
    assert.deepEqual(snapshot.availableTags, ["agent", "automation", "backup", "mcp", "webdav"]);

    const mcp = getDirectoryPluginBySlug("mcp", storage);
    assert.ok(mcp);
    assert.equal(mcp.id, "dev.turboism.plugin.mcp");
    assert.equal(mcp.latestVersion, "0.2.0");
    assert.equal(mcp.channel, "stable");
    assert.equal(mcp.category, "integration");
    assert.deepEqual(mcp.tags, ["mcp", "automation", "agent"]);
    assert.equal(mcp.requiresCubism, true);
    assert.deepEqual(mcp.cubismVersions, ["5.3.00", "5.3.02", "5.3.04"]);
    assert.equal(mcp.sha256, "3333333333333333333333333333333333333333333333333333333333333333");
    assert.equal(mcp.checksum, mcp.sha256);
    assert.equal(mcp.fileName, "mcp-0.2.0.jar");
    assert.equal(
      mcp.downloadUrl,
      "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-mcp-v0.2.0/mcp-0.2.0.jar",
    );
    assert.equal(
      mcp.releaseUrl,
      "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-mcp-v0.2.0",
    );

    // 5 locales on mcp: en, zh-Hans, zh-Hant, ja, ko
    assert.equal(resolveLocalizedPlugin(mcp, "en").name, "Turboism MCP Server");
    assert.equal(resolveLocalizedPlugin(mcp, "zh-Hans").name, "Turboism MCP 服务");
    assert.equal(resolveLocalizedPlugin(mcp, "zh-Hant").name, "Turboism MCP 服務");
    assert.equal(resolveLocalizedPlugin(mcp, "ja").name, "Turboism MCP サーバー");
    assert.equal(resolveLocalizedPlugin(mcp, "ko").name, "Turboism MCP 서버");
    assert.equal(normalizeCatalogLocale("zh", "zh-TW"), "zh-Hant");
    assert.equal(normalizeCatalogLocale("zh", "zh-CN"), "zh-Hans");

    // webdav-backup: 0.2.0 is yanked so 0.1.0 is the latest active version;
    // zh-Hant falls back to zh-Hans, and ko falls back to English.
    const webdav = getDirectoryPluginBySlug("webdav-backup", storage);
    assert.ok(webdav);
    assert.equal(webdav.latestVersion, "0.1.0");
    assert.equal(webdav.requiresCubism, false);
    assert.deepEqual(webdav.cubismVersions, []);
    assert.equal(resolveLocalizedPlugin(webdav, "zh-Hant").name, "WebDAV 自动备份");
    assert.equal(resolveLocalizedPlugin(webdav, "ko").name, "WebDAV Auto-Backup");

    // Filtering by localized query, tag, and category
    const all = getDirectoryPlugins(storage);
    const listing = getDirectoryListingPlugins(storage);
    assert.equal(listing.length, all.length);
    assert.deepEqual(listing.map((p) => p.slug), all.map((p) => p.slug));
    assert.ok(listing.every((p) => !("releases" in p) && !("sha256" in p) && !("dependencies" in p)));
    assert.deepEqual(filterPlugins(listing, "서버", null, null, "ko").map((p) => p.slug), ["mcp"]);
    assert.deepEqual(filterPlugins(listing, "5.3.04", null, null, "en").map((p) => p.slug), ["mcp"]);
    assert.deepEqual(filterPlugins(all, "서버", null, null, "ko").map((p) => p.slug), ["mcp"]);
    assert.deepEqual(filterPlugins(all, "服務", null, null, "zh-Hant").map((p) => p.slug), ["mcp"]);
    assert.deepEqual(filterPlugins(all, "", "backup", null, "en").map((p) => p.slug), ["webdav-backup"]);
    assert.deepEqual(filterPlugins(all, "", null, "integration", "en").map((p) => p.slug), ["mcp"]);
    assert.deepEqual(filterPlugins(all, "5.3.04", null, null, "en").map((p) => p.slug), ["mcp"]);
    assert.deepEqual( collectAvailableTags(all), ["agent", "automation", "backup", "mcp", "webdav"]);
    assert.deepEqual(collectAvailableCategories(all), ["integration", "workflow"]);

    // /api/plugins response on populated storage
    const apiRes = serveLegacyPlugins(storage);
    assert.equal(apiRes.status, 200);
    const apiBody = await apiRes.json();
    assert.equal(apiBody.length, 2);
    assert.equal(apiBody[0].slug, "mcp");
    assert.equal(apiBody[0].latestVersion, "0.2.0");
    assert.equal(apiBody[1].slug, "webdav-backup");
    assert.equal(apiBody[1].latestVersion, "0.1.0");

    // Tampered catalog fails closed
    const catalogFile = path.join(dir, "generations", "00000001", "catalog.json");
    const tampered = Buffer.from(readFileSync(catalogFile));
    tampered[tampered.length - 1] = 0x7e;
    writeFileSync(catalogFile, tampered);
    assert.throws(() => loadDirectorySnapshot(storage), /Verified catalog generation unavailable/);
    const failedRes = serveLegacyPlugins(storage);
    assert.equal(failedRes.status, 500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recommended release prefers stable over a newer preview and keeps the framework floor", () => {
  const catalog = makeCatalog({
    plugins: [
      makePlugin({
        id: "dev.turboism.plugin.mixed",
        slug: "mixed",
        releases: [
          makeRelease({ version: "0.2.0", channel: "stable", turboismApi: "[0.67.0,1.0.0)" }),
          makeRelease({ version: "0.3.0", channel: "preview", turboismApi: "[0.68.1,1.0.0)" }),
        ],
      }),
    ],
  });

  const [entry] = projectCatalogToDirectory(catalog).plugins;
  assert.equal(entry.latestVersion, "0.3.0");
  assert.equal(entry.channel, "preview");
  assert.equal(entry.recommendedVersion, "0.2.0");
  assert.equal(entry.recommendedChannel, "stable");
  assert.equal(entry.frameworkFloor, "0.67.0");
});

test("recommended release falls back to the newest preview when no stable release exists", () => {
  const catalog = makeCatalog({
    plugins: [
      makePlugin({
        id: "dev.turboism.plugin.preview-only",
        slug: "preview-only",
        releases: [
          makeRelease({ version: "0.1.0", channel: "preview", turboismApi: "[0.67.0,1.0.0)" }),
          makeRelease({ version: "0.2.0", channel: "preview", turboismApi: "[0.68.0,1.0.0)" }),
        ],
      }),
    ],
  });

  const [entry] = projectCatalogToDirectory(catalog).plugins;
  assert.equal(entry.recommendedVersion, "0.2.0");
  assert.equal(entry.recommendedChannel, "preview");
  assert.equal(entry.frameworkFloor, "0.68.0");
});

test("framework floor badge names the exact prerelease when no stable build provides the floor", () => {
  const heads = { stable: "0.67.4", beta: "0.68.1-beta.11", nightly: "0.68.1-0.nightly.88" };

  assert.equal(frameworkFloorOf("[0.67.0,1.0.0)"), "0.67.0");
  assert.equal(frameworkFloorOf("0.68.1"), "0.68.1");
  assert.equal(frameworkFloorOf("not-a-range"), null);

  assert.deepEqual(formatFrameworkRequirement("0.67.0", heads), { label: "0.67.0+", kind: "stable" });
  assert.deepEqual(formatFrameworkRequirement("0.68.1", heads), {
    label: "0.68.1.b11",
    kind: "beta",
  });
  assert.deepEqual(formatFrameworkRequirement("0.68.0", { stable: "0.67.4", beta: "0.68.1-beta.11" }), {
    label: "0.68.1.b11",
    kind: "beta",
  });
  assert.deepEqual(formatFrameworkRequirement("0.67.0", { nightly: "0.68.1-0.nightly.88" }), {
    label: "0.68.1-0.nightly.88",
    kind: "nightly",
  });
  // Unreachable channel metadata degrades to the plain floor instead of hiding the badge.
  assert.deepEqual(formatFrameworkRequirement("0.68.1", {}), { label: "0.68.1+", kind: "unknown" });
  assert.equal(formatFrameworkRequirement(null, heads), null);
  assert.equal(frameworkFloorOf("[0.70.0,)"), "0.70.0");
  assert.deepEqual(
    formatFrameworkRequirement("0.70.0", { stable: "0.67.4", beta: "0.70.0-beta.1" }),
    { label: "0.70.0.b1", kind: "beta" },
  );
});

test("plugin version label renders plain version without channel suffix", () => {
  assert.equal(formatPluginVersionLabel("0.67.4"), "0.67.4");
  assert.equal(formatPluginVersionLabel("0.68.1"), "0.68.1");
  assert.equal(formatPluginVersionLabel(""), "");
});
