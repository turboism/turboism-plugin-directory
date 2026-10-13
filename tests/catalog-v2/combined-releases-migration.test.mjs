import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  combinedReleaseTag,
  combinedReleaseTitle,
  generateCombinedReleaseBody,
  mainMigrateArtifactUrls,
} from "../../scripts/catalog-v2/ingest-official-release.mjs";
import { validateCatalogBytes, stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "combined-releases-test-"));
}

test("combinedReleaseTag and title resolve framework version or fallback to revision", () => {
  const bundleWithVersion = {
    source: { revision: "a".repeat(40), version: "0.67.0-beta.2" },
    artifacts: [],
  };
  assert.equal(combinedReleaseTag(bundleWithVersion), "plugins-0.67.0-beta.2");
  assert.equal(combinedReleaseTitle(bundleWithVersion), "Turboism plugins · 0.67.0-beta.2");

  const bundleWithFlag = {
    source: { revision: "a".repeat(40) },
    artifacts: [],
  };
  assert.equal(combinedReleaseTag(bundleWithFlag, { "source-version": "0.68.0" }), "plugins-0.68.0");
  assert.equal(combinedReleaseTitle(bundleWithFlag, { "source-version": "0.68.0" }), "Turboism plugins · 0.68.0");

  const bundleRevisionFallback = {
    source: { revision: "b".repeat(40) },
    artifacts: [],
  };
  assert.equal(combinedReleaseTag(bundleRevisionFallback), `plugins-${"b".repeat(40)}`);
  assert.equal(combinedReleaseTitle(bundleRevisionFallback), `Turboism plugins · ${"b".repeat(40)}`);
});

test("generateCombinedReleaseBody lists plugin id, version, and SHA-256 in markdown table", () => {
  const bundle = {
    source: { revision: "a".repeat(40) },
    artifacts: [
      {
        module: "history-panel",
        version: "0.67.0",
        descriptor: { id: "dev.turboism.plugin.historypanel", version: "0.67.0" },
        sha256: "1".repeat(64),
      },
      {
        module: "acp",
        version: "0.67.0",
        descriptor: { id: "dev.turboism.plugin.acp", version: "0.67.0" },
        sha256: "2".repeat(64),
      },
    ],
  };
  const body = generateCombinedReleaseBody(bundle);
  assert.match(body, /\| Plugin ID \| Version \| SHA-256 \|/);
  assert.match(body, /`dev\.turboism\.plugin\.acp` \| `0\.67\.0` \| `222222/);
  assert.match(body, /`dev\.turboism\.plugin\.historypanel` \| `0\.67\.0` \| `111111/);
});

test("migrate-artifact-urls repoints matching releases to combined release and bumps catalogVersion", async () => {
  const dir = tempDir();
  try {
    const catalogPath = path.join(dir, "catalog.json");
    const initialCatalog = {
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion: 2,
      publishedAt: "2026-10-13T09:17:27Z",
      plugins: [
        {
          id: "dev.turboism.plugin.historypanel",
          slug: "history-panel",
          name: "History Panel",
          summary: "History panel summary.",
          trust: "official",
          author: "Turboism Contributors",
          license: "Project License",
          repository: "https://github.com/turboism/Turboism",
          support: "https://github.com/turboism/Turboism/issues",
          localizations: {},
          releases: [
            {
              version: "0.67.0",
              channel: "preview",
              status: "active",
              publishedAt: "2026-10-13T09:17:27Z",
              category: "workflow",
              tags: ["history"],
              turboismApi: "[0.1.0,0.2.0)",
              requiresCubism: false,
              cubismVersions: [],
              platforms: ["windows-x64"],
              dependencies: [],
              permissions: [],
              releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-history-panel-v0.67.0",
              sourceRevision: "d02abb3d96c3070da2da2013b3605a0a375c8954",
              artifact: {
                mediaType: "application/java-archive",
                fileName: "history-panel-0.67.0.jar",
                url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-history-panel-v0.67.0/history-panel-0.67.0.jar",
                sha256: "1b3cf60780d2dc20c1d84a2433936120676c1e8cb6576b1c5c142ba1748ed0ee",
                descriptorSha256: "81a57d8df0d025139e45891d2afc73a52516fb039012280045447032ba09baff",
                size: 48884,
              },
            },
          ],
        },
      ],
    };
    writeFileSync(catalogPath, Buffer.from(stringifyCanonical(initialCatalog, "catalog"), "utf8"));

    const outPath = path.join(dir, "migrated-catalog.json");
    await mainMigrateArtifactUrls(["--catalog", catalogPath, "--target-tag", "plugins-0.67.0", "--out", outPath]);

    const migratedBytes = readFileSync(outPath);
    const validated = validateCatalogBytes(migratedBytes);
    assert.ok(validated.ok, JSON.stringify(validated.errors));
    assert.equal(validated.catalog.catalogVersion, 3);
    const release = validated.catalog.plugins[0].releases[0];
    assert.equal(release.releaseUrl, "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.67.0");
    assert.equal(
      release.artifact.url,
      "https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-0.67.0/history-panel-0.67.0.jar",
    );
    // Integrity fields must be strictly preserved
    assert.equal(release.artifact.sha256, initialCatalog.plugins[0].releases[0].artifact.sha256);
    assert.equal(release.artifact.descriptorSha256, initialCatalog.plugins[0].releases[0].artifact.descriptorSha256);
    assert.equal(release.artifact.size, initialCatalog.plugins[0].releases[0].artifact.size);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
