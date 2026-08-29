# Turboism Plugin Directory API v1

Status: **Implementation-ready contract**  
Canonical origin: `https://plugin.turboism.dev`  
Machine-readable contract: [`openapi/plugin-directory-v1.openapi.json`](openapi/plugin-directory-v1.openapi.json)

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** are normative.

## 1. Purpose

API v1 provides:

1. a complete, signed snapshot used as the trust source for plugin installation; and
2. a filtered, sorted, page-based discovery endpoint for the website and external consumers.

The signed snapshot is authoritative. A client MUST NOT install a JAR using only data returned by the dynamic discovery endpoint.

## 2. Scope

### Goals

- Publish official and reviewed third-party Turboism plugins.
- Publish downloadable `.jar` artifacts with immutable identity metadata.
- Support English, Simplified Chinese, and Japanese display metadata.
- Support deterministic search, filtering, sorting, and pagination.
- Support ETag revalidation and offline client caches.
- Bind installation metadata to an Ed25519-signed catalog.

### Non-goals for v1

- Uploading plugin JARs to this website.
- User accounts, ratings, download counts, or recommendations.
- Arbitrary repository federation.
- Dependency resolution by the directory service.
- Silent install or automatic update commands.
- `.tplugin` download assets.

JAR assets are hosted on an approved public release host. The initial approved host is GitHub Releases.

## 3. Endpoints

| Method | Path | Purpose | Trust use |
|---|---|---|---|
| `GET` | `/api/v1/catalog.json` | Complete catalog bytes | Authoritative after signature verification |
| `GET` | `/api/v1/catalog.json.sig` | Detached-signature envelope | Authoritative verifier input |
| `GET` | `/api/v1/plugins` | Filtered and paginated discovery | Display/discovery only |

The existing `/api/plugins` endpoint is legacy and unversioned. Turboism clients MUST NOT consume it.

All v1 endpoints:

- MUST use HTTPS in production;
- MUST be anonymously readable;
- MUST return UTF-8 JSON;
- MUST support `GET` and `HEAD`;
- MUST emit an `ETag` and honor `If-None-Match` with `304 Not Modified`;
- MUST reject unsupported methods rather than mutating state.

## 4. Complete catalog

### 4.1 Request

```http
GET /api/v1/catalog.json HTTP/1.1
Host: plugin.turboism.dev
Accept: application/vnd.turboism.plugin-catalog+json;version=1
Accept-Encoding: identity
```

Clients that verify exact catalog bytes MUST send `Accept-Encoding: identity`. The production endpoint MUST return an identity-encoded body without `Content-Encoding` for that request.

