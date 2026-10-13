import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  combinedReleaseTag,
  combinedReleaseTitle,
  generateCombinedReleaseBody,
  mainMigrateArtifactUrls,
} from "../../scripts/catalog-v2/ingest-official-release.mjs";
import {
  buildMigrationPlan,
  assertUrlOnlyDiff,
  downloadAndVerifyOldJars,
  syncCombinedRelease,
  pollProductionLive,
} from "../../scripts/catalog-v2/migrate-combined-release.mjs";
import { validateCatalogBytes, stringifyCanonical, sha256Hex } from "../../lib/catalog-v2/catalog.mjs";
import { makeZip, makeDescriptor } from "./fixtures.mjs";

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

test("buildMigrationPlan builds canonical plan and markdown body", () => {
  const rootCatalog = JSON.parse(readFileSync(path.join(process.cwd(), "catalog", "v2", "catalog.json"), "utf8"));
  const plan = buildMigrationPlan(rootCatalog, { version: "0.67.0", targetTag: "plugins-0.67.0" });
  assert.equal(plan.targetTag, "plugins-0.67.0");
  assert.equal(plan.title, "Turboism plugins · 0.67.0");
  assert.equal(plan.releases.length, 24);
  assert.match(plan.body, /\| Plugin ID \| Version \| SHA-256 \|/);
  assert.match(plan.body, /`dev\.turboism\.plugin\.acp` \| `0\.67\.0` \| `e28ef9ff836309d5a1025100a70572271ea79d3dc92584704a0c3d230610f526`/);
  assert.match(plan.body, /`dev\.turboism\.plugin\.webdav` \| `0\.67\.0` \| `d69d5ee8a08c40cb4d1841cd1b77b3834c99f11aebd17a5e35745815232ef752`/);

  // Check first release structure
  const first = plan.releases[0];
  assert.equal(first.pluginId, "dev.turboism.plugin.acp");
  assert.equal(first.newReleaseUrl, "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.67.0");
  assert.equal(
    first.newArtifactUrl,
    "https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-0.67.0/acp-0.67.0.jar",
  );
});

test("assertUrlOnlyDiff passes on valid URL migration and rejects non-URL changes", () => {
  const rootCatalog = JSON.parse(readFileSync(path.join(process.cwd(), "catalog", "v2", "catalog.json"), "utf8"));
  const migrated = structuredClone(rootCatalog);
  migrated.catalogVersion += 1;
  for (const plugin of migrated.plugins) {
    for (const release of plugin.releases) {
      if (release.version === "0.67.0") {
        release.releaseUrl = "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.67.0";
        release.artifact.url = `https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-0.67.0/${release.artifact.fileName}`;
      }
    }
  }

  // 1. Valid diff must pass cleanly
  assert.doesNotThrow(() => {
    assertUrlOnlyDiff(rootCatalog, migrated, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" });
  });

  // 2. catalogVersion not bumped by exactly 1 fails
  const badVersion = structuredClone(migrated);
  badVersion.catalogVersion = rootCatalog.catalogVersion;
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, badVersion, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /catalogVersion must advance by exactly 1/,
  );

  // 3. publishedAt moving backward fails
  const badTime = structuredClone(migrated);
  badTime.publishedAt = "2020-01-01T00:00:00Z";
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, badTime, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /publishedAt must not move backward/,
  );

  // 4. Tampered sha256 fails
  const tamperedSha = structuredClone(migrated);
  tamperedSha.plugins[0].releases[0].artifact.sha256 = "f".repeat(64);
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, tamperedSha, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /unexpected changed fields besides releaseUrl and artifact\.url/,
  );

  // 5. Tampered size fails
  const tamperedSize = structuredClone(migrated);
  tamperedSize.plugins[0].releases[0].artifact.size += 10;
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, tamperedSize, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /unexpected changed fields besides releaseUrl and artifact\.url/,
  );

  // 6. Tampered descriptorSha256 fails
  const tamperedDesc = structuredClone(migrated);
  tamperedDesc.plugins[0].releases[0].artifact.descriptorSha256 = "e".repeat(64);
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, tamperedDesc, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /unexpected changed fields besides releaseUrl and artifact\.url/,
  );

  // 7. Tampered status fails
  const tamperedStatus = structuredClone(migrated);
  tamperedStatus.plugins[0].releases[0].status = "yanked";
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, tamperedStatus, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /unexpected changed fields besides releaseUrl and artifact\.url/,
  );

  // 8. Plugin metadata change fails
  const tamperedPlugin = structuredClone(migrated);
  tamperedPlugin.plugins[0].name = "Different Name";
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, tamperedPlugin, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /field "name" changed/,
  );

  // 9. Extra plugin or missing plugin fails
  const missingPlugin = structuredClone(migrated);
  missingPlugin.plugins.pop();
  assert.throws(
    () => assertUrlOnlyDiff(rootCatalog, missingPlugin, { targetVersion: "0.67.0", targetTag: "plugins-0.67.0" }),
    /plugin count changed/,
  );
});

