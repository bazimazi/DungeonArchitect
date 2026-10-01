import { chromium } from "@playwright/test";
import { readFile, readdir, copyFile } from "node:fs/promises";
const svg = await readFile(
  new URL("../public/icon.svg", import.meta.url),
  "utf8",
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><head><style>html,body{margin:0;background:#18241c;width:100%;height:100%}svg{width:100%;height:100%}</style></head><body>${svg}</body></html>`,
  );
  await page.screenshot({
    path: "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  });
  for (const [density, size] of [
    ["mdpi", 48],
    ["hdpi", 72],
    ["xhdpi", 96],
    ["xxhdpi", 144],
    ["xxxhdpi", 192],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    for (const name of [
      "ic_launcher",
      "ic_launcher_round",
      "ic_launcher_foreground",
    ])
      await page.screenshot({
        path: `android/app/src/main/res/mipmap-${density}/${name}.png`,
      });
  }
  await page.setViewportSize({ width: 2732, height: 2732 });
  await page.setContent(
    `<html><head><style>html,body{margin:0;width:100%;height:100%;background:#111a18}body{display:grid;place-content:center;text-align:center;color:#dfba79}svg{width:440px;height:440px;margin:auto}h1{font:80px Georgia;margin:48px 0 24px}p{font:24px sans-serif;letter-spacing:12px}</style></head><body>${svg}<h1>Dungeon Architect</h1><p>BUILD · PLAY · DISCOVER</p></body></html>`,
  );
  const splash =
    "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png";
  await page.screenshot({ path: splash });
  for (const variant of ["splash-2732x2732-1.png", "splash-2732x2732-2.png"])
    await copyFile(
      splash,
      `ios/App/App/Assets.xcassets/Splash.imageset/${variant}`,
    );
  for (const entry of await readdir("android/app/src/main/res", {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && entry.name.startsWith("drawable")) {
      const path = `android/app/src/main/res/${entry.name}`;
      if ((await readdir(path)).includes("splash.png"))
        await copyFile(splash, `${path}/splash.png`);
    }
  }
} finally {
  await browser.close();
}