### 4.2 Response

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.turboism.plugin-catalog+json;version=1
Cache-Control: public, max-age=300, stale-while-revalidate=86400
ETag: "<representation-etag>"
```

The response body MUST conform to the OpenAPI `PluginCatalog` schema.

Limits:

- body size: at most 5 MiB;
- plugins: at most 10,000;
- releases per plugin: at most 100;
- all object keys and array order MUST be deterministic in the published bytes.

A catalog publisher MUST increment `catalogVersion` for every semantic catalog change. Rebuilding identical bytes MUST NOT increment it.

Within one catalog:

- plugin `id` values MUST be unique;
- plugin `slug` values MUST be unique;
- each plugin's release `version` values MUST be unique;
- every release artifact URL MUST be immutable;
- SHA-256 values MUST be lowercase hexadecimal;
- `artifact.fileName` MUST end in `.jar`;
- `artifact.mediaType` MUST equal `application/java-archive`;
- `artifact.size` MUST be between 1 byte and 16 MiB inclusive.

### 4.3 Signature envelope

`GET /api/v1/catalog.json.sig` returns `CatalogSignature`:

```json
{
  "format": "turboism.plugin.catalog.signature",
  "schemaVersion": 1,
  "algorithm": "Ed25519",
  "keyId": "turboism-official-v1",
  "catalogSha256": "<lowercase SHA-256 of exact catalog bytes>",
  "signature": "<base64 Ed25519 signature over exact catalog bytes>"
}
```

Verification order is normative:

1. Reject an unknown `format`, `schemaVersion`, `algorithm`, or `keyId`.
2. Compute SHA-256 over the exact identity-encoded catalog body.
3. Compare it with `catalogSha256` in constant time.
4. Verify `signature` over the exact catalog body with the public key identified by `keyId`.
5. Parse the JSON only after steps 1–4 pass.
6. Validate the parsed object against schema v1 and all semantic uniqueness rules.

The production private key MUST NOT be committed to either repository or included in a client. The client embeds only an allowlist of public keys. Key rotation requires an overlap release in which the client trusts both the old and new key IDs before the catalog switches to the new key.

## 5. Catalog model

### 5.1 Plugin

A plugin contains stable identity and publisher metadata plus one or more releases.

Required fields:

- `id`: descriptor plugin ID; 1–128 characters.
- `slug`: website identifier in lowercase kebab-case.
- `name`: default English display name.
- `summary`: default English summary.
- `trust`: `official` or `reviewed-third-party`.
- `author`, `license`, `repository`, `support`.
- `tags`: lowercase kebab-case tags.
- `localizations`: optional `zh-Hans` and `ja` display overrides.
- `releases`: complete retained release records.

`trust=official` means the artifact was published through the Turboism official release process. A signed catalog containing `reviewed-third-party` does not imply that Turboism authored that JAR.

### 5.2 Release

Plugin versions use strict `MAJOR.MINOR.PATCH`; prerelease suffixes are not valid in v1.

Required release fields:

- `version`;
- `channel`: `stable` or `preview`;
- `status`: `active` or `yanked`;
- `publishedAt`;
- `turboismApi`: the existing Turboism v1 grammar: an exact version or bounded half-open interval such as `[0.1.0,0.2.0)`;
- `requiresCubism`;
- `cubismVersions`;
- `platforms`;
- `dependencies`;
- `permissions`;
- `releaseUrl`;
- `artifact`.

Catalog dependency objects use `id`, `version`, `type`, `ordering`, and optional `reason`. The publisher normalizes omitted descriptor defaults to `type=required` and `ordering=none`. Catalog permission objects use `id`, `scope`, and required `reason`; `scope` is `application` or `user`, with omitted descriptor scope normalized to `application`.

When `requiresCubism=true`, `cubismVersions` MUST contain at least one exact reviewed host version. When false, it MUST be empty.

A yanked release remains in the signed catalog so an installed artifact can be identified, but it MUST NOT be offered for a new install or update.

### 5.3 Artifact-to-descriptor binding

For every active release, the catalog publisher MUST verify the downloadable JAR and require:

- JAR SHA-256 equals `artifact.sha256`;
- JAR size equals `artifact.size`;
- exactly one `META-INF/turboism/plugin.json` exists;
- descriptor SHA-256 equals `artifact.descriptorSha256`;
- descriptor `id` equals plugin `id`;
- descriptor `version` equals release `version`;
- descriptor `turboismApi`, permissions, and dependencies agree with the catalog release;
- the JAR passes Turboism's strict plugin JAR inspection policy.

### 5.4 Complete catalog example

```json
{
  "format": "turboism.plugin.catalog",
  "schemaVersion": 1,
  "catalogVersion": 1,
  "publishedAt": "2026-08-10T00:00:00Z",
  "plugins": [
    {
      "id": "dev.turboism.plugin.project-inspector",
      "slug": "project-inspector",
      "name": "Project Inspector",
      "summary": "Inspect the active Cubism project and workspace.",
      "localizations": {
        "zh-Hans": {
          "name": "项目检查器",
          "summary": "查看当前 Cubism 项目和工作区。"
        },
        "ja": {
          "name": "プロジェクトインスペクター",
          "summary": "現在の Cubism プロジェクトとワークスペースを表示します。"
        }
      },
      "trust": "official",
      "author": "Turboism Contributors",
      "license": "Project License",
      "repository": "https://github.com/turboism/Turboism",
      "support": "https://github.com/turboism/Turboism/issues",
      "tags": ["developer-tools", "project"],
      "releases": [
        {
          "version": "0.1.0",
          "channel": "preview",
          "status": "active",
          "publishedAt": "2026-08-10T00:00:00Z",
          "turboismApi": "[0.1.0,0.2.0)",
          "requiresCubism": true,
          "cubismVersions": ["5.3.02"],
          "platforms": ["windows-x64"],
          "dependencies": [],
          "permissions": [
            {
              "id": "turboism.cubism.project.read",
              "scope": "application",
              "reason": "Displays the active project and workspace."
            }
          ],
          "releaseUrl": "https://github.com/turboism/turboism-releases/releases/tag/v0.42.0-preview.1",
          "sourceRevision": "0123456789abcdef0123456789abcdef01234567",
          "artifact": {
            "mediaType": "application/java-archive",
            "fileName": "turboism-plugin-project-inspector-0.1.0.jar",
            "url": "https://github.com/turboism/turboism-releases/releases/download/v0.42.0-preview.1/turboism-plugin-project-inspector-0.1.0.jar",
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

## 6. Discovery endpoint

### 6.1 Request

```http
GET /api/v1/plugins?q=theme&trust=official&tag=ui&channel=preview&turboismApi=0.1.0&cubismVersion=5.3.02&platform=windows-x64&locale=zh-Hans&sort=published-desc&page=1&pageSize=20
```

### 6.2 Query parameters

| Parameter | Cardinality | Default | Constraint |
|---|---:|---|---|
| `q` | one | empty | trimmed string, at most 200 Unicode code points |
| `trust` | repeated | all | `official`, `reviewed-third-party` |
| `tag` | repeated | all | lowercase kebab-case |
| `channel` | repeated | all | `stable`, `preview` |
| `turboismApi` | one | unset | strict `MAJOR.MINOR.PATCH` |
| `cubismVersion` | one | unset | exact host version |
| `platform` | repeated | all | currently `windows-x64` |
| `locale` | one | `en` | `en`, `zh-Hans`, `ja` |
| `sort` | one | `published-desc` | see below |
| `page` | one | `1` | integer 1 or greater |
| `pageSize` | one | `20` | integer from 1 through 100 |

Repeated values within one field are OR conditions. Different fields are AND conditions.

Example:

```text
(trust = official) AND (tag = ui OR tag = theme) AND (channel = stable OR channel = preview)
```

Duplicate repeated values are normalized to one value. Unknown parameters and duplicate scalar parameters MUST return `400 invalid_query`.

### 6.3 Text matching

The server normalizes the query and candidate text with Unicode NFKC followed by locale-independent lowercase conversion. `q` is one literal substring, not a regular expression and not fuzzy search.

It is matched against:

- plugin `id`;
- plugin `slug`;
- the selected locale's name and summary, falling back to English;
- tags.

### 6.4 Release selection and compatibility

A plugin is returned only when it has at least one release that:

1. has `status=active`;
2. matches any supplied `channel` value;
3. contains the supplied `turboismApi` version in its declared range, when supplied;
4. contains the supplied `cubismVersion` when `requiresCubism=true`, when supplied;
5. contains any supplied `platform` value.

The endpoint exposes the highest matching strict semantic version as `latestCompatibleRelease`. When compatibility parameters are absent, this is the highest active release matching channel and platform filters.

Clients MUST reuse Turboism's existing strict version and interval semantics; they MUST NOT invent Maven, npm, or prerelease range rules.

### 6.5 Sort order

Allowed values:

- `published-desc`: release `publishedAt` descending, then plugin `id` ascending;
- `updated-desc`: maximum release `publishedAt` descending, then plugin `id` ascending;
- `name-asc`: normalized display name ascending, then plugin `id` ascending;
- `name-desc`: normalized display name descending, then plugin `id` ascending.

Every order has plugin `id` as the final deterministic tie-breaker.

### 6.6 Pagination

Filtering and sorting occur before pagination.

- Pages are one-based.
- `pageSize` defaults to 20 and is capped at 100.
- `totalPages` is zero when `totalItems` is zero.
- A page beyond `totalPages` returns `200` with `items=[]`; it is not a 404.
- The response repeats the normalized query and the `catalogVersion` used.

Example response:

```json
{
  "format": "turboism.plugin.search",
  "schemaVersion": 1,
  "catalogVersion": 12,
  "query": {
    "q": "theme",
    "trust": ["official"],
    "tags": ["ui"],
    "channels": ["preview"],
    "turboismApi": "0.1.0",
    "cubismVersion": "5.3.02",
    "platforms": ["windows-x64"],
    "locale": "zh-Hans",
    "sort": "published-desc"
  },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0,
    "hasPrevious": false,
    "hasNext": false
  },
  "items": []
}
```

## 7. Dynamic response trust boundary

`/api/v1/plugins` is intentionally not a signed installation authority. It MAY be generated dynamically and cached independently.

Before downloading or installing, a client MUST locate the same plugin ID and release version in a locally verified complete catalog and require exact equality for:

- artifact URL;
- artifact SHA-256;
- descriptor SHA-256;
- artifact size;
- compatibility metadata;
- status.

If equality cannot be established, installation MUST fail closed.

## 8. Errors

Errors use this envelope:

```json
{
  "error": {
    "code": "invalid_query",
    "message": "pageSize must be between 1 and 100",
    "field": "pageSize"
  }
}
```

Required status behavior:

| Status | Code | Meaning |
|---|---|---|
| `400` | `invalid_query` | Query syntax, duplicate scalar, or unsupported parameter is invalid |
| `406` | `not_acceptable` | Requested representation is unsupported |
| `500` | `catalog_invalid` | Deployed catalog failed local validation |
| `503` | `catalog_unavailable` | Catalog cannot be read |

Error responses MUST NOT expose filesystem paths, stack traces, secrets, or private signing details.

## 9. Client-side filtering and pagination

Turboism's built-in repository MUST fetch and verify the complete catalog, then perform its own filtering and pagination over that immutable local snapshot. It does not need to call `/api/v1/plugins` for each keystroke or page change.

Client-only filters include:

- installed;
- not installed;
- update available.

These cannot be server filters because the service has no knowledge of local installation state.

Client defaults:

- compatible active releases only;
- page 1;
- page size 20;
- sort `published-desc`;
- current UI locale;
- current Turboism API, Cubism host version, and platform.

Changing any filter or sort resets the page to 1. If a refreshed catalog makes the current page invalid, the client selects the final valid page or page 1 when no results remain.

## 10. Publication invariants

A catalog publication MUST fail before deployment when any of these holds:

- schema or semantic validation fails;
- an ID, slug, or version is duplicated;
- an active artifact is unavailable anonymously;
- a redirect leaves the approved host set or downgrades HTTPS;
- downloaded size or checksum differs;
- descriptor identity differs;
- a yanked release is selected as current;
- catalog signing fails;
- verification with the committed production public key fails;
- generated discovery results differ from equivalent local filtering fixtures.

Published JARs and catalog versions are immutable. Corrections require a new plugin version or catalog version; assets MUST NOT be overwritten in place.

## 11. Compatibility and evolution

- Catalog and search objects are strict: adding, removing, or redefining a field requires `/api/v2` and a new schema version.
- Clients MUST reject an unknown `schemaVersion` and continue using the last verified compatible cache.
- `catalogVersion` versions catalog content only; it does not version the JSON shape.
- Unknown enum values in security-sensitive fields MUST make the affected release unavailable; they MUST NOT be treated as defaults.
- The full-catalog design remains v1's required client mechanism while the identity-encoded catalog is at most 5 MiB and contains at most 10,000 plugins. Crossing either ceiling requires a separately reviewed signed-index/sharding protocol.

## 12. Provider acceptance checks

An implementation is complete only when automated checks prove:

1. the OpenAPI document parses and all local `$ref` values resolve;
2. an empty catalog and a populated catalog validate;
3. duplicate IDs/slugs/releases are rejected;
4. every query parameter boundary is tested;
5. OR-within-field and AND-across-field behavior is tested;
6. compatibility filtering reuses the frozen interval semantics;
7. all sort orders are deterministic;
8. page 1, final page, empty result, and out-of-range page are tested;
9. ETag returns 304 without a body;
10. catalog and signature bytes verify with a test Ed25519 key;
11. tampered catalog, signature, hash, key ID, JAR, and descriptor fixtures fail closed;
12. the production deployment serves identity-encoded catalog bytes and anonymous JAR downloads.
