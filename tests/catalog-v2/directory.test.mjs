import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  getDirectoryPluginBySlug,
  getDirectoryPlugins,
  loadDirectorySnapshot,
  normalizeCatalogLocale,
  resolveLocalizedPlugin,
  serveLegacyPlugins,
} from "../../lib/directory.ts";
import { deployPair, makePopulatedDirectoryCatalog } from "./fixtures.mjs";

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
