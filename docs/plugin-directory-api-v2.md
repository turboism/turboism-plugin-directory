# Turboism Plugin Directory API v2

Status: **Frozen review candidate; not yet authorized for production**
Canonical origin: `https://plugin.turboism.dev`
Machine-readable contract: [`openapi/plugin-directory-v2.openapi.json`](openapi/plugin-directory-v2.openapi.json)

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** are normative.

## 1. Authority and replacement policy

API v2 is the sole production candidate for the Plugin Directory.

The earlier v1 design was never released. The provider MUST NOT deploy v1 endpoints, and Turboism clients MUST NOT read, migrate, or fall back to v1 catalogs. V2 uses its own endpoint paths, media versions, schema versions, signatures, and client cache. Retaining v1 design documents in source is historical only and does not create a compatibility surface.

V2 publishes:

1. a complete signed catalog used as the only remote installation authority; and
2. a filtered, sorted, page-based discovery endpoint for the website and external consumers.

A client MUST NOT install a JAR using only data returned by the dynamic discovery endpoint.

## 2. Scope

### Goals

- Publish official and reviewed third-party Turboism plugins.
- Publish immutable `.jar` artifact identities.
- Require plugin metadata schema v3 for every catalog release.
- Bind each release's category and ordered tags to its JAR descriptor.
- Support English, Simplified Chinese, and Japanese display metadata.
- Support deterministic category/tag search, filtering, sorting, and pagination.
- Support ETag revalidation and offline verified caches.
- Bind installation metadata to an Ed25519-signed catalog.

### Non-goals

- Uploading JARs to this service.
- User accounts, ratings, download counts, recommendations, or self-service publication.
- Arbitrary repository federation.
- Dependency resolution by the service.
- Silent installation or automatic updates.
- `.tplugin` assets.
- V1 compatibility, downgrade, cache conversion, or dual-protocol clients.

JARs are hosted on an approved public release host. The initial approved host is GitHub Releases.

## 3. Endpoints and representations

| Method | Path | Purpose | Trust use |
|---|---|---|---|
| `GET` / `HEAD` | `/api/v2/catalog.json` | Complete catalog bytes | Authoritative after signature verification |
| `GET` / `HEAD` | `/api/v2/catalog.json.sig` | Detached-signature envelope | Authoritative verifier input |
| `GET` / `HEAD` | `/api/v2/plugins` | Filtered and paginated discovery | Display/discovery only |

All endpoints:

- MUST use HTTPS in production;
- MUST be anonymously readable;
- MUST return UTF-8 JSON;
- MUST emit `ETag` and honor `If-None-Match` with `304 Not Modified`;
- MUST reject unsupported methods rather than mutate state.

Catalog clients send:

```http
Accept: application/vnd.turboism.plugin-catalog+json;version=2
Accept-Encoding: identity
```

The signature representation is `application/vnd.turboism.plugin-catalog-signature+json;version=2`; search is `application/vnd.turboism.plugin-search+json;version=2`.

The production catalog endpoint MUST return identity-encoded bytes without `Content-Encoding` for an identity request.

## 4. Complete catalog and signature

The complete body conforms to OpenAPI `PluginCatalog` with:

```json
{
  "format": "turboism.plugin.catalog",
  "schemaVersion": 2,
  "catalogVersion": 1,
  "publishedAt": "2026-08-15T00:00:00Z",
  "plugins": []
}
```

Limits:

- catalog body: at most 5 MiB;
- plugins: at most 10,000;
- releases per plugin: at most 100;
- deterministic object keys and array order in published bytes.

A publisher increments `catalogVersion` for every semantic catalog change. Rebuilding identical bytes MUST NOT increment it.

Within a catalog, plugin IDs and slugs are unique and release versions are unique within a plugin. Every artifact URL is immutable. Hashes are lowercase SHA-256. `artifact.fileName` ends in `.jar`, media type is exactly `application/java-archive`, and size is 1 through 16 MiB inclusive.

The detached envelope is:

```json
{
  "format": "turboism.plugin.catalog.signature",
  "schemaVersion": 2,
  "algorithm": "Ed25519",
  "keyId": "turboism-official-v1",
  "catalogSha256": "<SHA-256 of exact catalog bytes>",
  "signature": "<base64 Ed25519 signature over exact catalog bytes>"
}
```

The key ID versions trust material, not the API shape. Reusing `turboism-official-v1` for v2 is valid only because it has not yet been provisioned or activated for a production v1 catalog.

Verification order is normative:

1. reject an unknown format, schema version, algorithm, or key ID;
2. hash the exact identity-encoded catalog bytes;
3. compare `catalogSha256` in constant time;
4. verify Ed25519 over the exact bytes;
5. parse JSON only after steps 1–4 pass;
6. validate strict schema v2 and all semantic rules.

