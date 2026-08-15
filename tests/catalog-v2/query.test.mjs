import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, runSearch, stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";
import { makeCatalog, makePlugin, makeRelease } from "./fixtures.mjs";

// Shared fixture catalog: 8 plugins (one yanked-only, never in results).
function fixtureCatalog() {
  const plugins = [
    makePlugin({
      id: "dev.turboism.plugin.project-inspector",
      slug: "project-inspector",
      name: "Project Inspector",
      summary: "Inspect the active Cubism project and workspace.",
      releases: [
        makeRelease({ version: "0.1.0", publishedAt: "2026-08-15T00:00:00Z" }),
        makeRelease({ version: "0.2.0", publishedAt: "2026-08-20T00:00:00Z" }),
      ],
    }),
    makePlugin({
      id: "dev.turboism.plugin.rig-poser",
      slug: "rig-poser",
      name: "Rig Poser",
      summary: "Pose rigs with saved poses.",
      category: "workflow",
      tags: ["rigging", "posing"],
      releases: [
        makeRelease({ version: "1.0.0", channel: "stable", publishedAt: "2026-08-10T00:00:00Z", category: "workflow", tags: ["rigging", "posing"], turboismApi: "0.1.0", requiresCubism: false, cubismVersions: [] }),
      ],
    }),
    makePlugin({
      id: "dev.turboism.plugin.mat-painter",
      slug: "mat-painter",
      name: "Material Painter",
      summary: "Paint materials on models.",
      category: "appearance",
      tags: ["material", "painting"],
      releases: [
        makeRelease({ version: "0.3.0", publishedAt: "2026-07-01T00:00:00Z", category: "appearance", tags: ["material"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.1.0,0.3.0)" }),
        makeRelease({ version: "0.4.0", status: "yanked", publishedAt: "2026-08-01T00:00:00Z", category: "appearance", tags: ["material", "painting"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.1.0,0.3.0)" }),
        makeRelease({ version: "0.5.0", channel: "stable", publishedAt: "2026-08-18T00:00:00Z", category: "appearance", tags: ["material", "painting"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.1.0,0.3.0)" }),
        makeRelease({ version: "0.6.0", status: "yanked", publishedAt: "2026-08-25T00:00:00Z", category: "appearance", tags: ["material", "painting"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.1.0,0.3.0)" }),
      ],
    }),
    makePlugin({
      id: "dev.acme.plugin.palette-helper",
      slug: "palette-helper",
      name: "Palette Helper",
      summary: "Organize color palettes.",
      trust: "reviewed-third-party",
      author: "Acme Studio",
      category: "rendering",
      tags: ["color", "palette"],
      releases: [
        makeRelease({ version: "0.1.0", channel: "stable", publishedAt: "2026-08-12T00:00:00Z", category: "rendering", tags: ["color", "palette"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.2.0,0.4.0)" }),
      ],
    }),
    makePlugin({
      id: "dev.third.plugin.mocap-suite",
      slug: "mocap-suite",
      name: "Mocap Suite",
      summary: "Record motion data.",
      trust: "reviewed-third-party",
      category: "analysis",
      tags: ["motion", "capture"],
      releases: [
        makeRelease({ version: "1.0.0", channel: "stable", publishedAt: "2026-08-11T00:00:00Z", category: "analysis", tags: ["motion", "capture"], requiresCubism: false, cubismVersions: [] }),
        makeRelease({ version: "2.0.0", channel: "stable", publishedAt: "2026-08-21T00:00:00Z", category: "analysis", tags: ["motion"], requiresCubism: false, cubismVersions: [] }),
      ],
    }),
    makePlugin({
      id: "dev.turboism.plugin.auto-lipsync",
      slug: "auto-lipsync",
      name: "Auto Lipsync",
      summary: "Generate lipsync from audio.",
      category: "analysis",
      tags: ["lipsync", "audio"],
      localizations: { "zh-Hans": { name: "自动口型同步", summary: "从音频生成口型动画。" }, ja: { name: "自動リップシンク", summary: "音声からリップシンクを生成します。" } },
      releases: [
        makeRelease({ version: "0.1.0", publishedAt: "2026-08-05T00:00:00Z", category: "analysis", tags: ["lipsync", "audio"], requiresCubism: false, cubismVersions: [] }),
      ],
    }),
    makePlugin({
      id: "dev.third.plugin.light-studio",
      slug: "light-studio",
      name: "Light Studio",
      summary: "Stage lighting setups.",
      trust: "reviewed-third-party",
      category: "rendering",
      tags: ["lighting", "studio"],
      releases: [
        makeRelease({ version: "0.2.0", channel: "stable", publishedAt: "2026-08-10T00:00:00Z", category: "rendering", tags: ["lighting", "studio"], requiresCubism: false, cubismVersions: [], turboismApi: "[0.2.0,0.4.0)" }),
      ],
    }),
    // Yanked-only plugin: never offered.
    makePlugin({
      id: "dev.third.plugin.legacy-tool",
      slug: "legacy-tool",
      name: "Legacy Tool",
      summary: "Deprecated.",
      trust: "reviewed-third-party",
      category: "integration",
      tags: ["legacy"],
      releases: [
        makeRelease({ version: "0.9.0", channel: "stable", status: "yanked", publishedAt: "2026-08-01T00:00:00Z", category: "integration", tags: ["legacy"] }),
      ],
    }),
  ];
  return makeCatalog({ plugins });
}

const catalog = fixtureCatalog();
const catalogVersion = catalog.catalogVersion;

const search = (queryString) => runSearch(catalog, parseQuery(new URLSearchParams(queryString)).query);
const ids = (queryString) => search(queryString).items.map((item) => item.id);
const searchOf = (queryString) => search(queryString);

test("defaults: page 1, pageSize 20, en, published-desc, empty filters", () => {
  const result = searchOf("");
  assert.equal(result.format, "turboism.plugin.search");
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.catalogVersion, catalogVersion);
  assert.deepEqual(result.query, { q: "", trust: [], categories: [], tags: [], channels: [], platforms: [], locale: "en", sort: "published-desc" });
  assert.deepEqual(result.pagination, { page: 1, pageSize: 20, totalItems: 7, totalPages: 1, hasPrevious: false, hasNext: false });
});

test("unknown parameters return 400 invalid_query", () => {
  const parsed = parseQuery(new URLSearchParams("extra=1"));
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.code, "invalid_query");
  assert.equal(parsed.error.field, "extra");
});

test("duplicate scalar parameters return 400 even with equal values", () => {
  for (const query of ["q=a&q=a", "sort=name-asc&sort=name-asc", "page=1&page=1", "locale=en&locale=en", "turboismApi=0.1.0&turboismApi=0.1.0"]) {
    const parsed = parseQuery(new URLSearchParams(query));
    assert.ok(!parsed.ok, `expected rejection for ${query}`);
    assert.equal(parsed.error.message, "duplicate scalar parameter");
  }
});

test("repeated parameters normalize duplicates and are OR within a field", () => {
  const dedup = parseQuery(new URLSearchParams("category=analysis&category=analysis"));
  assert.ok(dedup.ok);
  assert.deepEqual(dedup.query.categories, ["analysis"]);
  const or = searchOf("category=analysis&category=rendering").items.map((item) => item.slug).sort();
  assert.deepEqual(or, ["auto-lipsync", "light-studio", "mocap-suite", "palette-helper"]);
});

test("cross-field filters are AND", () => {
  // tag=motion AND channel=stable: only mocap-suite (2.0.0 stable).
  assert.deepEqual(ids("tag=motion&channel=stable"), ["dev.third.plugin.mocap-suite"]);
  // category=analysis AND tag=audio: only auto-lipsync.
  assert.deepEqual(ids("category=analysis&tag=audio"), ["dev.turboism.plugin.auto-lipsync"]);
  // category=analysis AND channel=preview: auto-lipsync only (mocap-suite is stable).
  assert.deepEqual(ids("category=analysis&channel=preview"), ["dev.turboism.plugin.auto-lipsync"]);
});

test("trust filter", () => {
  assert.deepEqual(ids("trust=reviewed-third-party"), ["dev.third.plugin.mocap-suite", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio"]);
  assert.deepEqual(ids("trust=official"), ["dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
});

test("channel filter selects the highest matching release", () => {
  const stable = searchOf("channel=stable");
  assert.deepEqual(stable.items.map((item) => item.slug).sort(), ["light-studio", "mat-painter", "mocap-suite", "palette-helper", "rig-poser"]);
  const matPainter = stable.items.find((item) => item.slug === "mat-painter");
  assert.equal(matPainter.latestCompatibleRelease.version, "0.5.0");
  const preview = searchOf("channel=preview");
  assert.deepEqual(preview.items.map((item) => item.slug).sort(), ["auto-lipsync", "mat-painter", "project-inspector"]);
  const previewMatPainter = preview.items.find((item) => item.slug === "mat-painter");
  assert.equal(previewMatPainter.latestCompatibleRelease.version, "0.3.0");
});

test("category filter is release-owned and selects the highest matching release", () => {
  const result = searchOf("category=appearance");
  assert.deepEqual(result.items.map((item) => item.slug), ["mat-painter"]);
  assert.equal(result.items[0].latestCompatibleRelease.category, "appearance");
});

test("tag filter uses release tags", () => {
  assert.deepEqual(ids("tag=material"), ["dev.turboism.plugin.mat-painter"]);
  assert.deepEqual(ids("tag=motion"), ["dev.third.plugin.mocap-suite"]);
});

test("turboismApi range filter (exact and half-open)", () => {
  assert.deepEqual(ids("turboismApi=0.1.5"), ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.turboism.plugin.auto-lipsync"]);
  assert.deepEqual(ids("turboismApi=0.1.0"), ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
  assert.deepEqual(ids("turboismApi=0.2.0"), ["dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio"]);
  const parsed = parseQuery(new URLSearchParams("turboismApi=[0.1.0,0.2.0)"));
  assert.ok(!parsed.ok);
});

test("cubismVersion matches only Cubism-bound releases that list the exact Editor release", () => {
  assert.deepEqual(ids("cubismVersion=5.3.02"), ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
  // A different Editor release excludes the Cubism-bound plugin but not the rest.
  assert.deepEqual(ids("cubismVersion=6.0.00"), ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
});

test("q normalization: trim, NFKC, lowercase, Unicode", () => {
  assert.deepEqual(ids("q=  project  "), ["dev.turboism.plugin.project-inspector"]);
  assert.deepEqual(ids("q=%EF%BC%B0ROJECT"), ["dev.turboism.plugin.project-inspector"]); // full-width Ｐ
  assert.deepEqual(ids("q=%E3%83%AA%E3%83%83%E3%83%97&locale=ja"), ["dev.turboism.plugin.auto-lipsync"]); // リップ
  assert.deepEqual(ids("q=%E8%87%AA%E5%8A%A8&locale=zh-Hans"), ["dev.turboism.plugin.auto-lipsync"]); // 自动
});

test("q over 200 Unicode code points returns 400", () => {
  const parsed = parseQuery(new URLSearchParams(`q=${"あ".repeat(201)}`));
  assert.ok(!parsed.ok);
  assert.equal(parsed.error.field, "q");
});

test("q matching only release classification selects the release that contains the match", () => {
  // "capture" appears only in the 1.0.0 release tags; the plugin identity does
  // not contain it, so the selected release must be 1.0.0, not the newer 2.0.0.
  const result = searchOf("q=capture");
  assert.deepEqual(result.items.map((item) => item.slug), ["mocap-suite"]);
  assert.equal(result.items[0].latestCompatibleRelease.version, "1.0.0");
  assert.ok(result.items[0].latestCompatibleRelease.tags.includes("capture"));
});

test("q matching a category token selects the matching release", () => {
  // "rendering" appears only as a release category.
  const result = searchOf("q=rendering");
  assert.deepEqual(result.items.map((item) => item.slug).sort(), ["light-studio", "palette-helper"]);
  for (const item of result.items) {
    assert.equal(item.latestCompatibleRelease.category, "rendering");
  }
});

test("q with another filter is AND", () => {
  assert.deepEqual(ids("q=project&trust=reviewed-third-party"), []);
});

test("invalid values return 400 with the offending field", () => {
  for (const [query, field] of [
    ["trust=community", "trust"],
    ["channel=beta", "channel"],
    ["platform=macos-arm64", "platform"],
    ["category=UPPER", "category"],
    ["tag=a", "tag"],
    ["locale=fr", "locale"],
    ["sort=random", "sort"],
    ["page=0", "page"],
    ["page=-1", "page"],
    ["page=1.5", "page"],
    ["page=007", "page"],
    ["page=9007199254740992", "page"],
    ["pageSize=007", "pageSize"],
    ["pageSize=0", "pageSize"],
    ["pageSize=101", "pageSize"],
    ["cubismVersion=5.3", "cubismVersion"],
    ["turboismApi=1.0", "turboismApi"],
  ]) {
    const parsed = parseQuery(new URLSearchParams(query));
    assert.ok(!parsed.ok, `expected rejection for ${query}`);
    assert.equal(parsed.error.field, field, `field for ${query}`);
  }
});

test("locale changes display fields and falls back to English", () => {
  const ja = searchOf("q=lipsync&locale=ja");
  assert.equal(ja.items[0].displayName, "自動リップシンク");
  const zh = searchOf("q=lipsync&locale=zh-Hans");
  assert.equal(zh.items[0].displayName, "自动口型同步");
  const en = searchOf("q=lipsync");
  assert.equal(en.items[0].displayName, "Auto Lipsync");
});

test("sort: published-desc uses the selected release date with id tie-break", () => {
  assert.deepEqual(ids(""), ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
  // light-studio and rig-poser share 2026-08-10; id ascending puts dev.third before dev.turboism.
  assert.ok(ids("").indexOf("dev.third.plugin.light-studio") < ids("").indexOf("dev.turboism.plugin.rig-poser"));
});

test("sort: updated-desc uses the most recent MATCHING candidate release", () => {
  const updated = ids("sort=updated-desc");
  // mat-painter's yanked 0.6.0 (08-25) never counts; its newest matching
  // candidate is 0.5.0 (08-18), so mocap-suite (2.0.0, 08-21) sorts first.
  assert.deepEqual(updated, ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.project-inspector", "dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio", "dev.turboism.plugin.rig-poser", "dev.turboism.plugin.auto-lipsync"]);
  // With channel=stable, mat-painter's candidate is 0.5.0 and preview-only
  // plugins drop out entirely.
  const stable = ids("sort=updated-desc&channel=stable");
  assert.deepEqual(stable, ["dev.third.plugin.mocap-suite", "dev.turboism.plugin.mat-painter", "dev.acme.plugin.palette-helper", "dev.third.plugin.light-studio", "dev.turboism.plugin.rig-poser"]);
});

test("sort: name-asc and name-desc with locale display names", () => {
  const asc = searchOf("sort=name-asc").items.map((item) => item.slug);
  assert.deepEqual(asc, ["auto-lipsync", "light-studio", "mat-painter", "mocap-suite", "palette-helper", "project-inspector", "rig-poser"]);
  const desc = searchOf("sort=name-desc").items.map((item) => item.slug);
  assert.deepEqual(desc, [...asc].reverse());
});

test("pagination edges", () => {
  const page1 = searchOf("pageSize=2&page=1");
  assert.equal(page1.items.length, 2);
  assert.deepEqual(page1.pagination, { page: 1, pageSize: 2, totalItems: 7, totalPages: 4, hasPrevious: false, hasNext: true });
  const page2 = searchOf("pageSize=2&page=2");
  assert.deepEqual(page2.items.map((item) => item.slug), ["mat-painter", "palette-helper"]);
  const beyond = searchOf("pageSize=2&page=5");
  assert.equal(beyond.items.length, 0);
  assert.deepEqual(beyond.pagination, { page: 5, pageSize: 2, totalItems: 7, totalPages: 4, hasPrevious: true, hasNext: false });
});

test("zero results have totalPages=0 and items=[]", () => {
  const none = searchOf("q=zzzznotfound");
  assert.deepEqual(none.pagination, { page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasPrevious: false, hasNext: false });
  assert.deepEqual(none.items, []);
});

test("yanked releases are never selected", () => {
  const result = searchOf("category=integration");
  assert.deepEqual(result.items, []);
  const matPainter = searchOf("").items.find((item) => item.slug === "mat-painter");
  assert.notEqual(matPainter.latestCompatibleRelease.status, "yanked");
  assert.equal(matPainter.latestCompatibleRelease.version, "0.5.0");
});

test("releases with empty tags are valid, selectable, and never match q through tags", () => {
  const emptyTagsCatalog = makeCatalog({
    plugins: [
      makePlugin({ releases: [makeRelease({ tags: [], requiresCubism: false, cubismVersions: [] })] }),
      makePlugin({ id: "dev.acme.plugin.palette-helper", slug: "palette-helper", name: "Palette Helper", summary: "Organize color palettes.", trust: "reviewed-third-party", author: "Acme Studio", releases: [makeRelease({ tags: ["color"], category: "rendering", requiresCubism: false, cubismVersions: [] })] }),
    ],
  });
  const all = runSearch(emptyTagsCatalog, parseQuery(new URLSearchParams("")).query);
  assert.equal(all.items.length, 2);
  const noTag = all.items.find((item) => item.slug === "project-inspector");
  assert.deepEqual(noTag.latestCompatibleRelease.tags, []);
  // q=color matches only the tagged release; the empty-tags plugin matches
  // through its plugin identity fields for its own name.
  assert.deepEqual(runSearch(emptyTagsCatalog, parseQuery(new URLSearchParams("q=color")).query).items.map((item) => item.slug).sort(), ["palette-helper"]);
  assert.deepEqual(runSearch(emptyTagsCatalog, parseQuery(new URLSearchParams("q=project")).query).items.map((item) => item.slug), ["project-inspector"]);
});

test("search items carry category/tags only inside latestCompatibleRelease", () => {
  const item = searchOf("q=material").items[0];
  assert.ok(!("category" in item));
  assert.ok(!("tags" in item));
  assert.ok(Array.isArray(item.latestCompatibleRelease.tags));
  assert.equal(item.latestCompatibleRelease.category, "appearance");
});

test("search response is deterministic across runs", () => {
  const first = stringifyCanonical(searchOf("q=%E3%83%AA&locale=ja&sort=name-desc&pageSize=3"), "search");
  const second = stringifyCanonical(searchOf("q=%E3%83%AA&locale=ja&sort=name-desc&pageSize=3"), "search");
  assert.equal(first, second);
});

test("search response uses canonical key order", () => {
  const body = JSON.parse(stringifyCanonical(searchOf("pageSize=1"), "search"));
  assert.deepEqual(Object.keys(body), ["format", "schemaVersion", "catalogVersion", "query", "pagination", "items"]);
  assert.deepEqual(Object.keys(body.query), ["q", "trust", "categories", "tags", "channels", "platforms", "locale", "sort"]);
  assert.deepEqual(Object.keys(body.items[0]), ["id", "slug", "displayName", "displaySummary", "trust", "author", "license", "repository", "support", "latestCompatibleRelease"]);
});
