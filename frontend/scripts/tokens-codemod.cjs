// Moves hard-coded colours in the Leads screens onto the tokens (tokens.js C), only where the colour is styling and only when it is
// exactly a token's value, so nothing looks different (plan 10, Phase 4 item 2). It needs Babel, which the app does not ship:
//   mkdir /tmp/cm && cd /tmp/cm && npm i @babel/parser@7.26.3 @babel/traverse@7.26.4 && NODE_PATH=/tmp/cm/node_modules node <repo>/frontend/scripts/tokens-codemod.cjs <repo>/frontend/src [--dirs=plugins/voice,hub] [--write]
// Then lower the folder's hexBaseline.json (tokens.test.js only lets the counts go down).
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const SRC = path.resolve(process.argv[2]);
const WRITE = process.argv.includes("--write");
const tokensSrc = fs.readFileSync(path.join(SRC, "tokens.js"), "utf8");
const hexStart = tokensSrc.indexOf("export const HEX = {");
const setsAt = tokensSrc.indexOf("// Deliberate colour sets", hexStart); // a set's colours belong to that set only, so they're never matched
const hexBlock = tokensSrc.slice(hexStart, setsAt > 0 ? setsAt : tokensSrc.indexOf("};", hexStart));
const PREFER = { "#3457D5": "cobalt", "#F5F6F8": "paper", "#FFFFFF": null }; // white stays: it will need surface / on-accent names
const MAP = {};
for (const m of hexBlock.matchAll(/^\s+([a-zA-Z]+):\s*"(#[0-9A-Fa-f]{6})"/gm)) {
  const hex = m[2].toUpperCase();
  if (hex in PREFER) { if (PREFER[hex]) MAP[hex] = PREFER[hex]; continue; }
  if (!(hex in MAP)) MAP[hex] = m[1];
}
const STYLE_KEYS = new Set(["color", "background", "backgroundColor", "borderColor", "border", "borderTop", "borderBottom", "borderLeft", "borderRight",
  "outline", "outlineColor", "fill", "stroke", "boxShadow", "caretColor", "accentColor", "textDecorationColor", "stopColor", "bg", "fg", "ink", "soft",
  "line", "tint", "borderTopColor", "borderBottomColor", "borderLeftColor", "borderRightColor", "background-color", "dot", "bar", "track", "text"]);
const ATTRS = new Set(["color", "fill", "stroke", "stopColor"]);
// PartnerEmbed previews a partner's own theme; DeveloperCodeSnippets is an always-dark code block.
const SKIP_FILES = new Set(["PartnerEmbed.jsx", "DeveloperCodeSnippets.jsx", "ConnectorLogos.jsx", "EmailDesign.jsx", "EmailWriter.jsx", "MailView.jsx", "InboundForms.jsx", "inboundFormLogic.js",
  "mapPins.js", "drawShape.js", "LeadsMap.jsx",
  "BrandMark.jsx", "apps.js"]); // the logo, and each app's own identity colour
// Folders to work on: --dirs plugins/voice,plugins/scheduler,hub (default: the Leads screens).
const dirsArg = process.argv.find((a) => a.startsWith("--dirs="));
const DIRS = dirsArg ? dirsArg.slice(7).split(",") : ["plugins/leadgen"];
const HEX_RX = /#[0-9A-Fa-f]{6}\b/g;
// A text colour that equals a background token (light text on a dark panel, say) is left alone: in dark mode that token turns dark.
const TEXT_KEYS = new Set(["color", "fill", "stroke", "caretColor", "textDecorationColor", "fg", "ink", "text"]);
const BG_TOKEN = /(Bg|Soft|Light|Cool)$|^(paper|bg|surface|border|line)/;
const CSS_TEXT_RX = /(?:^|[;{\s])(color|fill|stroke|caret-color)\s*:[^;:{}]*$/i;

const keyName = (k) => (k.type === "Identifier" ? k.name : k.type === "StringLiteral" ? k.value : "");
// a colour that is already the fallback of a CSS variable (var(--ui-line, #E3E6EB)) is left as it is
const isFallback = (text, at) => /var\(--[\w-]+,\s*$/.test(text.slice(Math.max(0, at - 60), at));
const mapped = (text) => [...text.matchAll(HEX_RX)].filter((m) => MAP[m[0].toUpperCase()] && !isFallback(text, m.index));
const toTemplate = (raw) => "`" + raw.replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(HEX_RX, (h, at, all) => (MAP[h.toUpperCase()] && !isFallback(all, at) ? "${C." + MAP[h.toUpperCase()] + "}" : h)) + "`";

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(f) && !f.includes(".test.") && !SKIP_FILES.has(f)) out.push(p);
  }
  return out;
}

