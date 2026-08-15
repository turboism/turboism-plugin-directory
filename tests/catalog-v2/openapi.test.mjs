import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const specPath = path.join(process.cwd(), "docs", "openapi", "plugin-directory-v2.openapi.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));

test("OpenAPI parses as 3.1 with the v2 title and server", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "Turboism Plugin Directory API");
  assert.equal(spec.info.version, "2.0.0");
  assert.deepEqual(spec.servers, [{ url: "https://plugin.turboism.dev" }]);
});

test("every local $ref resolves", () => {
  const refs = [];
  const walk = (node, where) => {
    if (node === null || typeof node !== "object") return;
    if (typeof node.$ref === "string") {
      refs.push({ ref: node.$ref, where });
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, `${where}.${key}`);
    }
  };
  walk(spec, "spec");
  assert.ok(refs.length > 0, "expected at least one $ref");
  for (const { ref, where } of refs) {
    assert.ok(ref.startsWith("#/components/"), `external ref at ${where}: ${ref}`);
    const target = ref.slice("#/components/".length).split("/").reduce((acc, part) => acc && acc[part], spec.components);
    assert.ok(target !== undefined, `unresolved ref ${ref} at ${where}`);
  }
});

test("v2 endpoints exist with GET and HEAD and no v1 paths", () => {
  for (const p of ["/api/v2/catalog.json", "/api/v2/catalog.json.sig", "/api/v2/plugins"]) {
    assert.ok(spec.paths[p], `missing path ${p}`);
    assert.ok(spec.paths[p].get, `missing GET ${p}`);
    assert.ok(spec.paths[p].head, `missing HEAD ${p}`);
  }
  assert.ok(!spec.paths["/api/v1/plugins"], "v1 path must not exist");
});

test("media types are the exact v2 vendor types", () => {
  const catalog200 = spec.paths["/api/v2/catalog.json"].get.responses["200"].content;
  assert.ok(catalog200["application/vnd.turboism.plugin-catalog+json;version=2"]);
  assert.ok(catalog200["application/json"]);
  const sig200 = spec.paths["/api/v2/catalog.json.sig"].get.responses["200"].content;
  assert.ok(sig200["application/vnd.turboism.plugin-catalog-signature+json;version=2"]);
  const search200 = spec.paths["/api/v2/plugins"].get.responses["200"].content;
  assert.ok(search200["application/vnd.turboism.plugin-search+json;version=2"]);
});

test("error envelope codes match the contract", () => {
  const error = spec.components.schemas.Error;
  assert.deepEqual(error.properties.code.enum, ["invalid_query", "not_acceptable", "catalog_invalid", "catalog_unavailable"]);
  assert.deepEqual(Object.keys(error.properties), ["code", "message", "field"]);
  assert.equal(error.additionalProperties, false);
});

test("strict objects forbid additional properties", () => {
  for (const name of ["PluginCatalog", "Plugin", "PluginRelease", "Artifact", "PluginDependency", "PluginPermission", "LocalizedMetadata", "Localizations", "CatalogSignature", "SearchResponse", "NormalizedQuery", "Pagination", "SearchItem", "Error", "ErrorEnvelope"]) {
    assert.equal(spec.components.schemas[name].additionalProperties, false, `${name} must be strict`);
  }
});

test("release classification is release-owned: no top-level category/tags on Plugin", () => {
  const plugin = spec.components.schemas.Plugin;
  assert.ok(!("category" in plugin.properties));
  assert.ok(!("tags" in plugin.properties));
  const release = spec.components.schemas.PluginRelease;
  assert.ok("category" in release.properties);
  assert.ok("tags" in release.properties);
  assert.equal(release.properties.tags.maxItems, 12);
  assert.equal(release.properties.tags.uniqueItems, true);
});

test("limits in the OpenAPI match the implementation", () => {
  assert.equal(spec.components.schemas.PluginCatalog.properties.plugins.maxItems, 10000);
  assert.equal(spec.components.schemas.Plugin.properties.releases.maxItems, 100);
  assert.equal(spec.components.schemas.Artifact.properties.size.maximum, 16777216);
  assert.equal(spec.components.schemas.SearchResponse.properties.items.maxItems, 100);
  assert.equal(spec.components.schemas.Pagination.properties.pageSize.maximum, 100);
  assert.equal(spec.components.schemas.NormalizedQuery.properties.q.maxLength, 200);
});
