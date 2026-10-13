#!/usr/bin/env node
// Helper and subcommands for migrating per-plugin releases (plugin-<module>-v<version>)
// to a combined GitHub Release (plugins-<version>) with strict byte-identity
// verification, no-clobber idempotent sync, URL-only catalog diff assertions,
// and production deployment polling.

import { closeSync, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_ARTIFACT_SIZE,
  MAX_CATALOG_BYTES,
  checkJarBinding,
  inspectJarFile,
  loadTrustedKeys,
  sha256Hex,
  stringifyCanonical,
  validateCatalogBytes,
  verifyCatalogBytes,
} from "../../lib/catalog-v2/catalog.mjs";
import { redirectSafeFetch } from "./ingest-official-release.mjs";

const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_ASSET_BASE = "https://github.com";
const DEFAULT_PUBLIC_REPO = "turboism/turboism-plugin-directory";
const GITHUB_UPLOAD_HOST = "uploads.github.com";
const GITHUB_RELEASE_REDIRECT_HOSTS = ["release-assets.githubusercontent.com"];
const MAX_REDIRECTS = 5;
const PRODUCTION_CATALOG_CONTENT_TYPE = "application/vnd.turboism.plugin-catalog+json;version=2";

const fail = (message) => {
  const error = new Error(message);
  error.exited = true;
  throw error;
};

const usageError = (message) => {
  const error = new Error(message);
  error.usage = true;
  throw error;
};

export function parseFlags(argv, { strings = [], booleans = [] } = {}) {
  const flags = {};
  const known = new Set([...strings, ...booleans]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usageError(`unexpected positional argument "${arg}"`);
    const name = arg.slice(2);
    if (!known.has(name)) usageError(`unknown flag --${name}`);
    if (booleans.includes(name)) {
      flags[name] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usageError(`flag --${name} requires a value`);
      flags[name] = value;
      i += 1;
    }
  }
  return flags;
}

export function requireFlag(flags, name) {
  const val = flags[name];
  if (val === undefined || val === null || val === "") usageError(`missing required flag --${name}`);
  return val;
}

export function allowedRequestHosts(...values) {
  const hosts = new Set();
  let allowHttp = false;
  for (const value of values) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      usageError(`network base URL ${JSON.stringify(value)} must be absolute`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      usageError(`network base URL ${JSON.stringify(value)} must use HTTP or HTTPS`);
    }
    if (parsed.username !== "" || parsed.password !== "") {
      usageError(`network base URL ${JSON.stringify(value)} must not contain credentials`);
    }
    if (parsed.protocol === "http:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      usageError(`network base URL ${JSON.stringify(value)} may use HTTP only for a local test endpoint`);
    }
    hosts.add(parsed.host);
    if (parsed.protocol === "http:") allowHttp = true;
  }
  return { hosts, allowHttp };
}

function uploadTarget(uploadUrlTemplate, owner, repository, assetName, apiUrl) {
  if (typeof uploadUrlTemplate !== "string" || uploadUrlTemplate.length === 0) fail("release response is missing upload_url");
  const template = uploadUrlTemplate.replace(/\{[^}]*\}$/, "");
  let parsed;
  try {
    parsed = new URL(template);
  } catch {
    parsed = null;
  }
  const apiIsHttp = typeof apiUrl === "string" && apiUrl.startsWith("http://");
  const expectedPrefix = `/repos/${owner}/${repository}/releases/`;
  if (
    parsed === null ||
    (parsed.protocol !== "https:" && !(apiIsHttp && parsed.protocol === "http:")) ||
    !parsed.pathname.startsWith(expectedPrefix) ||
    !parsed.pathname.endsWith("/assets")
  ) {
    fail(`release upload_url "${uploadUrlTemplate}" is not a valid upload endpoint`);
  }
  const expectedHost = apiUrl === DEFAULT_API_URL ? GITHUB_UPLOAD_HOST : new URL(apiUrl).host;
  if (parsed.host !== expectedHost || parsed.username !== "" || parsed.password !== "") {
    fail(`release upload_url host "${parsed.host}" is not the approved upload host "${expectedHost}"`);
  }
  return `${template}?name=${encodeURIComponent(assetName)}`;
}

