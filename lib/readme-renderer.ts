import { Marked } from "marked";

const ALLOWED_IMAGE_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "turboism.dev",
  "plugin.turboism.dev",
]);

function isAllowedImageHost(hostname: string): boolean {
  if (ALLOWED_IMAGE_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".turboism.dev")) return true;
  return false;
}

/**
 * Pre-processes markdown source by stripping YAML front matter and compatibility markers.
 */
export function sanitizeMarkdownSource(markdown: string): string {
  if (typeof markdown !== "string") return "";
  // Strip YAML front matter: leading `---` followed by lines and ending with `---`
  let cleaned = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Strip compatibility comment markers: <!-- compatibility:begin --> and <!-- compatibility:end -->
  cleaned = cleaned.replace(/<!--\s*compatibility:begin\s*-->/gi, "");
  cleaned = cleaned.replace(/<!--\s*compatibility:end\s*-->/gi, "");
  // Strip any remaining HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  // Strip raw HTML tags to guarantee no raw HTML execution or block swallowing
  cleaned = cleaned.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  return cleaned;
}

/**
 * Resolves a relative link against a repository base URL, or neutralizes it to '#'.
 */
export function resolveLinkHref(href: string, repositoryUrl?: string): string {
  if (!href) return "#";
  const trimmed = href.trim();

  // Allow in-page anchor links
  if (trimmed.startsWith("#")) return trimmed;

  // Neutralize dangerous protocols
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:")
  ) {
    return "#";
  }

  // Absolute HTTPS/HTTP URLs
  if (lower.startsWith("https://") || lower.startsWith("http://")) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return trimmed;
      }
    } catch {
      return "#";
    }
  }

  // Relative link resolution: if repositoryUrl is provided, resolve against GitHub blob/main
  if (repositoryUrl && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(repositoryUrl)) {
    // Strip leading `./` and `../`
    const cleanRelative = trimmed.replace(/^(\.\.\/|\.\/)+/, "");
    const baseRepo = repositoryUrl.replace(/\/+$/, "");
    return `${baseRepo}/blob/main/${cleanRelative}`;
  }

  return "#";
}

/**
 * Creates a marked instance configured for strict safe rendering:
 * - No raw HTML tags
 * - Sanitized links with target="_blank" and rel="noreferrer noopener"
 * - Images only from allowed HTTPS hosts; others dropped
 */
export function createSafeMarkedParser(repositoryUrl?: string) {
  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html() {
        // Suppress all raw HTML tokens
        return "";
      },
      link({ href, text, title }) {
        const safeHref = resolveLinkHref(href, repositoryUrl);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        if (safeHref === "#") {
          return `<a href="#" class="text-blue-600 hover:underline"${titleAttr}>${text}</a>`;
        }
        return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer noopener" class="text-blue-600 hover:underline inline-flex items-center gap-1"${titleAttr}>${text}</a>`;
      },
      image({ href, text, title }) {
        if (!href) return text ? `<span>${escapeHtml(text)}</span>` : "";
        try {
          const parsed = new URL(href);
          if (parsed.protocol === "https:" && isAllowedImageHost(parsed.hostname)) {
            const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
            const altAttr = text ? ` alt="${escapeHtml(text)}"` : ' alt=""';
            return `<img src="${escapeHtml(href)}"${altAttr}${titleAttr} class="max-w-full h-auto rounded-lg my-4" />`;
          }
        } catch {
          // Fall through to drop disallowed image
        }
        return text ? `<span class="italic text-slate-500 text-sm">[Image: ${escapeHtml(text)}]</span>` : "";
      },
    },
  });

  return marked;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Safely renders markdown into sanitized HTML string.
 */
export function renderSafeReadmeMarkdown(markdown: string, repositoryUrl?: string): string {
  const cleaned = sanitizeMarkdownSource(markdown);
  if (!cleaned.trim()) return "";
  const parser = createSafeMarkedParser(repositoryUrl);
  const result = parser.parse(cleaned);
  return typeof result === "string" ? result : "";
}

/**
 * Selects the appropriate README from available localized texts for a given locale,
 * falling back to English.
 */
export function selectLocalizedReadme(
  readmes: Record<string, string>,
  locale: string,
): { content: string; locale: string } {
  if (!readmes) return { content: "", locale: "en" };

  const norm = locale.trim().toLowerCase();
  if (norm.startsWith("zh")) {
    if (readmes.zh) return { content: readmes.zh, locale: "zh" };
  } else if (norm.startsWith("ja")) {
    if (readmes.ja) return { content: readmes.ja, locale: "ja" };
  } else if (norm.startsWith("ko")) {
    if (readmes.ko) return { content: readmes.ko, locale: "ko" };
  }

  // Fallback to English
  if (readmes.en) return { content: readmes.en, locale: "en" };

  // If en is absent, return any available or empty
  const firstKey = Object.keys(readmes)[0];
  if (firstKey) return { content: readmes[firstKey], locale: firstKey };
  return { content: "", locale: "en" };
}
