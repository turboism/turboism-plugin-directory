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

Because the Ed25519 catalog signing private key exists only as the `PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM` secret within the protected `catalog-signing` GitHub environment, the migration runs as a protected GitHub Actions workflow: `.github/workflows/migrate-combined-release.yml`.

The following runbook guides the supervisor through executing the migration safely with zero downtime.

---

## Migration Procedure

### Phase 1: Dry-Run Verification

Always dispatch the migration workflow in dry-run mode first (`dry_run=true`, which is the default). In dry-run mode:
- (a) Verifies the live generation 2 signature and source catalog against `lib/catalog-v2/trusted-keys.json`.
- (b) Downloads all 24 JARs from the old per-plugin Releases and verifies `sha256`, `size`, `descriptorSha256`, and descriptor schema-v3 bindings.
- (c) Plans the combined release `plugins-0.67.0` (title and markdown body) without mutating GitHub Releases.
- (d) Performs catalog URL migration, asserts that ONLY release and artifact URLs change, extracts READMEs, signs and stages generation 3 in a temp directory, verifies its signature against the trusted allowlist, and prints the planned catalog diff.
- Does NOT mutate any GitHub Releases.
- Does NOT push to `main` or trigger deployments.

1. **Dispatch the dry-run workflow**:
   ```bash
   gh workflow run migrate-combined-release.yml \
     -f version=0.67.0 \
     -f target_tag=plugins-0.67.0 \
     -f dry_run=true
   ```

2. **Monitor the dry-run execution**:
   ```bash
   gh run watch
   ```

3. **Inspect the dry-run logs**:
   Confirm that:
   - All 24 JARs are downloaded and hash-verified.
   - The planned combined release metadata and markdown table are logged.
   - The URL-only diff assertion passes.
   - The planned `git diff` displays strictly URL changes (`plugin-<module>-v0.67.0` -> `plugins-0.67.0`) and `catalogVersion: 2 -> 3`.
   - The dry-run publish step completes cleanly with zero errors.

---

### Phase 2: Live Migration Execution

Once the dry-run succeeds and its diff is approved:

1. **Dispatch the live migration**:
   ```bash
   gh workflow run migrate-combined-release.yml \
     -f version=0.67.0 \
     -f target_tag=plugins-0.67.0 \
     -f dry_run=false
   ```

2. **Monitor the workflow run**:
   ```bash
   gh run watch
   ```

3. **What the live workflow executes**:
   - Creates or resumes the combined Release `plugins-0.67.0` on GitHub with title `Turboism plugins · 0.67.0` and table body.
   - Uploads each verified JAR asset with no-clobber semantics.
   - Verifies byte-identity by re-downloading each uploaded asset anonymously and comparing `sha256`.
   - Updates `catalog/v2/catalog.json` (`catalogVersion: 3`) and validates URL-only diff hygiene.
   - Runs `publish.mjs` with the production key in `catalog-signing`:
     - Extracts generation-bound READMEs into `public/api/v2/generations/00000003/readmes/` and writes `readmes.json`.
     - Signs canonical catalog bytes and stages generation `00000003`.
     - Atomically commits `public/api/v2/current` to `00000003`.
   - Checks diff hygiene and scans for private-key markers.
   - Commits and pushes the new generation to `main` as `github-actions[bot]`.
   - Triggers the Vercel deploy hook (`VERCEL_DEPLOY_HOOK_URL`) if configured.
   - Polls `https://plugin.turboism.dev/api/v2/catalog.json` until `catalogVersion: 3` is live.
   - Runs `verify-production` to confirm all 24 migrated artifact URLs download anonymously and match their cataloged SHA-256 digests.

---

### Phase 3: Post-Migration Production Verification

After the live workflow finishes with success:

1. **Verify production catalog and asset downloads**:
   In a clean clone of `turboism-plugin-directory` on `main`:
   ```bash
   git pull origin main
   node scripts/catalog-v2/ingest-official-release.mjs verify-production \
     --base-url https://plugin.turboism.dev \
     --keys lib/catalog-v2/trusted-keys.json
   ```
   Confirm output:
   `production verification OK: identity catalog bytes ..., key "turboism-official-v1", anonymous JARs measured 24`

