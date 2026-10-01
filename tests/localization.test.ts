import { afterEach, expect, it } from "vitest";
import {
  html,
  msg,
  registerTranslations,
  setLocale,
} from "../src/ui/localization";
afterEach(() => setLocale("en"));
it("translates static menus and reordered placeholders while preserving player text and escaping markup", () => {
  registerTranslations("fa", {
    "Enter dungeon": "ورود به سیاهچال",
    "Hello {name}": "{name}، سلام",
    Gold: "<b>طلا</b>",
  });
  setLocale("fa");
  expect(msg("Hello {name}", { name: "Mira" })).toBe("Mira، سلام");
  expect(
    html`<button>Enter dungeon</button>
      <p>${"Enter dungeon"}</p>
      <span>Gold</span>`.replace(/>\s+</g, "><"),
  ).toBe(
    "<button>ورود به سیاهچال</button><p>Enter dungeon</p><span>&lt;b&gt;طلا&lt;/b&gt;</span>",
  );
});