The private key MUST NOT enter either repository, client resources, Gradle configuration, logs, fixtures, or release artifacts. Clients embed only reviewed public keys. Rotation requires a client release trusting old and new key IDs before provider activation.

## 5. Catalog model

### 5.1 Plugin identity

A plugin contains stable listing identity and publisher information:

- `id`, `slug`, default English `name` and `summary`;
- optional `zh-Hans` and `ja` localized name/summary;
- `trust`: `official` or `reviewed-third-party`;
- `author`, `license`, `repository`, `support`;
- one or more retained releases.

Classification is release-owned in v2. A plugin object has no top-level `category` or `tags`.

`trust=official` means the artifact followed the Turboism official publication process. `reviewed-third-party` does not imply Turboism authorship, security certification, or continuing compatibility support.

### 5.2 Release and descriptor classification

Every release is backed by a JAR whose `META-INF/turboism/plugin.json` has `schemaVersion: 3`.

Required release fields include:

- strict `version` (`MAJOR.MINOR.PATCH`, no prerelease suffix);
- `channel`: `stable` or `preview`;
- `status`: `active` or `yanked`;
- UTC `publishedAt`;
- `category`: lowercase kebab-case, 2–32 characters;
- `tags`: ordered, unique lowercase kebab-case values, each 2–32 characters, at most 12;
- `turboismApi` using Turboism's exact/bounded half-open grammar;
- `requiresCubism`, `cubismVersions`, and `platforms`;
- normalized dependencies and permissions;
- `releaseUrl`, optional `sourceRevision`, and `artifact`.

The category and tag sequence MUST exactly equal the parsed schema-v3 descriptor's `category` and `tags`; tag order is significant for binding even though query membership is set-like.

For `trust=official`, category MUST be one of the reviewed runtime registry values at publication time:

```text
modeling workflow appearance analysis performance integration system development
```

A reviewed third-party category may be any valid v3 token. Clients preserve the signed raw token for equality and filtering, but MAY present an unregistered token through the runtime's localized `other` fallback.

When `requiresCubism=true`, `cubismVersions` contains at least one exact reviewed Editor release. When false, it is empty. Core runtime version MUST NOT be substituted for Cubism Editor release identity.

A yanked release remains identifiable in the signed catalog but MUST NOT be offered for a new install or update.

### 5.3 Artifact-to-descriptor binding

Before publication, every release must be backed by a strictly inspected JAR. The publisher requires:

- JAR SHA-256 and byte length equal `artifact.sha256` and `artifact.size`;
- exactly one `META-INF/turboism/plugin.json`;
- descriptor SHA-256 equals `artifact.descriptorSha256`;
- descriptor schema version is exactly 3;
- descriptor ID and version equal plugin ID and release version;
- descriptor `turboismApi`, `environment.requiresCubism`, permissions, and dependencies agree with the release after documented default normalization;
- release `category` equals descriptor category;
- release `tags` equals the descriptor's immutable ordered tag list;
- the JAR passes Turboism's strict plugin JAR policy.

Permissions normalize omitted descriptor scope to `application`; catalog reasons remain required. Dependencies normalize omitted type to `required` and ordering to `none`.

### 5.4 Example

```json
{
  "format": "turboism.plugin.catalog",
  "schemaVersion": 2,
  "catalogVersion": 1,
  "publishedAt": "2026-08-15T00:00:00Z",
  "plugins": [
    {
      "id": "dev.turboism.plugin.project-inspector",
      "slug": "project-inspector",
      "name": "Project Inspector",
      "summary": "Inspect the active Cubism project and workspace.",
      "localizations": {},
      "trust": "official",
      "author": "Turboism Contributors",
      "license": "Project License",
      "repository": "https://github.com/turboism/Turboism",
      "support": "https://github.com/turboism/Turboism/issues",
      "releases": [
        {
          "version": "0.1.0",
          "channel": "preview",
          "status": "active",
          "publishedAt": "2026-08-15T00:00:00Z",
          "category": "development",
          "tags": ["project", "inspection"],
          "turboismApi": "[0.1.0,0.2.0)",
          "requiresCubism": true,
          "cubismVersions": ["5.3.02"],
          "platforms": ["windows-x64"],
          "dependencies": [],
          "permissions": [],
          "releaseUrl": "https://github.com/turboism/turboism-releases/releases/tag/v0.1.0",
          "sourceRevision": "0123456789abcdef0123456789abcdef01234567",
          "artifact": {
            "mediaType": "application/java-archive",
            "fileName": "turboism-plugin-project-inspector-0.1.0.jar",
            "url": "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/turboism-plugin-project-inspector-0.1.0.jar",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "descriptorSha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            "size": 123456
          }
        }
      ]
    }
  ]
}
```

## 6. Discovery query

