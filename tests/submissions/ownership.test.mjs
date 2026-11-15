import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNERSHIP_FORMAT,
  OWNERSHIP_SCHEMA_VERSION,
  RESERVED_ROUTE_SLUGS,
  RETIRED_CLIENT_PLUGIN_IDS,
  parseOwnershipRegistry,
  serializeOwnershipRegistry,
  validatePluginNamespaceAndOwnership,
  verifyRepositoryPublisher,
} from "../../lib/submissions/ownership.mjs";

function makeEmptyOwnership() {
  return {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {},
  };
}

function makeSampleCatalog() {
  return {
    plugins: [
      {
        id: "dev.turboism.plugin.mcp",
        slug: "mcp",
        trust: "official",
      },
      {
        id: "com.example.existing",
        slug: "existing-plugin",
        trust: "reviewed-third-party",
      },
    ],
  };
}

test("parseOwnershipRegistry and serializeOwnershipRegistry validate strict schema and reject hijackable corruption", () => {
  const empty = parseOwnershipRegistry(
    JSON.stringify({
      format: OWNERSHIP_FORMAT,
      schemaVersion: OWNERSHIP_SCHEMA_VERSION,
      claims: {},
    }),
  );
  assert.equal(empty.ok, true);

  const populated = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {
      "com.example.alpha": {
        slug: "alpha-tool",
        ownerGithubId: 1001,
        ownerLogin: "alice",
        repoId: 2002,
        repository: "https://github.com/alice/alpha-tool",
        claimedAt: "2026-09-01T12:00:00Z",
      },
    },
  };
  const serialized = serializeOwnershipRegistry(populated);
  const reparsed = parseOwnershipRegistry(serialized);
  assert.equal(reparsed.ok, true);
  assert.deepEqual(reparsed.registry, populated);

  const duplicateKeys = '{"format":"turboism.plugin.ownership","schemaVersion":1,"claims":{},"claims":{}}';
  assert.equal(parseOwnershipRegistry(duplicateKeys).ok, false);

  const nonPositiveId = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {
      "com.example.alpha": {
        ...populated.claims["com.example.alpha"],
        ownerGithubId: 0,
      },
    },
  };
  assert.equal(parseOwnershipRegistry(nonPositiveId).ok, false);

  const duplicateSlug = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {
      "com.example.alpha": populated.claims["com.example.alpha"],
      "com.example.beta": {
        ...populated.claims["com.example.alpha"],
        repoId: 2003,
      },
    },
  };
  assert.equal(parseOwnershipRegistry(duplicateSlug).ok, false);
});

