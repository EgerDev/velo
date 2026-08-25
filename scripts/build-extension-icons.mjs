import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const SIZES = [16, 32, 48, 128];
const iconsDir = path.resolve("extension/icons");

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const svgContent = fs.readFileSync(path.join(iconsDir, "icon.svg"), "utf-8");

async function generateIcons() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const size of SIZES) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
          svg { width: 100%; height: 100%; display: block; }
        </style>
      </head>
      <body>
        ${svgContent}
      </body>
      </html>
    `;
    await page.setContent(html);
    await page.setViewportSize({ width: size, height: size });
    const outPath = path.join(iconsDir, `icon${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: true });
    console.log(`Generated ${outPath}`);
  }

  await browser.close();
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
