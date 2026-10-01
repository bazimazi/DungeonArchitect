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
      /^[A-Za-z]/.test(node.text) &&
      !/[<>{}=#]/.test(node.text) &&
      ts.isCallExpression(node.parent) &&
      ((["button", "btn", "option", "number", "iconButton"].includes(
        node.parent.expression.getText(file),
      ) &&
        node.parent.arguments[1] === node) ||
        (["field", "this.message", "this.toast"].includes(
          node.parent.expression.getText(file),
        ) &&
          node.parent.arguments[0] === node))
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
          const value = match[1].trim().replace(/\s+/g, " ");
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
// Include trusted content definitions and server error copy without rewriting their machine identifiers.
for (const path of [
  "src/ui/i18n.ts",
  "src/core/advanced-content.ts",
  "src/core/advanced-types.ts",
  "src/core/templates.ts",
  "src/shared/community.ts",
  "src/shared/economy.ts",
  ...(await readdir("server"))
    .filter((p) => p.endsWith(".ts"))
    .map((p) => `server/${p}`),
]) {
  const source = await readFile(path, "utf8"),
    file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) &&
      /[A-Za-z]/.test(node.text) &&
      !/[<>{}]/.test(node.text)
    ) {
      const property =
        ts.isPropertyAssignment(node.parent) &&
        node.parent.initializer === node;
      const error =
        ts.isNewExpression(node.parent) &&
        node.parent.expression.getText(file) === "ApiError" &&
        node.parent.arguments?.[2] === node;
      if ((property && !path.startsWith("server/")) || error)
        messages.add(node.text.replace(/\s+/g, " "));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
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
