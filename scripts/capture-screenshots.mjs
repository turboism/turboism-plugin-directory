import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || "/opt/dev/projects/turboism.dev/chat/node_modules/playwright";
const { chromium } = require(playwrightPath);

const BASE_URL = process.env.SITE_ORIGIN || "http://127.0.0.1:3333";
const OUT_DIR = path.resolve("artifacts/screenshots");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });

  try {
    // 1. History panel detail page in EN
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1080 },
      });
      await context.addCookies([
        { name: "turboism-language", value: "en", domain: "127.0.0.1", path: "/" },
      ]);
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/plugins/history-panel`, { waitUntil: "networkidle" });
      await page.waitForSelector("h1");
      const outPath = path.join(OUT_DIR, "history-panel-en.png");
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`Saved screenshot: ${outPath}`);
      await context.close();
    }

    // 2. History panel detail page in ZH
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1080 },
      });
      await context.addCookies([
        { name: "turboism-language", value: "zh", domain: "127.0.0.1", path: "/" },
      ]);
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/plugins/history-panel`, { waitUntil: "networkidle" });
      await page.waitForSelector("h1");
      // Ensure Chinese locale button or language is selected
      const zhBtn = page.locator('button[lang="zh-CN"]').first();
      if (await zhBtn.isVisible()) {
        await zhBtn.click();
        await page.waitForTimeout(500);
      }
      const outPath = path.join(OUT_DIR, "history-panel-zh.png");
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`Saved screenshot: ${outPath}`);
      await context.close();
    }

    // 3. Directory list page with tag filter active
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1080 },
      });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/plugins?tag=history`, { waitUntil: "networkidle" });
      await page.waitForSelector('article, [aria-label="Active filters:"]');
      const outPath = path.join(OUT_DIR, "directory-tag-filter.png");
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`Saved screenshot: ${outPath}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