let total = 0, mismatch = 0;
const report = [];
for (const file of DIRS.flatMap((d) => walk(path.join(SRC, d)))) {
  const code = fs.readFileSync(file, "utf8");
  const charts = /from "recharts"/.test(code); // chart attributes need a real colour (HEX), not a CSS variable
  let ast;
  try {
    ast = parser.parse(code, { sourceType: "module", plugins: ["jsx"] });
  } catch (e) {
    report.push(`${path.relative(SRC, file)}: not parsed (${e.message})`);
    continue;
  }
  const edits = [];
  let ownC = false;
  traverse(ast, {
    VariableDeclarator(p) { if (p.node.id.type === "Identifier" && p.node.id.name === "C") ownC = true; },
    StringLiteral(p) {
      const n = p.node;
      const hits = mapped(n.value);
      if (!hits.length) return;
      const parent = p.parent;
      let styling = false;
      if (parent.type === "ObjectProperty" && parent.value === n) styling = STYLE_KEYS.has(keyName(parent.key));
      if (parent.type === "JSXAttribute") styling = !charts && ATTRS.has(parent.name.name);
      if (parent.type === "ConditionalExpression" || parent.type === "LogicalExpression") {
        const gp = p.parentPath.parent; // a ? "#x" : "#y" inside a style property
        styling = gp.type === "ObjectProperty" && STYLE_KEYS.has(keyName(gp.key));
      }
      if (!styling) return;
      const textKey = parent.type === "JSXAttribute" ? true : TEXT_KEYS.has(keyName((parent.type === "ObjectProperty" ? parent : p.parentPath.parent).key || {}));
      if (textKey && hits.some((m) => BG_TOKEN.test(MAP[m[0].toUpperCase()]))) { mismatch++; return; }
      const whole = n.value.trim().toUpperCase();
      const raw = code.slice(n.start + 1, n.end - 1);
      const rep = MAP[whole] && hits.length === 1 && whole.length === 7 ? `C.${MAP[whole]}` : toTemplate(raw);
      edits.push([n.start, n.end, parent.type === "JSXAttribute" ? `{${rep}}` : rep]);
    },
    TemplateLiteral(p) {
      // page CSS in a template (no HTML in it): each exact colour becomes ${C.x}
      const text = p.node.quasis.map((q) => q.value.raw).join("");
      if (/<[a-z]/i.test(text) || !/[:;{]/.test(text)) return;
      for (const q of p.node.quasis) {
        for (const m of mapped(q.value.raw)) {
          if (CSS_TEXT_RX.test(q.value.raw.slice(0, m.index)) && BG_TOKEN.test(MAP[m[0].toUpperCase()])) { mismatch++; continue; }
          const at = q.start + m.index;
          edits.push([at, at + 7, "${C." + MAP[m[0].toUpperCase()] + "}"]);
        }
      }
    },
  });
  if (!edits.length) continue;
  if (ownC) { report.push(`${path.relative(SRC, file)}: skipped (defines its own C)`); continue; }
  edits.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  // C must be imported from tokens.js
  const rel = path.relative(path.dirname(file), path.join(SRC, "tokens")).replace(/\\/g, "/");
  const spec = rel.startsWith(".") ? rel : "./" + rel;
  const imp = new RegExp(`import \\{([^}]*)\\} from "${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}";`);
  const m = out.match(imp);
  // app/constants.jsx re-exports the same C (with two shadows of its own), so a C imported from either is kept as it is
  const hasC = /import\s*\{[^}]*\bC\b[^}]*\}\s*from\s*"[^"]*(?:\/tokens|\/app\/constants|\.\/constants)"/.test(out);
  if (hasC) {
    // nothing to add
  } else if (m) {
    const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.includes("C")) out = out.replace(m[0], `import { ${["C", ...names].join(", ")} } from "${spec}";`);
  } else {
    const lastImport = [...out.matchAll(/^import [^;]+;\n/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    out = out.slice(0, at) + `import { C } from "${spec}";\n` + out.slice(at);
  }
  try { parser.parse(out, { sourceType: "module", plugins: ["jsx"] }); } catch (e) { report.push(`${path.relative(SRC, file)}: result would not parse, left alone (${e.message})`); continue; }
  total += edits.length;
  report.push(`${path.relative(SRC, file)}: ${edits.length}`);
  if (WRITE) fs.writeFileSync(file, out);
}
console.log(report.join("\n"));
console.log(`total colours moved onto tokens: ${total}; text colours left because they equal a background token: ${mismatch}${WRITE ? "" : " (dry run)"}`);