2. **Verify with Turboism client verification**:
   Run Turboism verification against production to confirm downstream client compatibility:
   ```bash
   /opt/dev/projects/turboism/scripts/release/verify-plugin-publication.py
   ```
   Confirm that `PluginCatalogClient` resolves the catalog and validates all 24 plugins.

3. **Verify web detail pages**:
   Visit `https://turboism.dev/plugins` and spot-check plugin detail pages (e.g. `/history-panel`, `/webdav-backup`) to confirm that generation 3 READMEs render properly in English and Chinese.

---

### Phase 4: Cleanup Old Per-Plugin Releases

**CRITICAL:** Only perform this step after Phase 3 is 100% verified and production verification succeeds. Do NOT delete old Releases before verifying generation 3.

The migration workflow intentionally does not delete old Releases to ensure zero risk during rollout.

1. **Delete the 24 old per-plugin GitHub Releases**:
   Run the following loop with GitHub CLI:
   ```bash
   for module in \
     acp boundingbox-warp-mirror clipmask-viewer command-palette cubism-tab-filter \
     external-psd-edit history-panel mcp mesh-edit-mirror-axis-enhance model-import-3d \
     palette-label-style parameter-batch-transfer perf-stats physics-editor protected-export \
     psd-clip-mask-import recent-preview scene-palette-enhancer selection-brush \
     atlas-maxrects-bssf texture-atlas-stats ui-theme warp-deformer-alt-symmetry webdav-backup; do
     echo "Deleting release plugin-${module}-v0.67.0..."
     gh release delete "plugin-${module}-v0.67.0" --yes --repo turboism/turboism-plugin-directory
   done
   ```

2. **Tag Cleanup Choice (`--cleanup-tag` vs Keeping Tags)**:
   - `gh release delete` offers an optional `--cleanup-tag` flag that also deletes the git tag on remote.
   - **Recommendation: Do NOT pass `--cleanup-tag`. Keep the git tags.**
   - **Reason:** The previous signed catalog generation (`public/api/v2/generations/00000002/`) remains part of git history and deployed archival records. Keeping the git tags (`refs/tags/plugin-<module>-v0.67.0`) preserves immutable git history references and prevents broken tag pointers, while deleting the GitHub Releases removes the duplicate release entries and assets from the repository Releases UI once all traffic uses `plugins-0.67.0`.
   - If team policy ever requires deleting the tags at a later date after full deprecation:
     ```bash
     for module in ...; do
       git push origin ":refs/tags/plugin-${module}-v0.67.0"
     done
     ```

3. **Confirm combined release status**:
   ```bash
   gh release list --repo turboism/turboism-plugin-directory
   ```
   Confirm that `plugins-0.67.0` is present and active with all 24 assets.

---

## Rollback Plan

Catalog v2 generations are immutable and append-only:

1. **Before workflow push**:
   If any check fails during Phase 1 (dry-run) or Phase 2 (prior to git push):
   - No git commits or tags have been pushed to `main`.
   - Production serves generation `00000002`.
   - The old per-plugin Releases remain completely untouched.
   - Nothing needs rolling back.

2. **After workflow push but before Phase 4 deletion**:
   If an unexpected issue is discovered after generation `00000003` is deployed:
   - Because Phase 4 has NOT been executed, all 24 old Releases (`plugin-<module>-v0.67.0`) and their JAR downloads remain fully online and accessible.
   - Both old and new URLs host byte-identical assets (`sha256` identical).
   - To roll production back to generation `00000002`:
     1. In `turboism-plugin-directory` on `main`:
        ```bash
        echo "00000002" > public/api/v2/current
        git add public/api/v2/current
        git commit -m "revert(catalog-v2): rollback active generation pointer to 00000002"
        git push origin main
        ```
     2. Wait for Vercel deployment to complete.
     3. Verify `https://plugin.turboism.dev/api/v2/catalog.json` serves `catalogVersion: 2`.
   - Generation 2 immediately resumes serving without broken downloads.