test("downloadAndVerifyOldJars downloads, verifies integrity and bindings, and writes manifest", async () => {
  const dir = tempDir();
  const desc = makeDescriptor({
    id: "dev.turboism.plugin.sample",
    version: "0.67.0",
    category: "workflow",
    tags: ["sample"],
    environment: { requiresCubism: false },
    permissions: [],
    dependencies: [],
  });
  const descBytes = Buffer.from(JSON.stringify(desc), "utf8");
  const descSha = sha256Hex(descBytes);
  const jarBytes = makeZip([
    { name: "META-INF/turboism/plugin.json", data: descBytes },
    { name: "Entry.class", data: Buffer.from([1, 2, 3]) },
  ]);
  const jarSha = sha256Hex(jarBytes);

  let downloadCount = 0;
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/releases/download/plugin-sample-v0.67.0/sample-0.67.0.jar")) {
      downloadCount += 1;
      res.writeHead(200, { "Content-Type": "application/java-archive", "Content-Length": jarBytes.byteLength });
      res.end(jarBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const catalog = {
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion: 2,
      publishedAt: "2026-10-13T09:17:27Z",
      plugins: [
        {
          id: "dev.turboism.plugin.sample",
          slug: "sample",
          name: "Sample Plugin",
          summary: "Sample summary.",
          trust: "official",
          author: "Turboism Contributors",
          license: "Project License",
          repository: "https://github.com/turboism/turboism-plugin-directory",
          support: "https://github.com/turboism/turboism-plugin-directory/issues",
          localizations: {},
          releases: [
            {
              version: "0.67.0",
              channel: "preview",
              status: "active",
              publishedAt: "2026-10-13T09:17:27Z",
              category: "workflow",
              tags: ["sample"],
              turboismApi: "[0.1.0,0.2.0)",
              requiresCubism: false,
              cubismVersions: [],
              platforms: ["windows-x64"],
              dependencies: [],
              permissions: [],
              releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-sample-v0.67.0",
              sourceRevision: "d02abb3d96c3070da2da2013b3605a0a375c8954",
              artifact: {
                mediaType: "application/java-archive",
                fileName: "sample-0.67.0.jar",
                url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-sample-v0.67.0/sample-0.67.0.jar",
                sha256: jarSha,
                descriptorSha256: descSha,
                size: jarBytes.byteLength,
              },
            },
          ],
        },
      ],
    };

    const catalogPath = path.join(dir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify(catalog));
    const jarsDir = path.join(dir, "jars");
    const manifestOut = path.join(dir, "jars.json");

    const result = await downloadAndVerifyOldJars({
      catalogPath,
      version: "0.67.0",
      targetTag: "plugins-0.67.0",
      dir: jarsDir,
      manifestOut,
      assetBase: baseUrl,
    });

    assert.equal(result.verifiedCount, 1);
    assert.equal(downloadCount, 1);
    const manifest = JSON.parse(readFileSync(manifestOut, "utf8"));
    assert.ok(manifest["dev.turboism.plugin.sample@0.67.0"]);
    assert.deepEqual(readFileSync(manifest["dev.turboism.plugin.sample@0.67.0"]), jarBytes);
  } finally {
    server.close();
    await once(server, "close");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncCombinedRelease creates release, uploads asset, re-downloads anonymously, and resumes idempotently", async () => {
  const dir = tempDir();
  const desc = makeDescriptor({
    id: "dev.turboism.plugin.sample",
    version: "0.67.0",
    category: "workflow",
    tags: ["sample"],
    environment: { requiresCubism: false },
    permissions: [],
    dependencies: [],
  });
  const descBytes = Buffer.from(JSON.stringify(desc), "utf8");
  const descSha = sha256Hex(descBytes);
  const jarBytes = makeZip([
    { name: "META-INF/turboism/plugin.json", data: descBytes },
    { name: "Entry.class", data: Buffer.from([1, 2, 3]) },
  ]);
  const jarSha = sha256Hex(jarBytes);

  let releaseCreated = false;
  let assetUploaded = false;
  let anonymousDownloadCount = 0;
  let releaseData = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    // 1. Release inspection (GET)
    if (req.method === "GET" && url.pathname === "/repos/turboism/turboism-plugin-directory/releases/tags/plugins-0.67.0") {
      if (!releaseData) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Not Found" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(releaseData));
      }
      return;
    }

    // 2. Release creation (POST)
    if (req.method === "POST" && url.pathname === "/repos/turboism/turboism-plugin-directory/releases") {
      releaseCreated = true;
      releaseData = {
        id: 999,
        tag_name: "plugins-0.67.0",
        name: "Turboism plugins · 0.67.0",
        draft: false,
        prerelease: false,
        html_url: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.67.0",
        upload_url: `http://127.0.0.1:${server.address().port}/repos/turboism/turboism-plugin-directory/releases/999/assets{?name,label}`,
        assets: [],
      };
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(releaseData));
      return;
    }

    // 3. Asset upload (POST)
    if (req.method === "POST" && url.pathname.startsWith("/repos/turboism/turboism-plugin-directory/releases/999/assets")) {
      assetUploaded = true;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const uploadedBytes = Buffer.concat(chunks);
      assert.deepEqual(uploadedBytes, jarBytes);

      const assetObj = {
        id: 1001,
        name: "sample-0.67.0.jar",
        size: uploadedBytes.byteLength,
        browser_download_url: `http://127.0.0.1:${server.address().port}/download/plugins-0.67.0/sample-0.67.0.jar`,
      };
      releaseData.assets.push(assetObj);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(assetObj));
      return;
    }

    // 4. Anonymous asset download (GET)
    if (req.method === "GET" && url.pathname === "/download/plugins-0.67.0/sample-0.67.0.jar") {
      assert.equal(req.headers.authorization, undefined, "anonymous download must have no Authorization header");
      anonymousDownloadCount += 1;
      res.writeHead(200, { "Content-Type": "application/java-archive", "Content-Length": jarBytes.byteLength });
      res.end(jarBytes);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const catalog = {
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion: 2,
      publishedAt: "2026-10-13T09:17:27Z",
      plugins: [
        {
          id: "dev.turboism.plugin.sample",
          slug: "sample",
          name: "Sample Plugin",
          summary: "Sample summary.",
          trust: "official",
          author: "Turboism Contributors",
          license: "Project License",
          repository: "https://github.com/turboism/turboism-plugin-directory",
          support: "https://github.com/turboism/turboism-plugin-directory/issues",
          localizations: {},
          releases: [
            {
              version: "0.67.0",
              channel: "preview",
              status: "active",
              publishedAt: "2026-10-13T09:17:27Z",
              category: "workflow",
              tags: ["sample"],
              turboismApi: "[0.1.0,0.2.0)",
              requiresCubism: false,
              cubismVersions: [],
              platforms: ["windows-x64"],
              dependencies: [],
              permissions: [],
              releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-sample-v0.67.0",
              sourceRevision: "d02abb3d96c3070da2da2013b3605a0a375c8954",
              artifact: {
                mediaType: "application/java-archive",
                fileName: "sample-0.67.0.jar",
                url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-sample-v0.67.0/sample-0.67.0.jar",
                sha256: jarSha,
                descriptorSha256: descSha,
                size: jarBytes.byteLength,
              },
            },
          ],
        },
      ],
    };

    const catalogPath = path.join(dir, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify(catalog));
    const jarFilePath = path.join(dir, "sample-0.67.0.jar");
    writeFileSync(jarFilePath, jarBytes);
    const jarsManifestPath = path.join(dir, "jars.json");
    writeFileSync(jarsManifestPath, JSON.stringify({ "dev.turboism.plugin.sample@0.67.0": jarFilePath }));

    // 1. Dry run should make zero network calls
    const dryRunResult = await syncCombinedRelease({
      catalogPath,
      version: "0.67.0",
      targetTag: "plugins-0.67.0",
      jarsManifestPath,
      dryRun: true,
    });
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(releaseCreated, false);
    assert.equal(assetUploaded, false);

    // 2. Real run: creates release, uploads asset, downloads anonymously
    const liveResult = await syncCombinedRelease({
      catalogPath,
      version: "0.67.0",
      targetTag: "plugins-0.67.0",
      jarsManifestPath,
      apiUrl: baseUrl,
      assetBase: baseUrl,
      token: "test-token",
      dryRun: false,
    });
    assert.equal(liveResult.ok, true);
    assert.equal(releaseCreated, true);
    assert.equal(assetUploaded, true);
    assert.equal(anonymousDownloadCount, 1);

    // 3. Resumed run: release and asset exist, no re-upload
    assetUploaded = false;
    const resumeResult = await syncCombinedRelease({
      catalogPath,
      version: "0.67.0",
      targetTag: "plugins-0.67.0",
      jarsManifestPath,
      apiUrl: baseUrl,
      assetBase: baseUrl,
      token: "test-token",
      dryRun: false,
    });
    assert.equal(resumeResult.ok, true);
    assert.equal(assetUploaded, false, "existing asset must not be re-uploaded");
    assert.equal(anonymousDownloadCount, 2, "existing asset must be verified anonymously");
  } finally {
    server.close();
    await once(server, "close");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pollProductionLive resolves when expected catalogVersion appears and times out if not", async () => {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/v2/catalog.json") {
      callCount += 1;
      const version = callCount >= 2 ? 3 : 2;
      res.writeHead(200, { "Content-Type": "application/vnd.turboism.plugin-catalog+json;version=2" });
      res.end(JSON.stringify({ format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion: version }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const success = await pollProductionLive({
      baseUrl,
      expectedVersion: 3,
      timeoutSeconds: 5,
      intervalSeconds: 0.1,
    });
    assert.equal(success, true);
    assert.ok(callCount >= 2);

    // Timeout case
    await assert.rejects(
      pollProductionLive({
        baseUrl,
        expectedVersion: 99,
        timeoutSeconds: 0.3,
        intervalSeconds: 0.1,
      }),
      /timeout waiting for catalogVersion 99/,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("migration workflow YAML parses cleanly and validates structure", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "migrate-combined-release.yml");
  const content = readFileSync(workflowPath, "utf8");

  // Validate YAML parsing via python3 pyyaml
  const pyScript = `
import yaml, sys
with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
assert data['name'] == 'Migrate combined plugin release'
assert data['concurrency']['group'] == 'publish-plugin-directory-v2'
assert data['concurrency']['cancel-in-progress'] is False
on_key = True if True in data else 'on'
inputs = data[on_key]['workflow_dispatch']['inputs']
assert 'version' in inputs and inputs['version']['default'] == '0.67.0'
assert 'target_tag' in inputs and inputs['target_tag']['default'] == 'plugins-0.67.0'
assert 'dry_run' in inputs and inputs['dry_run']['default'] is True
assert data['permissions'] == {'contents': 'write'}
steps = data['jobs']['migrate']['steps']
assert len(steps) >= 14
print('YAML validation passed')
`;
  const result = execFileSync("python3", ["-c", pyScript, workflowPath], { encoding: "utf8" });
  assert.match(result, /YAML validation passed/);
});

test("migration workflow static assertions: trigger, concurrency, single-step key lifetime, dry-run safety", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "migrate-combined-release.yml");
  const workflow = readFileSync(workflowPath, "utf8");

  // Step blocks: each "- name:" line until next at same indent
  const stepBlocks = workflow
    .split("\n      - name: ")
    .slice(1)
    .map((chunk) => {
      const [name, ...bodyLines] = chunk.split("\n");
      return { name, body: bodyLines.join("\n") };
    });

  assert.ok(stepBlocks.length >= 14, "expected full step list");

  // Trigger: workflow_dispatch ONLY
  const onBlock = workflow.match(/^on:\n((?:[ \t]+\S[^\n]*\n?)*)/m);
  assert.ok(onBlock, "on: trigger block must be present");
  assert.match(onBlock[1], /workflow_dispatch:/);
  assert.doesNotMatch(onBlock[1], /(^|\n)\s*(pull_request|push|schedule):/);

  // Concurrency group shared with publish-plugin-directory-v2
  assert.match(workflow, /concurrency:\n\s+group:\s*publish-plugin-directory-v2/);
  assert.match(workflow, /cancel-in-progress:\s*false/);

  // Environment and permissions
  assert.match(workflow, /environment:\s*catalog-signing/);
  const permissions = workflow.match(/permissions:\n((?:[ \t]+\S[^\n]*\n)+)/);
  assert.ok(permissions, "permissions block must be present");
  assert.deepEqual(
    permissions[1].trim().split("\n").map((l) => l.trim()),
    ["contents: write"],
  );

  // Action pins
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(uses, [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  ]);

  // Main branch guard
  assert.match(workflow, /github\.ref\s*!=\s*'refs\/heads\/main'/);

  // Single-step secret lifetime
  const publishBlock = stepBlocks.find((s) => s.name === "Publish the catalog/signature pair");
  assert.ok(publishBlock, "publish step must exist");
  assert.equal(
    (workflow.match(/secrets\.PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/g) || []).length,
    1,
    "signing secret referenced exactly once",
  );
  assert.match(publishBlock.body, /umask 077/);
  assert.match(publishBlock.body, /trap cleanup EXIT/);

  for (const step of stepBlocks) {
    if (step === publishBlock) continue;
    assert.doesNotMatch(step.body, /KEY_FILE|PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/);
  }

  // Live only steps guard
  for (const liveStepName of [
    "Verify only the allowed paths changed",
    "Check diff hygiene",
    "Scan for private-key markers",
    "Commit the generated pair and push to main",
    "Poll production for new catalogVersion",
    "Verify production deployment",
  ]) {
    const step = stepBlocks.find((s) => s.name === liveStepName);
    assert.ok(step, `step "${liveStepName}" must exist`);
    assert.match(step.body, /inputs\.dry_run\s*==\s*false/, `step "${liveStepName}" must be guarded with dry_run == false`);
  }

  // Never delete releases inside workflow
  assert.doesNotMatch(workflow, /release delete|--cleanup-tag/, "workflow must not delete releases");
  // Non-force push only
  assert.doesNotMatch(workflow, /git push[^\n]*(--force|\s-f(\s|$))/);
});
