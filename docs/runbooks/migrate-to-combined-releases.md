# Supervisor Runbook: Migrating to Combined GitHub Releases

## Context and Safety Justification

In generation 2 (`00000002`, `catalogVersion: 2`), 24 official plugins at version `0.67.0` were published using individual per-plugin GitHub Releases tagged `plugin-<module>-v0.67.0`.

The catalog v2 specification (see `docs/plugin-directory-api-v2.md` §8) stipulates:
> "Catalog versions and published assets are immutable. Corrections require a new plugin version or catalog version; assets are never overwritten."

This contract permits a new signed catalog generation (`catalogVersion: 3`, generation `00000003`) to update `releaseUrl` and `artifact.url` for existing plugin releases when:
1. The asset bytes themselves are strictly identical (`sha256`, `descriptorSha256`, and `size` remain unchanged and hash-pinned).
2. The new URLs point to public HTTPS GitHub Release download locations matching `artifact.fileName`.
3. The catalog version advances strictly by one (`current + 1`), signed by the authorized production Ed25519 key.
4. Downstream clients (including Turboism's `PluginCatalogClient` and `PluginCatalogVerifier`) verify downloaded JARs against the hash-pinned `sha256` and `size`, which are unaffected by the URL change.

The following runbook guides the supervisor through performing this migration safely with zero downtime.

---

## Migration Procedure

### Phase 1: Create the Combined Release and Stage Assets

1. **Create the combined GitHub Release**:
   - **Repository:** `turboism/turboism-plugin-directory`
   - **Tag:** `plugins-0.67.0`
   - **Target:** `main` (commit matching the 0.67.0 release)
   - **Title:** `Turboism plugins · 0.67.0`
   - **Draft:** `false`
   - **Prerelease:** `false`
   - **Body:** Markdown table detailing the 24 official plugins, version `0.67.0`, and their lowercase SHA-256 digests.

2. **Upload all 24 verified JAR files**:
   - Ensure the 24 JAR files match the live generation 2 catalog hashes exactly.
   - Upload each file as a release asset (e.g. via `gh release upload plugins-0.67.0 ...` or GitHub Web UI).
   - Verify every uploaded asset:
     - Exact filename matches `[module]-0.67.0.jar`.
     - File size matches catalog `size`.
     - Download each asset anonymously and verify `sha256sum`.

### Phase 2: Produce the Next Signed-Generation Input

1. **Run `migrate-artifact-urls`**:
   In a clean clone of `turboism-plugin-directory` on `main`:
   ```bash
   node scripts/catalog-v2/ingest-official-release.mjs migrate-artifact-urls \
     --catalog catalog/v2/catalog.json \
     --target-tag plugins-0.67.0 \
     --version 0.67.0
   ```
   This will:
   - Re-point all 24 `0.67.0` releases to `https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.67.0` and `https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-0.67.0/<module>-0.67.0.jar`.
   - Bump `catalogVersion` from `2` to `3`.
   - Update `publishedAt` to the current UTC timestamp.
   - Validate the new catalog with `validateCatalogBytes`.

2. **Verify working tree diff**:
   ```bash
   git diff catalog/v2/catalog.json
   npm run validate:directory
   ```

### Phase 3: Publish and Deploy Generation 3

1. **Publish Generation 3**:
   Trigger the `Publish Plugin Directory v2 catalog` workflow (`publish-plugin-directory-v2.yml`) in manual mode (empty inputs) or run `scripts/catalog-v2/publish.mjs` with the provisioned production signing key.
   This will:
   - Hydrate the 24 JARs from the combined release `plugins-0.67.0`.
   - Verify descriptor bindings against the JAR bytes.
   - Sign the generation 3 catalog using `turboism-official-v1`.
   - Stage generation `00000003` and commit `current`.

2. **Deploy to production**:
   - Wait for Vercel deployment of generation 3 to complete.

### Phase 4: Production Verification

1. **Verify production deployment**:
   ```bash
   node scripts/catalog-v2/ingest-official-release.mjs verify-production \
     --base-url https://plugin.turboism.dev \
     --keys lib/catalog-v2/trusted-keys.json
   ```
   Confirm that all 24 JARs download anonymously and verify byte-for-byte against generation 3.

2. **Verify with Turboism client verification**:
   Run `/opt/dev/projects/turboism/scripts/release/verify-plugin-publication.py` with the 0.67.0 plan to ensure client verification passes against `https://plugin.turboism.dev/api/v2/catalog.json`.

### Phase 5: Cleanup Old Per-Plugin Releases

**CRITICAL:** Only perform this step after Phase 4 is 100% verified and successful.

1. **Delete the 24 old per-plugin Releases**:
   For each module in the 24 official plugins:
   ```bash
   gh release delete "plugin-${module}-v0.67.0" --yes --repo turboism/turboism-plugin-directory
   git push origin ":refs/tags/plugin-${module}-v0.67.0"
   ```
2. Confirm that only the combined release `plugins-0.67.0` remains.