`GET /api/v2/plugins` accepts:

| Parameter | Cardinality | Default | Constraint |
|---|---:|---|---|
| `q` | one | empty | trimmed literal, at most 200 Unicode code points |
| `trust` | repeated | all | official / reviewed-third-party |
| `category` | repeated | all | v3 category token |
| `tag` | repeated | all | v3 tag token |
| `channel` | repeated | all | stable / preview |
| `turboismApi` | one | unset | strict version |
| `cubismVersion` | one | unset | exact Editor release |
| `platform` | repeated | all | currently windows-x64 |
| `locale` | one | en | en / zh-Hans / ja |
| `sort` | one | published-desc | published-desc / updated-desc / name-asc / name-desc |
| `page` | one | 1 | integer >= 1 |
| `pageSize` | one | 20 | 1–100 |

Repeated values within a field are OR. Different fields are AND. Duplicate repeated values normalize to one. Unknown parameters and duplicate scalar parameters return `400 invalid_query`.

The service normalizes text with Unicode NFKC and locale-independent lowercase. `q` is one literal substring, not regex or fuzzy search.

Release selection is deterministic:

1. start with active releases;
2. apply channel, Turboism API, exact Cubism Editor release, platform, category, and tag filters;
3. apply `q` to plugin ID/slug/localized name/summary and to each candidate release's category/tags;
4. select the highest matching strict version;
5. filter and sort plugins before pagination.

If `q` matches only release classification, the selected release itself must contain that match. `latestCompatibleRelease` therefore owns the category/tags shown by a search item. Search items do not duplicate classification at plugin level.

All sort orders use plugin ID ascending as final tie-breaker. Pages are one-based; zero results have `totalPages=0`; out-of-range pages return `200` with `items=[]`.

The dynamic response is discovery-only. Before download, clients re-resolve the exact plugin/release from a locally verified complete v2 catalog and require equality for artifact identity, status, compatibility, category, and ordered tags.

## 7. Client behavior

Turboism's built-in store fetches and verifies the complete catalog, then filters and paginates its immutable local snapshot. It does not call dynamic search per keystroke.

The v2 client:

- uses a separate v2 cache namespace;
- never imports or trusts a v1 cache;
- never falls back to v1 endpoints;
- defaults to compatible active releases, page 1, page size 20, current locale, current Turboism API, exact Editor release when known, and windows-x64;
- fails closed for Cubism-bound releases when exact Editor release is unknown;
- supports local installed/update/local-newer/local-build/pending-restart state without sending that state to the service;
- re-resolves category/tags and artifact identity immediately before staging.

## 8. Publication and security invariants

Publication fails before deployment when:

- schema or semantic validation fails;
- IDs, slugs, or release versions duplicate;
- any release descriptor is not schema v3;
- category/tags or other bound descriptor metadata differ;
- an official category is outside the reviewed registry;
- an artifact is unavailable anonymously, redirects outside the approved host set, or downgrades HTTPS;
- size, JAR hash, descriptor hash, identity, or strict JAR policy differs;
- a yanked release is selected as current;
- signing fails or verification with the committed production public key fails;
- generated search results differ from equivalent local filtering fixtures.

Catalog versions and published assets are immutable. Corrections require a new plugin version or catalog version; assets are never overwritten.

## 9. Errors and evolution

Errors use the standard envelope `{ "error": { "code", "message", "field"? } }` with codes `invalid_query`, `not_acceptable`, `catalog_invalid`, and `catalog_unavailable`. Responses never expose paths, stacks, secrets, private signing details, or signed redirect query strings.

Catalog, signature, and search objects are strict. Adding, removing, or redefining fields after v2 production release requires a future endpoint/schema version. Unknown security enums or schema versions fail closed and retain the last verified compatible v2 cache.

Because v1 was never released, v2 has no runtime downgrade or migration behavior. `/api/v1` is not a compatibility surface.

## 10. Provider acceptance gates

Automated checks must prove:

1. OpenAPI parses and every local `$ref` resolves;
2. empty and populated catalogs validate;
3. every release is schema-v3 descriptor-bound;
4. category/tag token bounds, uniqueness, order, official-registry policy, and exact descriptor equality;
5. duplicate IDs/slugs/releases and unknown fields reject;
6. every query boundary, category/tag OR semantics, and cross-field AND semantics;
7. compatibility filtering reuses frozen version semantics and does not confuse Core with Editor version;
8. deterministic sorts and pagination edges;
9. ETag 304 has no body;
10. exact catalog/signature bytes verify with a deterministic test Ed25519 key;
11. tampered catalog/signature/hash/key/JAR/descriptor/category/tag fixtures fail closed;
12. production identity encoding and anonymous JAR download are measured after key/catalog provisioning.

Provider fixtures do not constitute production endpoint or JAR evidence.
