export const SUPPORTED_LOCALES = [
  "en",
  "fa",
  "ar",
  "es",
  "pt",
  "de",
  "fr",
  "ja",
  "ko",
  "zh",
] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
let locale: Locale = "en";
const packages = new Map<Locale, Readonly<Record<string, string>>>();
export function registerTranslations(
  language: Locale,
  messages: Record<string, string>,
): void {
  packages.set(language, Object.freeze({ ...messages }));
}
export function setLocale(language: Locale): void {
  if (!SUPPORTED_LOCALES.includes(language))
    throw new Error("Unsupported language");
  locale = language;
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
    document.documentElement.dir =
      language === "fa" || language === "ar" ? "rtl" : "ltr";
  }
}
export function getLocale(): Locale {
  return locale;
}
/** Source messages are gettext-style keys; named placeholders allow languages to reorder values. */
export function msg(
  source: string,
  values: Record<string, string | number> = {},
): string {
  return (packages.get(locale)?.[source] ?? source).replace(
    /\{(\w+)\}/g,
    (match, key: string) => String(values[key] ?? match),
  );
}
export function translatedKey(key: string, fallback: string): string {
  return packages.get(locale)?.[key] ?? msg(fallback);
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function staticText(source: string): string {
  const clean = source.trim();
  if (!clean || !/[A-Za-z]/.test(clean) || /[={}]/.test(clean)) return source;
  const normalized = clean.replace(/\s+/g, " ");
  const result = msg(normalized);
  return result === normalized ? source : source.replace(clean, escape(result));
}
/** Only static template segments are translated. Interpolated player content is preserved. */
export function html(
  parts: TemplateStringsArray,
  ...values: unknown[]
): string {
  return parts
    .map(
      (part, index) =>
        part
          .replace(
            /(^|>)([^<>]*?)(?=<|$)/g,
            (_match, start: string, text: string) => start + staticText(text),
          )
          .replace(
            /\b(aria-label|placeholder|title|alt)="([^"]*)"/g,
            (_match, name: string, text: string) =>
              `${name}="${staticText(text)}"`,
          ) + (index < values.length ? String(values[index]) : ""),
    )
    .join("");
}