export function downloadTarget(url, assetBase) {
  if (assetBase === DEFAULT_ASSET_BASE) return url;
  if (!url.startsWith(DEFAULT_ASSET_BASE + "/")) fail(`cannot remap download URL ${url}`);
  return assetBase + url.slice(DEFAULT_ASSET_BASE.length);
}

async function readResponseBounded(response, cap, url) {
  const declaredText = response.headers.get("content-length");
  if (declaredText !== null) {
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      await response.body?.cancel().catch(() => {});
      fail(`malformed Content-Length for ${url}`);
    }
    if (declared > cap) {
      await response.body?.cancel().catch(() => {});
      fail(`response size ${declared} exceeds cap of ${cap} bytes for ${url}`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) fail(`response body is missing for ${url}`);
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) fail(`streamed response exceeded cap of ${cap} bytes for ${url}`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, total);
}

export async function fetchBounded(url, cap, { approvedHosts, allowHttp }) {
  const response = await redirectSafeFetch(url, { approvedHosts, allowHttp });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail(`fetch failed (${response.status} ${response.statusText}) for ${url}`);
  }
  return readResponseBounded(response, cap, url);
}

// ---------------------------------------------------------------------------
// 1. Plan Building
// ---------------------------------------------------------------------------

export function buildMigrationPlan(catalog, { version = "0.67.0", targetTag = "plugins-0.67.0", repo = DEFAULT_PUBLIC_REPO } = {}) {
  const [owner, repository] = repo.split("/");
  if (!owner || !repository) fail(`invalid repo "${repo}", expected owner/repo`);

  const expectedReleaseUrl = `https://github.com/${owner}/${repository}/releases/tag/${targetTag}`;
  const targetReleases = [];

  for (const plugin of catalog.plugins) {
    for (const release of plugin.releases) {
      if (release.version === version) {
        const expectedArtifactUrl = `https://github.com/${owner}/${repository}/releases/download/${targetTag}/${release.artifact.fileName}`;
        // Needs migration if pointing to individual release or not yet matching combined release
        const isPerPlugin =
          release.releaseUrl.includes("/releases/tag/plugin-") ||
          release.artifact.url.includes("/releases/download/plugin-");
        const needsUpdate = release.releaseUrl !== expectedReleaseUrl || release.artifact.url !== expectedArtifactUrl;

        if (isPerPlugin || needsUpdate) {
          targetReleases.push({
            pluginId: plugin.id,
            slug: plugin.slug,
            version: release.version,
            fileName: release.artifact.fileName,
            sha256: release.artifact.sha256,
            descriptorSha256: release.artifact.descriptorSha256,
            size: release.artifact.size,
            oldReleaseUrl: release.releaseUrl,
            oldArtifactUrl: release.artifact.url,
            newReleaseUrl: expectedReleaseUrl,
            newArtifactUrl: expectedArtifactUrl,
          });
        }
      }
    }
  }

  // Sort canonical list by pluginId
  targetReleases.sort((a, b) => a.pluginId.localeCompare(b.pluginId));

  const lines = [
    "| Plugin ID | Version | SHA-256 |",
    "|---|---|---|",
  ];
  for (const rel of targetReleases) {
    lines.push(`| \`${rel.pluginId}\` | \`${rel.version}\` | \`${rel.sha256}\` |`);
  }

  return {
    version,
    targetTag,
    title: `Turboism plugins · ${version}`,
    body: lines.join("\n"),
    repo,
    releases: targetReleases,
  };
}

// ---------------------------------------------------------------------------
// 2. URL-Only Diff Assertion (No Other Field Changed)
// ---------------------------------------------------------------------------

