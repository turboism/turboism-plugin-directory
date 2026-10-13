import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJarReadmes,
  loadPluginReadmes,
} from "../../lib/catalog-v2/readme.mjs";
import {
  renderSafeReadmeMarkdown,
  sanitizeMarkdownSource,
  resolveLinkHref,
  selectLocalizedReadme,
} from "../../lib/readme-renderer.ts";
import { filterPlugins } from "../../lib/directory-view.mjs";
import { validateCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";

test("extractJarReadmes extracts en, ja, and zh READMEs with SHA-256 from live jar", () => {
  const result = extractJarReadmes("/tmp/vr/history-panel-0.67.0.jar");
  assert.ok(result.en, "en README must exist");
  assert.ok(result.ja, "ja README must exist");
  assert.ok(result.zh, "zh README must exist");

  assert.equal(result.en.fileName, "README.md");
  assert.equal(result.zh.fileName, "README_zh.md");
  assert.equal(result.ja.fileName, "README_ja.md");

  assert.equal(result.en.sha256, "c1ac9a85edc2a461eb438860e0162239c2f7671fa61290e52ed5867703ce9f5e");
  assert.equal(result.zh.sha256, "c7c3f7255addc9b256486f910bb8a0f3b89f55225ca130ab62af7711beb5450c");
  assert.equal(result.ja.sha256, "f31e78adc3c8d39cb9e00c21ac933a3871a3bf399ae888c8b928df1c5368d282");
});

test("sanitizeMarkdownSource strips YAML frontmatter and compatibility comment markers", () => {
  const input = `---
turboismReadmeSchema: 1
pluginId: dev.turboism.plugin.test
status: preview
delivery: store-candidate
---

# Title

<!-- compatibility:begin -->
**Editor support:** 5.0+
<!-- compatibility:end -->

Content here.`;

  const cleaned = sanitizeMarkdownSource(input);
  assert.equal(cleaned.includes("turboismReadmeSchema"), false, "frontmatter must be stripped");
  assert.equal(cleaned.includes("delivery: store-candidate"), false, "frontmatter fields must be stripped");
  assert.equal(cleaned.includes("<!-- compatibility:begin -->"), false, "comment markers must be stripped");
  assert.equal(cleaned.includes("<!-- compatibility:end -->"), false, "comment markers must be stripped");
  assert.equal(cleaned.includes("**Editor support:** 5.0+"), true, "inner text must be preserved");
  assert.equal(cleaned.includes("Content here."), true);
});

test("renderSafeReadmeMarkdown prevents XSS and strips raw HTML", () => {
  const dirty = `
# Dangerous

<script>alert('xss')</script>
<iframe src="https://evil.com"></iframe>
<img src="https://evil.com/img.png" onerror="alert(1)" />
<a href="javascript:alert(1)">Click me</a>
[Bad link](javascript:void(0))
[Good link](https://turboism.dev/docs)
`;

  const rendered = renderSafeReadmeMarkdown(dirty, "https://github.com/turboism/Turboism");
  assert.equal(rendered.includes("<script>"), false, "script tags must not be rendered");
  assert.equal(rendered.includes("<iframe>"), false, "iframe tags must not be rendered");
  assert.equal(rendered.includes("onerror"), false, "onerror must not be rendered");
  assert.equal(rendered.includes("javascript:"), false, "javascript URLs must not be rendered");
  assert.match(rendered, /href="https:\/\/turboism\.dev\/docs"/);
  assert.match(rendered, /rel="noreferrer noopener"/);
});

test("resolveLinkHref resolves relative links against GitHub repo and neutralizes unknown", () => {
  const repo = "https://github.com/turboism/Turboism";
  assert.equal(
    resolveLinkHref("../../compatibility/cubism/plugins.md", repo),
    "https://github.com/turboism/Turboism/blob/main/compatibility/cubism/plugins.md",
  );
  assert.equal(
    resolveLinkHref("./docs/setup.md", repo),
    "https://github.com/turboism/Turboism/blob/main/docs/setup.md",
  );
  assert.equal(resolveLinkHref("javascript:evil()", repo), "#");
  assert.equal(resolveLinkHref("data:text/html,<script>evil()</script>", repo), "#");
  assert.equal(resolveLinkHref("https://github.com/turboism/Turboism", repo), "https://github.com/turboism/Turboism");
  assert.equal(resolveLinkHref("#anchor-tag", repo), "#anchor-tag");
});

test("renderSafeReadmeMarkdown allows images only from approved hosts", () => {
  const input = `
![Approved Raw](https://raw.githubusercontent.com/turboism/Turboism/main/logo.png)
![Approved Turboism](https://turboism.dev/logo.png)
![Disallowed Host](https://attacker.example.com/tracking.png)
![Http Image](http://raw.githubusercontent.com/logo.png)
`;

  const rendered = renderSafeReadmeMarkdown(input);
  assert.match(rendered, /<img src="https:\/\/raw\.githubusercontent\.com\/turboism\/Turboism\/main\/logo\.png"/);
  assert.match(rendered, /<img src="https:\/\/turboism\.dev\/logo\.png"/);
  assert.equal(rendered.includes("attacker.example.com"), false, "unapproved image host must be dropped");
  assert.equal(rendered.includes("http://raw.githubusercontent.com"), false, "insecure http image must be dropped");
});

test("selectLocalizedReadme selects active locale and falls back to English", () => {
  const readmes = {
    en: "# English Documentation",
    zh: "# 中文文档",
    ja: "# 日本語ドキュメント",
  };

  assert.equal(selectLocalizedReadme(readmes, "zh-Hans").content, "# 中文文档");
  assert.equal(selectLocalizedReadme(readmes, "zh-Hant").content, "# 中文文档");
  assert.equal(selectLocalizedReadme(readmes, "zh").content, "# 中文文档");
  assert.equal(selectLocalizedReadme(readmes, "ja").content, "# 日本語ドキュメント");
  assert.equal(selectLocalizedReadme(readmes, "ko").content, "# English Documentation", "ko falls back to en");
  assert.equal(selectLocalizedReadme(readmes, "en").content, "# English Documentation");
  assert.equal(selectLocalizedReadme(readmes, "fr").content, "# English Documentation");
});

test("filterPlugins filters by author, license, category, tag, and search query", () => {
  const samplePlugins = [
    {
      id: "plugin.history",
      slug: "history-panel",
      name: "History Panel",
      summary: "History panel summary",
      trust: "official",
      author: "Turboism Contributors",
      license: "Project License",
      category: "workflow",
      tags: ["history", "navigation"],
      latestVersion: "0.67.0",
      cubismVersions: [],
      localizations: {},
    },
    {
      id: "plugin.mcp",
      slug: "mcp",
      name: "Turboism MCP Server",
      summary: "MCP loopback server",
      trust: "official",
      author: "Turboism Contributors",
      license: "Apache-2.0",
      category: "integration",
      tags: ["mcp", "automation"],
      latestVersion: "0.67.0",
      cubismVersions: ["5.0.00"],
      localizations: {},
    },
    {
      id: "plugin.community",
      slug: "community-tool",
      name: "Community Tool",
      summary: "Third party tool",
      trust: "reviewed-third-party",
      author: "Alice Developer",
      license: "MIT",
      category: "modeling",
      tags: ["mesh", "brush"],
      latestVersion: "1.0.0",
      cubismVersions: [],
      localizations: {},
    },
  ];

  // Filter by author
  const byAuthor = filterPlugins(samplePlugins, "", null, null, "en", "Alice Developer");
  assert.equal(byAuthor.length, 1);
  assert.equal(byAuthor[0].id, "plugin.community");

  // Filter by license
  const byLicense = filterPlugins(samplePlugins, "", null, null, "en", null, "Apache-2.0");
  assert.equal(byLicense.length, 1);
  assert.equal(byLicense[0].id, "plugin.mcp");

  // Filter by category + tag
  const byCatTag = filterPlugins(samplePlugins, "", "navigation", "workflow", "en");
  assert.equal(byCatTag.length, 1);
  assert.equal(byCatTag[0].id, "plugin.history");

  // Filter by query + author
  const byQueryAuthor = filterPlugins(samplePlugins, "server", null, null, "en", "Turboism Contributors");
  assert.equal(byQueryAuthor.length, 1);
  assert.equal(byQueryAuthor[0].id, "plugin.mcp");

  // Disjoint filters return empty
  const noMatch = filterPlugins(samplePlugins, "", null, "workflow", "en", "Alice Developer");
  assert.equal(noMatch.length, 0);
});

test("loadPluginReadmes loads extracted generation 2 readmes from disk", () => {
  const readmes = loadPluginReadmes("dev.turboism.plugin.historypanel", "0.67.0");
  assert.ok(readmes.en, "en README must be present on disk");
  assert.ok(readmes.zh, "zh README must be present on disk");
  assert.ok(readmes.ja, "ja README must be present on disk");
  assert.match(readmes.en, /History Panel Plugin/);
  assert.match(readmes.zh, /历史记录面板插件/);
});

test("catalog validation accepts optional release.hotReload boolean", () => {
  const catalog = {
    format: "turboism.plugin.catalog",
    schemaVersion: 2,
    catalogVersion: 1,
    publishedAt: "2026-08-16T08:48:40Z",
    plugins: [
      {
        id: "dev.turboism.plugin.hotreload",
        slug: "hot-reload",
        name: "Hot Reload Plugin",
        summary: "Supports hot reload.",
        trust: "official",
        author: "Turboism Contributors",
        license: "Project License",
        repository: "https://github.com/turboism/Turboism",
        support: "https://github.com/turboism/Turboism/issues",
        localizations: {},
        releases: [
          {
            version: "0.1.0",
            channel: "preview",
            status: "active",
            publishedAt: "2026-08-16T08:48:40Z",
            category: "workflow",
            tags: ["hot-reload"],
            turboismApi: "[0.1.0,0.2.0)",
            requiresCubism: false,
            cubismVersions: [],
            platforms: ["windows-x64"],
            dependencies: [],
            permissions: [],
            hotReload: true,
            releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugins-0.1.0",
            artifact: {
              mediaType: "application/java-archive",
              fileName: "hot-reload-0.1.0.jar",
              url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugins-0.1.0/hot-reload-0.1.0.jar",
              sha256: "0".repeat(64),
              descriptorSha256: "1".repeat(64),
              size: 1024,
            },
          },
        ],
      },
    ],
  };

  const validated = validateCatalogBytes(Buffer.from(JSON.stringify(catalog), "utf8"));
  assert.ok(validated.ok, JSON.stringify(validated.errors));
  assert.equal(validated.catalog.plugins[0].releases[0].hotReload, true);

  // Non-boolean hotReload is rejected
  catalog.plugins[0].releases[0].hotReload = "yes";
  const bad = validateCatalogBytes(Buffer.from(JSON.stringify(catalog), "utf8"));
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0].message, /boolean/);
});
