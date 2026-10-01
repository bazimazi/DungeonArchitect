import ts from "typescript-parser";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
// One-time migration and repeatable extraction; English remains the initial shipped language.
const messages = new Set();
for (const name of await readdir("src/ui")) {
  if (
    !name.endsWith(".ts") ||
    [
      "localization.ts",
      "i18n.ts",
      "renderer.ts",
      "audio.ts",
      "icons.ts",
    ].includes(name)
  )
    continue;
  const path = `src/ui/${name}`;
  let text = await readFile(path, "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  let hasHtml = text.includes("import { html"),
    hasMsg = /import \{[^}]*msg/.test(text);
  const visit = (node) => {
    if (
      (ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.getText(file).includes("<") &&
      !ts.isTaggedTemplateExpression(node.parent)
    ) {
      edits.push({
        start: node.getStart(file),
        end: node.getStart(file),
        value: "html",
      });
      hasHtml = true;
    }
    if (
      ts.isStringLiteral(node) &&
      node.text.includes("<") &&
      node.text.includes(">") &&
      !ts.isImportDeclaration(node.parent)
    ) {
      edits.push({
        start: node.getStart(file),
        end: node.getEnd(),
        value:
          "html`" +
          node.text.replaceAll("`", "\\`").replaceAll("${", "\\${") +
          "`",
      });
      hasHtml = true;
    }
    if (
      ts.isStringLiteral(node) &&
      /^[A-Z][A-Za-z]/.test(node.text) &&
      /\s/.test(node.text) &&
      !/[<>{}=#]/.test(node.text) &&
      !ts.isLiteralTypeNode(node.parent) &&
      !ts.isImportDeclaration(node.parent) &&
      !(
        ts.isCallExpression(node.parent) &&
        ["msg", "t"].includes(node.parent.expression.getText(file))
      )
    ) {
      edits.push({
        start: node.getStart(file),
        end: node.getEnd(),
        value: `msg(${node.getText(file)})`,
      });
      hasMsg = true;
      messages.add(node.text);
    }
    if (
      (ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      (node.getText(file).includes("<") ||
        ts.isTaggedTemplateExpression(node.parent))
    ) {
      const parts = ts.isTemplateExpression(node)
        ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]
        : [node.text];
      for (const part of parts) {
        for (const match of part.matchAll(/(?:^|>)([^<>]*?)(?=<|$)/g)) {
          const value = match[1].trim();
          if (
            /[A-Za-z]/.test(value) &&
            !/[={}]/.test(value) &&
            value.length > 1
          )
            messages.add(value);
        }
        for (const match of part.matchAll(
          /(?:aria-label|placeholder|title|alt)="([^"]*)"/g,
        ))
          if (match[1]) messages.add(match[1]);
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "msg" &&
      ts.isStringLiteral(node.arguments[0])
    )
      messages.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Nested template/string edits are insertions or disjoint literal replacements.
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  if (edits.length && process.argv.includes("--migrate")) {
    if (
      !text.includes('from "./localization"') &&
      !text.includes("from './localization'")
    )
      text =
        `import { ${[hasHtml ? "html" : "", hasMsg ? "msg" : ""].filter(Boolean).join(", ")} } from './localization';\n` +
        text;
    await writeFile(path, text);
  }
}
await mkdir("src/locales", { recursive: true });
await writeFile(
  "src/locales/en-source.json",
  JSON.stringify(
    Object.fromEntries([...messages].sort().map((s) => [s, s])),
    null,
    2,
  ) + "\n",
);
console.log(`Extracted ${messages.size} source messages.`);