export function assertUrlOnlyDiff(beforeCatalog, afterCatalog, { targetVersion = "0.67.0", targetTag = "plugins-0.67.0", repo = DEFAULT_PUBLIC_REPO } = {}) {
  const [owner, repository] = repo.split("/");
  const expectedReleaseUrl = `https://github.com/${owner}/${repository}/releases/tag/${targetTag}`;

  if (afterCatalog.format !== beforeCatalog.format) {
    fail(`format changed: expected "${beforeCatalog.format}", got "${afterCatalog.format}"`);
  }
  if (afterCatalog.schemaVersion !== beforeCatalog.schemaVersion) {
    fail(`schemaVersion changed: expected ${beforeCatalog.schemaVersion}, got ${afterCatalog.schemaVersion}`);
  }
  if (afterCatalog.catalogVersion !== beforeCatalog.catalogVersion + 1) {
    fail(`catalogVersion must advance by exactly 1: expected ${beforeCatalog.catalogVersion + 1}, got ${afterCatalog.catalogVersion}`);
  }
  if (afterCatalog.publishedAt < beforeCatalog.publishedAt) {
    fail(`publishedAt must not move backward: before ${beforeCatalog.publishedAt}, after ${afterCatalog.publishedAt}`);
  }
  if (!Array.isArray(afterCatalog.plugins) || afterCatalog.plugins.length !== beforeCatalog.plugins.length) {
    fail(`plugin count changed: before ${beforeCatalog.plugins.length}, after ${afterCatalog.plugins?.length}`);
  }

  const beforeMap = new Map(beforeCatalog.plugins.map((p) => [p.id, p]));
  const afterMap = new Map(afterCatalog.plugins.map((p) => [p.id, p]));

  for (const [id, beforePlugin] of beforeMap) {
    const afterPlugin = afterMap.get(id);
    if (!afterPlugin) fail(`plugin ${id} missing in migrated catalog`);

    // Plugin-level metadata must be 100% identical
    for (const field of ["id", "slug", "name", "summary", "trust", "author", "license", "repository", "support"]) {
      if (beforePlugin[field] !== afterPlugin[field]) {
        fail(`plugin ${id} field "${field}" changed: before "${beforePlugin[field]}", after "${afterPlugin[field]}"`);
      }
    }
    if (JSON.stringify(beforePlugin.localizations) !== JSON.stringify(afterPlugin.localizations)) {
      fail(`plugin ${id} localizations changed`);
    }

    if (beforePlugin.releases.length !== afterPlugin.releases.length) {
      fail(`plugin ${id} releases count changed: before ${beforePlugin.releases.length}, after ${afterPlugin.releases.length}`);
    }

    for (let i = 0; i < beforePlugin.releases.length; i += 1) {
      const bRel = beforePlugin.releases[i];
      const aRel = afterPlugin.releases[i];

      if (bRel.version !== aRel.version) {
        fail(`plugin ${id} release[${i}] version mismatch: before "${bRel.version}", after "${aRel.version}"`);
      }

      if (bRel.version === targetVersion) {
        const expectedArtifactUrl = `https://github.com/${owner}/${repository}/releases/download/${targetTag}/${bRel.artifact.fileName}`;
        if (aRel.releaseUrl !== expectedReleaseUrl) {
          fail(`plugin ${id}@${bRel.version} releaseUrl incorrect: expected "${expectedReleaseUrl}", got "${aRel.releaseUrl}"`);
        }
        if (aRel.artifact.url !== expectedArtifactUrl) {
          fail(`plugin ${id}@${bRel.version} artifact.url incorrect: expected "${expectedArtifactUrl}", got "${aRel.artifact.url}"`);
        }

        // Compare every other field by equalizing the URLs on a clone
        const bClone = structuredClone(bRel);
        const aClone = structuredClone(aRel);
        aClone.releaseUrl = bClone.releaseUrl;
        aClone.artifact.url = bClone.artifact.url;

        const bCanonical = JSON.stringify(bClone);
        const aCanonical = JSON.stringify(aClone);
        if (bCanonical !== aCanonical) {
          fail(`plugin ${id}@${bRel.version} has unexpected changed fields besides releaseUrl and artifact.url`);
        }
      } else {
        // Untouched release must be byte-for-byte identical
        if (JSON.stringify(bRel) !== JSON.stringify(aRel)) {
          fail(`plugin ${id}@${bRel.version} changed even though version is not targetVersion`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Download and Verify Old Release JARs
// ---------------------------------------------------------------------------

export async function downloadAndVerifyOldJars({
  catalogPath,
  version = "0.67.0",
  targetTag = "plugins-0.67.0",
  dir,
  manifestOut,
  assetBase = DEFAULT_ASSET_BASE,
  repo = DEFAULT_PUBLIC_REPO,
}) {
  const sourceBytes = readFileSync(catalogPath);
  const validated = validateCatalogBytes(sourceBytes);
  if (!validated.ok) fail(`catalog is not valid v2: ${validated.errors[0]?.message}`);
  const catalog = validated.catalog;

  const plan = buildMigrationPlan(catalog, { version, targetTag, repo });
  mkdirSync(dir, { recursive: true });

  const assetNetwork = allowedRequestHosts(
    assetBase,
    ...(assetBase === DEFAULT_ASSET_BASE ? GITHUB_RELEASE_REDIRECT_HOSTS.map((host) => `https://${host}`) : []),
  );

  const manifest = {};
  let verifiedCount = 0;

  for (const plugin of catalog.plugins) {
    for (const release of plugin.releases) {
      const key = `${plugin.id}@${release.version}`;
      const targetPath = path.join(dir, `${plugin.slug}-${release.version}.jar`);
      const artifact = release.artifact;

      const downloadUrl = downloadTarget(artifact.url, assetBase);
      console.log(`downloading ${key} from ${downloadUrl}...`);
      const bytes = await fetchBounded(downloadUrl, MAX_ARTIFACT_SIZE, {
        approvedHosts: assetNetwork.hosts,
        allowHttp: assetNetwork.allowHttp,
      });

      if (bytes.byteLength !== artifact.size) {
        fail(`asset ${key} size mismatch: got ${bytes.byteLength}, expected ${artifact.size}`);
      }
      const actualSha = sha256Hex(bytes);
      if (actualSha !== artifact.sha256) {
        fail(`asset ${key} sha256 mismatch: got ${actualSha}, expected ${artifact.sha256}`);
      }

      writeFileSync(targetPath, bytes, { mode: 0o600 });

      // Verify descriptorSha256 and full descriptor binding against the downloaded file
      const inspected = inspectJarFile(targetPath, artifact);
      if (!inspected.ok) {
        fail(`asset ${key} inspection failed: ${inspected.errors[0]?.message}`);
      }
      if (inspected.descriptorSha256 !== artifact.descriptorSha256) {
        fail(`asset ${key} descriptorSha256 mismatch: got ${inspected.descriptorSha256}, expected ${artifact.descriptorSha256}`);
      }
      const bound = checkJarBinding(targetPath, release, plugin.id);
      if (!bound.ok) {
        fail(`asset ${key} descriptor binding failed: ${bound.errors[0]?.message}`);
      }

      manifest[key] = targetPath;
      verifiedCount += 1;
      console.log(`verified ${key} (${bytes.byteLength} bytes, sha256: ${actualSha.slice(0, 16)}..., descriptorSha256: ${inspected.descriptorSha256.slice(0, 16)}...)`);
    }
  }

  writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`downloaded and verified ${verifiedCount} JAR(s); manifest written to ${manifestOut}`);
  return { manifest, verifiedCount, plan };
}

// ---------------------------------------------------------------------------
// 4. Create or Resume Combined Release and Upload Assets
// ---------------------------------------------------------------------------

export async function syncCombinedRelease({
  catalogPath,
  version = "0.67.0",
  targetTag = "plugins-0.67.0",
  jarsManifestPath,
  repo = DEFAULT_PUBLIC_REPO,
  apiUrl = DEFAULT_API_URL,
  assetBase = DEFAULT_ASSET_BASE,
  token = null,
  dryRun = false,
}) {
  const sourceBytes = readFileSync(catalogPath);
  const validated = validateCatalogBytes(sourceBytes);
  if (!validated.ok) fail(`catalog is not valid v2: ${validated.errors[0]?.message}`);
  const catalog = validated.catalog;

  const plan = buildMigrationPlan(catalog, { version, targetTag, repo });
  const [owner, repository] = repo.split("/");

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(jarsManifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read jars manifest: ${error.message}`);
  }

  if (dryRun) {
    console.log(`[DRY RUN] Target tag: ${targetTag}`);
    console.log(`[DRY RUN] Release title: ${plan.title}`);
    console.log(`[DRY RUN] Planned assets to stage into combined release (${plan.releases.length} total):`);
    for (const rel of plan.releases) {
      const jarPath = manifest[`${rel.pluginId}@${rel.version}`];
      if (!jarPath) fail(`manifest missing JAR for ${rel.pluginId}@${rel.version}`);
      console.log(`  - ${rel.fileName} (${rel.size} bytes, sha256: ${rel.sha256}) from ${jarPath}`);
    }
    console.log(`[DRY RUN] Release body preview:\n${plan.body}`);
    console.log("[DRY RUN] No GitHub releases mutated or created.");
    return { dryRun: true, plan };
  }

  if (!token) fail("GITHUB_TOKEN is required for creating/resuming combined Release");

  const apiNetwork = allowedRequestHosts(apiUrl);
  const assetNetwork = allowedRequestHosts(
    assetBase,
    ...(assetBase === DEFAULT_ASSET_BASE ? GITHUB_RELEASE_REDIRECT_HOSTS.map((host) => `https://${host}`) : []),
  );

  const releaseUrl = `${apiUrl}/repos/${owner}/${repository}/releases/tags/${encodeURIComponent(targetTag)}`;
  const checkResponse = await redirectSafeFetch(releaseUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    approvedHosts: apiNetwork.hosts,
    allowHttp: apiNetwork.allowHttp,
  });

  let release;
  let created = false;

  if (checkResponse.status === 404) {
    console.log(`Release tag ${targetTag} not found, creating new Release...`);
    const createResponse = await redirectSafeFetch(`${apiUrl}/repos/${owner}/${repository}/releases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        tag_name: targetTag,
        name: plan.title,
        body: plan.body,
        draft: false,
        prerelease: false,
      }),
      approvedHosts: apiNetwork.hosts,
      allowHttp: apiNetwork.allowHttp,
    });
    if (!createResponse.ok) {
      const err = await createResponse.text().catch(() => "");
      fail(`failed to create release ${targetTag}: ${createResponse.status} ${err}`);
    }
    const createBytes = await readResponseBounded(createResponse, MAX_CATALOG_BYTES, "create release");
    release = JSON.parse(createBytes.toString("utf8"));
    created = true;
    console.log(`created release ${targetTag} -> ${release.html_url}`);
  } else if (checkResponse.ok) {
    const existingBytes = await readResponseBounded(checkResponse, MAX_CATALOG_BYTES, "get release");
    release = JSON.parse(existingBytes.toString("utf8"));
    console.log(`resumed existing release ${targetTag} -> ${release.html_url}`);
    if (release.draft) fail(`release ${targetTag} is a draft; refusing to operate`);
    if (release.prerelease) fail(`release ${targetTag} is a prerelease; refusing to operate`);
  } else {
    fail(`failed to inspect release ${targetTag}: HTTP ${checkResponse.status}`);
  }

  const existingAssets = Array.isArray(release.assets) ? release.assets : [];

  for (const rel of plan.releases) {
    const jarPath = manifest[`${rel.pluginId}@${rel.version}`];
    if (!jarPath) fail(`manifest missing JAR for ${rel.pluginId}@${rel.version}`);
    const localJarBytes = readFileSync(jarPath);
    if (localJarBytes.byteLength !== rel.size || sha256Hex(localJarBytes) !== rel.sha256) {
      fail(`local jar ${jarPath} does not match expected size/sha256 for ${rel.pluginId}@${rel.version}`);
    }

    const matchedAsset = existingAssets.find((a) => a.name === rel.fileName);
    let assetDownloadUrl = rel.newArtifactUrl;

    if (matchedAsset) {
      console.log(`asset ${rel.fileName} already present on ${targetTag}, checking byte-identity...`);
      if (matchedAsset.size !== rel.size) {
        fail(`asset ${rel.fileName} exists with size ${matchedAsset.size}, expected ${rel.size}; refusing to overwrite`);
      }
      assetDownloadUrl = matchedAsset.browser_download_url;
    } else {
      console.log(`uploading ${rel.fileName} (${rel.size} bytes) to release ${targetTag}...`);
      const targetUploadUrl = uploadTarget(release.upload_url, owner, repository, rel.fileName, apiUrl);
      const uploadResp = await redirectSafeFetch(targetUploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/java-archive",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: localJarBytes,
        approvedHosts: new Set([new URL(targetUploadUrl).host]),
        allowHttp: apiNetwork.allowHttp,
      });
      if (!uploadResp.ok) {
        const err = await uploadResp.text().catch(() => "");
        fail(`upload failed for ${rel.fileName}: ${uploadResp.status} ${err}`);
      }
      const uploadedData = JSON.parse((await readResponseBounded(uploadResp, MAX_CATALOG_BYTES, "upload asset")).toString("utf8"));
      if (uploadedData.size !== rel.size) {
        fail(`uploaded asset size ${uploadedData.size} != expected ${rel.size}`);
      }
      assetDownloadUrl = uploadedData.browser_download_url;
      console.log(`uploaded ${rel.fileName}`);
    }

    // Confirm that every uploaded asset is byte-identical by re-downloading it anonymously and comparing sha256
    const anonymousDownloadUrl = downloadTarget(assetDownloadUrl, assetBase);
    console.log(`verifying anonymous download of ${rel.fileName} from ${anonymousDownloadUrl}...`);
    const downloadedBytes = await fetchBounded(anonymousDownloadUrl, MAX_ARTIFACT_SIZE, {
      approvedHosts: assetNetwork.hosts,
      allowHttp: assetNetwork.allowHttp,
    });
    if (downloadedBytes.byteLength !== rel.size) {
      fail(`re-downloaded asset ${rel.fileName} size mismatch: got ${downloadedBytes.byteLength}, expected ${rel.size}`);
    }
    const downloadedSha = sha256Hex(downloadedBytes);
    if (downloadedSha !== rel.sha256) {
      fail(`re-downloaded asset ${rel.fileName} sha256 mismatch: got ${downloadedSha}, expected ${rel.sha256}`);
    }
    console.log(`asset ${rel.fileName} byte-identical verified (${rel.size} bytes, sha256: ${rel.sha256})`);
  }

  console.log(`all ${plan.releases.length} asset(s) verified on combined release ${targetTag}`);
  return { ok: true, created, releaseUrl: release.html_url, plan };
}

// ---------------------------------------------------------------------------
// 5. Production Polling
// ---------------------------------------------------------------------------

export async function pollProductionLive({
  baseUrl = "https://plugin.turboism.dev",
  expectedVersion,
  timeoutSeconds = 300,
  intervalSeconds = 10,
}) {
  if (expectedVersion === undefined || expectedVersion === null) {
    fail("expectedVersion is required for pollProductionLive");
  }
  const cleanBase = baseUrl.replace(/\/$/, "");
  const catalogUrl = `${cleanBase}/api/v2/catalog.json`;
  const baseNetwork = allowedRequestHosts(cleanBase);

  console.log(`polling ${catalogUrl} for catalogVersion >= ${expectedVersion} (timeout ${timeoutSeconds}s, interval ${intervalSeconds}s)...`);
  const startTime = Date.now();
  const maxTime = startTime + timeoutSeconds * 1000;

  while (Date.now() < maxTime) {
    try {
      const response = await redirectSafeFetch(catalogUrl, {
        headers: {
          Accept: PRODUCTION_CATALOG_CONTENT_TYPE,
          "Accept-Encoding": "identity",
        },
        approvedHosts: baseNetwork.hosts,
        allowHttp: baseNetwork.allowHttp,
      });

      if (response.ok) {
        const bytes = await readResponseBounded(response, MAX_CATALOG_BYTES, catalogUrl);
        const data = JSON.parse(bytes.toString("utf8"));
        console.log(`current live catalogVersion: ${data.catalogVersion} (looking for ${expectedVersion})`);
        if (data.catalogVersion >= Number(expectedVersion)) {
          console.log(`production catalogVersion ${data.catalogVersion} is live!`);
          return true;
        }
      } else {
        console.log(`catalog request returned HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`polling attempt error: ${error.message}`);
    }

    const remaining = Math.max(0, Math.floor((maxTime - Date.now()) / 1000));
    if (remaining <= 0) break;
    const wait = Math.min(intervalSeconds, remaining);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }

  fail(`timeout waiting for catalogVersion ${expectedVersion} on ${baseUrl} after ${timeoutSeconds}s`);
}

// ---------------------------------------------------------------------------
// CLI Dispatch
// ---------------------------------------------------------------------------

const USAGE = `usage: node scripts/catalog-v2/migrate-combined-release.mjs <subcommand> [flags]

subcommands:
  plan                  --catalog <file> [--version <v>] [--target-tag <tag>] [--repo <r>] [--out <plan.json>]
  download-and-verify   --catalog <file> --dir <dir> --manifest-out <file> [--version <v>] [--target-tag <tag>] [--asset-base <b>] [--repo <r>]
  sync-combined-release --catalog <file> --jars <jars.json> [--version <v>] [--target-tag <tag>] [--repo <r>] [--api-url <u>] [--asset-base <b>] [--token-env <t>] [--dry-run]
  assert-diff           --before <file> --after <file> [--version <v>] [--target-tag <tag>] [--repo <r>]
  poll-production       --expected-version <n> [--base-url <u>] [--timeout-seconds <s>] [--interval-seconds <s>]`;

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  if (!subcommand) {
    console.error(USAGE);
    process.exit(2);
  }

  try {
    switch (subcommand) {
      case "plan": {
        const flags = parseFlags(args, { strings: ["catalog", "version", "target-tag", "repo", "out"] });
        const catalogPath = requireFlag(flags, "catalog");
        const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
        const plan = buildMigrationPlan(catalog, {
          version: flags["version"] ?? "0.67.0",
          targetTag: flags["target-tag"] ?? "plugins-0.67.0",
          repo: flags["repo"] ?? DEFAULT_PUBLIC_REPO,
        });
        if (flags["out"]) {
          writeFileSync(flags["out"], JSON.stringify(plan, null, 2) + "\n", "utf8");
        }
        console.log(`Migration plan for ${plan.version} -> ${plan.targetTag} (${plan.releases.length} releases):`);
        console.log(plan.body);
        break;
      }

      case "download-and-verify": {
        const flags = parseFlags(args, { strings: ["catalog", "version", "target-tag", "dir", "manifest-out", "asset-base", "repo"] });
        const catalogPath = requireFlag(flags, "catalog");
        const dir = requireFlag(flags, "dir");
        const manifestOut = requireFlag(flags, "manifest-out");
        await downloadAndVerifyOldJars({
          catalogPath,
          version: flags["version"] ?? "0.67.0",
          targetTag: flags["target-tag"] ?? "plugins-0.67.0",
          dir,
          manifestOut,
          assetBase: flags["asset-base"] ?? DEFAULT_ASSET_BASE,
          repo: flags["repo"] ?? DEFAULT_PUBLIC_REPO,
        });
        break;
      }

      case "sync-combined-release": {
        const flags = parseFlags(args, {
          strings: ["catalog", "version", "target-tag", "jars", "repo", "api-url", "asset-base", "token-env"],
          booleans: ["dry-run"],
        });
        const catalogPath = requireFlag(flags, "catalog");
        const jars = requireFlag(flags, "jars");
        const tokenEnv = flags["token-env"] ?? "GITHUB_TOKEN";
        const token = process.env[tokenEnv];
        await syncCombinedRelease({
          catalogPath,
          version: flags["version"] ?? "0.67.0",
          targetTag: flags["target-tag"] ?? "plugins-0.67.0",
          jarsManifestPath: jars,
          repo: flags["repo"] ?? DEFAULT_PUBLIC_REPO,
          apiUrl: flags["api-url"] ?? DEFAULT_API_URL,
          assetBase: flags["asset-base"] ?? DEFAULT_ASSET_BASE,
          token,
          dryRun: Boolean(flags["dry-run"]),
        });
        break;
      }

      case "assert-diff": {
        const flags = parseFlags(args, { strings: ["before", "after", "version", "target-tag", "repo"] });
        const before = JSON.parse(readFileSync(requireFlag(flags, "before"), "utf8"));
        const after = JSON.parse(readFileSync(requireFlag(flags, "after"), "utf8"));
        assertUrlOnlyDiff(before, after, {
          targetVersion: flags["version"] ?? "0.67.0",
          targetTag: flags["target-tag"] ?? "plugins-0.67.0",
          repo: flags["repo"] ?? DEFAULT_PUBLIC_REPO,
        });
        console.log(`assert-diff OK: catalog diff is strictly URL-only for ${flags["version"] ?? "0.67.0"} -> ${flags["target-tag"] ?? "plugins-0.67.0"}`);
        break;
      }

      case "poll-production": {
        const flags = parseFlags(args, { strings: ["expected-version", "base-url", "timeout-seconds", "interval-seconds"] });
        const expectedVersion = requireFlag(flags, "expected-version");
        await pollProductionLive({
          expectedVersion: Number(expectedVersion),
          baseUrl: flags["base-url"] ?? "https://plugin.turboism.dev",
          timeoutSeconds: Number(flags["timeout-seconds"] ?? 300),
          intervalSeconds: Number(flags["interval-seconds"] ?? 10),
        });
        break;
      }

      default:
        console.error(`unknown subcommand "${subcommand}"\n\n${USAGE}`);
        process.exit(2);
    }
  } catch (error) {
    if (error.usage) {
      console.error(error.message);
      console.error(USAGE);
      process.exit(2);
    }
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