test("validatePluginNamespaceAndOwnership blocks reserved namespaces, retired ids, official collisions, and cross-owner/cross-repo hijacking", () => {
  const catalog = makeSampleCatalog();
  const ownership = makeEmptyOwnership();

  for (const forbiddenId of ["dev.turboism.core", "dev.turboism.plugin.custom", RETIRED_CLIENT_PLUGIN_IDS[0]]) {
    const res = validatePluginNamespaceAndOwnership({
      pluginId: forbiddenId,
      slug: "custom-plugin",
      submitterGithubId: 500,
      repoId: 900,
      repositoryUrl: "https://github.com/alice/custom-plugin",
      catalog,
      ownership,
    });
    assert.equal(res.ok, false, `expected rejection for ${forbiddenId}`);
  }

  for (const reservedSlug of RESERVED_ROUTE_SLUGS) {
    const reservedSlugResult = validatePluginNamespaceAndOwnership({
      pluginId: "com.example.route-collision",
      slug: reservedSlug,
      submitterGithubId: 500,
      repoId: 900,
      repositoryUrl: "https://github.com/alice/route-collision",
      catalog,
      ownership,
    });
    assert.equal(reservedSlugResult.ok, false, `expected rejection for reserved route slug ${reservedSlug}`);
  }

  const officialSlugCollision = validatePluginNamespaceAndOwnership({
    pluginId: "com.evil.mcp-clone",
    slug: "mcp",
    submitterGithubId: 500,
    repoId: 900,
    repositoryUrl: "https://github.com/evil/mcp-clone",
    catalog,
    ownership,
  });
  assert.equal(officialSlugCollision.ok, false);

  const firstClaim = validatePluginNamespaceAndOwnership({
    pluginId: "com.alice.helper",
    slug: "alice-helper",
    submitterGithubId: 500,
    repoId: 900,
    repositoryUrl: "https://github.com/alice/helper",
    catalog,
    ownership,
  });
  assert.equal(firstClaim.ok, true);
  assert.equal(firstClaim.isFirstClaim, true);

  const claimedOwnership = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {
      "com.alice.helper": {
        slug: "alice-helper",
        ownerGithubId: 500,
        ownerLogin: "alice",
        repoId: 900,
        repository: "https://github.com/alice/helper",
        claimedAt: "2026-09-01T12:00:00Z",
      },
    },
  };

  const sameOwnerAndRepo = validatePluginNamespaceAndOwnership({
    pluginId: "com.alice.helper",
    slug: "alice-helper",
    submitterGithubId: 500,
    repoId: 900,
    repositoryUrl: "https://github.com/alice/helper-renamed",
    catalog,
    ownership: claimedOwnership,
  });
  assert.equal(sameOwnerAndRepo.ok, true);
  assert.equal(sameOwnerAndRepo.isFirstClaim, false);

  const differentOwner = validatePluginNamespaceAndOwnership({
    pluginId: "com.alice.helper",
    slug: "alice-helper",
    submitterGithubId: 999,
    repoId: 900,
    repositoryUrl: "https://github.com/alice/helper",
    catalog,
    ownership: claimedOwnership,
  });
  assert.equal(differentOwner.ok, false);

  const differentRepo = validatePluginNamespaceAndOwnership({
    pluginId: "com.alice.helper",
    slug: "alice-helper",
    submitterGithubId: 500,
    repoId: 901,
    repositoryUrl: "https://github.com/alice/fork-poison",
    catalog,
    ownership: claimedOwnership,
  });
  assert.equal(differentRepo.ok, false);

  const slugSteal = validatePluginNamespaceAndOwnership({
    pluginId: "com.alice.other",
    slug: "alice-helper",
    submitterGithubId: 500,
    repoId: 900,
    repositoryUrl: "https://github.com/alice/helper",
    catalog,
    ownership: claimedOwnership,
  });
  assert.equal(slugSteal.ok, false);
});

test("verifyRepositoryPublisher enforces public active repository and least-privilege owner/org/manifest paths", () => {
  const submitter = { githubId: 77, login: "AliceDev" };

  assert.equal(
    verifyRepositoryPublisher({
      submitter,
      repo: { private: true, archived: false, owner: { id: 77, type: "User" } },
    }).ok,
    false,
  );
  assert.equal(
    verifyRepositoryPublisher({
      submitter,
      repo: { private: false, archived: true, owner: { id: 77, type: "User" } },
    }).ok,
    false,
  );

  const byOwner = verifyRepositoryPublisher({
    submitter,
    repo: { private: false, archived: false, owner: { id: 77, type: "User" } },
  });
  assert.deepEqual(byOwner, { ok: true, reason: "repo_owner" });

  const byOrg = verifyRepositoryPublisher({
    submitter,
    repo: { private: false, archived: false, owner: { id: 888, type: "Organization" } },
    isPublicOrgMember: true,
  });
  assert.deepEqual(byOrg, { ok: true, reason: "org_public_member" });

  const byManifestLogin = verifyRepositoryPublisher({
    submitter,
    repo: { private: false, archived: false, owner: { id: 888, type: "Organization" } },
    isPublicOrgMember: false,
    publishersFileContent: JSON.stringify({ publishers: ["alicedev"] }),
  });
  assert.deepEqual(byManifestLogin, { ok: true, reason: "publishers_manifest" });

  const byManifestId = verifyRepositoryPublisher({
    submitter,
    repo: { private: false, archived: false, owner: { id: 999, type: "User" } },
    publishersFileContent: JSON.stringify({ publishers: [77] }),
  });
  assert.deepEqual(byManifestId, { ok: true, reason: "publishers_manifest" });

  const unauthorized = verifyRepositoryPublisher({
    submitter,
    repo: { private: false, archived: false, owner: { id: 888, type: "Organization" } },
    isPublicOrgMember: false,
    publishersFileContent: JSON.stringify({ publishers: ["someone-else"] }),
  });
  assert.equal(unauthorized.ok, false);
});
