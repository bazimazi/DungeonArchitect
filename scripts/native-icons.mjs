import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
} finally {
  await browser.close();
}
