// Frame capture for intro.html.
//
// One browser, one page, one screenshot per frame: the page exposes draw(t),
// so frames are produced by calling it and capturing, with no navigation and
// no per-frame process launch. (Launching Chrome per frame is ~2.5s each, and
// parallel launches deadlock on the shared profile.)
//
// Usage: node render.js <sceneHtml> <outDir> <width> <height> <fps> <duration>

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const [scene, outDir, w, h, fps, duration] = process.argv.slice(2);
  const width = Number(w);
  const height = Number(h);
  const frames = Math.round(Number(fps) * Number(duration));

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "shell",
    args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    // Load a frame-pinned URL so the page's own animation loop never starts.
    await page.goto(`file://${path.resolve(scene)}?f=0`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    for (let f = 0; f < frames; f++) {
      await page.evaluate((frame) => window.draw(frame / window.UNWIND_FPS), f);
      await page.screenshot({
        path: path.join(outDir, `f${String(f).padStart(4, "0")}.png`),
        optimizeForSpeed: true,
      });
      if (f % 30 === 0) process.stderr.write(`  ${f}/${frames}\r`);
    }
    process.stderr.write(`  ${frames}/${frames} frames\n`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
