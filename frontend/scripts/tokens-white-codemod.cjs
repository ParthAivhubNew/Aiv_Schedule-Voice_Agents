/* global process, console */
// Moves white in the Leads screens onto tokens by what it does, so dark mode can change one and not the other (plan 10, Phase 4):
//   C.surface   a background, a border or a ring (cards, panels, tables, inputs)   -> --ui-surface
//   C.onAccent  text, an icon's fill or stroke on a coloured fill                  -> --c-on-accent
// Both are white today, so nothing looks different. A white whose job can't be told from where it is written is left alone, and so are
// the files where a colour is data or leaves the app (the same list as tokens-codemod.cjs).
//   mkdir /tmp/cm && cd /tmp/cm && npm i @babel/parser@7.26.3 @babel/traverse@7.26.4 && NODE_PATH=/tmp/cm/node_modules node <repo>/frontend/scripts/tokens-white-codemod.cjs <repo>/frontend/src [--write]
// Then lower plugins/leadgen/hexBaseline.json (tokens.test.js only lets the counts go down).
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const SRC = path.resolve(process.argv[2]);
const WRITE = process.argv.includes("--write");
const SKIP_FILES = new Set(["ConnectorLogos.jsx", "EmailDesign.jsx", "EmailWriter.jsx", "MailView.jsx", "InboundForms.jsx", "inboundFormLogic.js",
  "mapPins.js", "drawShape.js", "LeadsMap.jsx"]);
const TEXT_KEYS = new Set(["color", "fill", "stroke", "caretColor", "textDecorationColor", "fg", "ink", "text"]);
const SURFACE_KEYS = new Set(["background", "backgroundColor", "bg", "border", "borderColor", "borderTop", "borderBottom", "borderLeft", "borderRight",
  "borderTopColor", "borderBottomColor", "borderLeftColor", "borderRightColor", "outline", "outlineColor", "boxShadow", "soft", "tint", "track"]);
const ATTR_TEXT = new Set(["color", "fill", "stroke"]);
const CSS_TEXT = new Set(["color", "fill", "stroke", "caret-color"]);
const CSS_SURFACE = /^(background|background-color|border|border-(top|bottom|left|right)|border(-(top|bottom|left|right))?-color|outline|outline-color|box-shadow)$/;
const WHITE = /#(?:fff|ffffff)\b/gi;

const keyName = (k) => (k.type === "Identifier" ? k.name : k.type === "StringLiteral" ? k.value : "");
const roleOfKey = (k) => (TEXT_KEYS.has(k) ? "onAccent" : SURFACE_KEYS.has(k) ? "surface" : "");
const isFallback = (text, at) => /var\(--[\w-]+,\s*$/.test(text.slice(Math.max(0, at - 60), at));

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(f) && !f.includes(".test.") && !SKIP_FILES.has(f)) out.push(p);
  }
  return out;
}

// The CSS property a colour in page CSS belongs to: the last "name:" before it in the same declaration.
function cssProp(text, at) {
  const before = text.slice(0, at);
  const m = before.match(/([a-z-]+)\s*:[^;:{}]*$/i);
  return m ? m[1].toLowerCase() : "";
}

let total = 0, unsure = 0;
const report = [];
for (const file of walk(path.join(SRC, "plugins/leadgen"))) {
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parser.parse(code, { sourceType: "module", plugins: ["jsx"] });
  } catch (e) {
    report.push(`${path.relative(SRC, file)}: not parsed (${e.message})`);
    continue;
  }
  const edits = [];
  let ownC = false, left = 0;
  traverse(ast, {
    VariableDeclarator(p) { if (p.node.id.type === "Identifier" && p.node.id.name === "C") ownC = true; },
    StringLiteral(p) {
      const n = p.node;
      if (!WHITE.test(n.value)) return;
      WHITE.lastIndex = 0;
      let key = "";
      const parent = p.parent;
      if (parent.type === "ObjectProperty" && parent.value === n) key = keyName(parent.key);
      else if (parent.type === "JSXAttribute") key = ATTR_TEXT.has(parent.name.name) ? "color" : "";
      else if (parent.type === "ConditionalExpression" || parent.type === "LogicalExpression") {
        const gp = p.parentPath.parent;
        if (gp.type === "ObjectProperty") key = keyName(gp.key);
      }
      const role = roleOfKey(key);
      if (!role) { left += 1; return; }
      const whole = n.value.trim().toLowerCase();
      let rep;
      if (whole === "#fff" || whole === "#ffffff") rep = `C.${role}`;
      else rep = "`" + code.slice(n.start + 1, n.end - 1).replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(WHITE, "${C." + role + "}") + "`";
      edits.push([n.start, n.end, parent.type === "JSXAttribute" ? `{${rep}}` : rep]);
    },
    TemplateLiteral(p) {
      const all = p.node.quasis.map((q) => q.value.raw).join("");
      if (/<[a-z]/i.test(all) || !/[:;{]/.test(all)) return; // page CSS only, never HTML
      for (const q of p.node.quasis) {
        const raw = q.value.raw;
        for (const m of raw.matchAll(WHITE)) {
          if (isFallback(raw, m.index)) continue;
          const prop = cssProp(raw, m.index);
          const role = CSS_TEXT.has(prop) ? "onAccent" : CSS_SURFACE.test(prop) ? "surface" : "";
          if (!role) { left += 1; continue; }
          const at = q.start + m.index;
          edits.push([at, at + m[0].length, "${C." + role + "}"]);
        }
      }
    },
  });
  unsure += left;
  if (!edits.length) { if (left) report.push(`${path.relative(SRC, file)}: 0 (${left} left: role unclear)`); continue; }
  if (ownC) { report.push(`${path.relative(SRC, file)}: skipped (defines its own C)`); continue; }
  edits.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  const rel = path.relative(path.dirname(file), path.join(SRC, "tokens")).replace(/\\/g, "/");
  const spec = rel.startsWith(".") ? rel : "./" + rel;
  const imp = new RegExp(`import \\{([^}]*)\\} from "${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}";`);
  const m = out.match(imp);
  if (m) {
    const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.includes("C")) out = out.replace(m[0], `import { ${["C", ...names].join(", ")} } from "${spec}";`);
  } else {
    const lastImport = [...out.matchAll(/^import [^;]+;\n/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length : 0;
    out = out.slice(0, at) + `import { C } from "${spec}";\n` + out.slice(at);
  }
  try { parser.parse(out, { sourceType: "module", plugins: ["jsx"] }); } catch (e) { report.push(`${path.relative(SRC, file)}: result would not parse, left alone (${e.message})`); continue; }
  total += edits.length;
  report.push(`${path.relative(SRC, file)}: ${edits.length}${left ? ` (${left} left: role unclear)` : ""}`);
  if (WRITE) fs.writeFileSync(file, out);
}
console.log(report.join("\n"));
console.log(`white moved onto tokens: ${total}; left where its job was unclear: ${unsure}${WRITE ? "" : " (dry run)"}`);
