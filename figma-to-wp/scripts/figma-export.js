#!/usr/bin/env node

/**
 * Figma to JSON Exporter — ss_theme workflow
 * ───────────────────────────────────────────
 * Exports Figma frames as design-token JSON for tailwind.config.js generation
 * and module reference.
 *
 * Usage:
 *   FIGMA_TOKEN=figd_xxx node figma-export.js <FILE_ID> <NODE_ID> [NODE_ID...] [--out <dir>]
 *
 * The Figma personal access token is read from the FIGMA_TOKEN environment
 * variable — never hardcode it in this file.
 *
 * Each node ID produces its own output file:
 *   figma-export-<frame-name>.json
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;

const rawArgs = process.argv.slice(2);
let OUTPUT_DIR = "./output";
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--out") {
    OUTPUT_DIR = rawArgs[++i] || OUTPUT_DIR;
  } else {
    positional.push(rawArgs[i]);
  }
}
const FILE_ID  = positional[0];
const NODE_IDS = positional.slice(1);
const PRETTY_JSON = true;

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

function figmaGet(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.figma.com",
      path:     urlPath,
      method:   "GET",
      headers:  { "X-Figma-Token": FIGMA_TOKEN },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data",  (chunk) => (data += chunk));
      res.on("end",   () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.err || parsed.status === 403) {
            reject(new Error(parsed.err || "Figma API error: " + data));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error("Failed to parse Figma response: " + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─── Color Utilities ──────────────────────────────────────────────────────────

function figmaColorToRgba({ r, g, b, a = 1 }) {
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  const bi = Math.round(b * 255);
  if (Math.abs(a - 1) < 0.001) return `rgb(${ri}, ${gi}, ${bi})`;
  return `rgba(${ri}, ${gi}, ${bi}, ${a})`;
}

function figmaColorToHex({ r, g, b, a = 1 }) {
  const toH = (v) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  const hex = `#${toH(r)}${toH(g)}${toH(b)}`;
  if (Math.abs(a - 1) < 0.001) return hex;
  return `${hex}${toH(a)}`;
}

function paintToCss(paint) {
  if (!paint || paint.visible === false) return null;
  const opacity = paint.opacity !== undefined ? paint.opacity : 1;

  if (paint.type === "SOLID") {
    const { r, g, b } = paint.color;
    const a = paint.color.a !== undefined ? paint.color.a * opacity : opacity;
    return figmaColorToRgba({ r, g, b, a });
  }

  if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
    const stops = (paint.gradientStops || [])
      .map((s) => {
        const c = figmaColorToRgba({ ...s.color, a: s.color.a * opacity });
        return `${c} ${Math.round(s.position * 100)}%`;
      })
      .join(", ");
    const type = paint.type === "GRADIENT_LINEAR" ? "linear-gradient" : "radial-gradient";
    return `${type}(${stops})`;
  }

  if (paint.type === "IMAGE") {
    return `url(<path-to-image>) lightgray 50% / cover no-repeat`;
  }

  return null;
}

function collectColors(paints, colorSet) {
  for (const paint of paints || []) {
    if (paint.type === "SOLID" && paint.visible !== false) {
      const { r, g, b } = paint.color;
      const a       = paint.color.a  !== undefined ? paint.color.a  : 1;
      const opacity = paint.opacity  !== undefined ? paint.opacity   : 1;
      const ea      = a * opacity;
      const key =
        Math.abs(ea - 1) < 0.001
          ? `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
          : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${ea})`;
      colorSet.add(key);
    }
  }
}

// ─── CSS Props Builder ────────────────────────────────────────────────────────

function buildCssProps(node) {
  const css = {};
  const bb  = node.absoluteBoundingBox || node.absoluteRenderBounds;

  // Dimensions
  if (bb) {
    css.width  = `${Math.round(bb.width  * 100) / 100}px`;
    css.height = `${Math.round(bb.height * 100) / 100}px`;
  }

  // Auto-layout
  if (node.layoutMode === "HORIZONTAL") {
    css.display           = "flex";
    css["flex-direction"] = "row";
  } else if (node.layoutMode === "VERTICAL") {
    css.display           = "flex";
    css["flex-direction"] = "column";
  }

  if (node.primaryAxisAlignItems) {
    const map = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
    css["justify-content"] = map[node.primaryAxisAlignItems] || node.primaryAxisAlignItems.toLowerCase();
  }
  if (node.counterAxisAlignItems) {
    const map = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" };
    css["align-items"] = map[node.counterAxisAlignItems] || node.counterAxisAlignItems.toLowerCase();
  }
  if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
    css.gap = `${node.itemSpacing}px`;
  }

  // Padding
  if (node.paddingTop)    css["padding-top"]    = `${node.paddingTop}px`;
  if (node.paddingRight)  css["padding-right"]  = `${node.paddingRight}px`;
  if (node.paddingBottom) css["padding-bottom"] = `${node.paddingBottom}px`;
  if (node.paddingLeft)   css["padding-left"]   = `${node.paddingLeft}px`;

  // Flex child props
  if (node.layoutGrow === 1)                  css["flex-grow"]   = "1";
  if (node.layoutAlign === "STRETCH")         css["align-self"]  = "stretch";
  if (node.layoutSizingHorizontal === "FILL") css.flex           = "1 0 0";
  if (node.type === "GROUP")                  css["flex-shrink"] = "0";

  // Border radius
  if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
    css["border-radius"] = `${node.cornerRadius}px`;
  } else if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    if (tl || tr || br || bl) css["border-radius"] = `${tl}px ${tr}px ${br}px ${bl}px`;
  }

  // Background / fill
  const fills = (node.fills || []).filter((f) => f.visible !== false);
  if (fills.length >= 1) {
    const primary  = fills.length === 1 ? fills[0] : fills[fills.length - 1];
    const v        = paintToCss(primary);
    const bgTypes  = new Set(["ELLIPSE","RECTANGLE","FRAME","COMPONENT","INSTANCE","VECTOR"]);
    if (v && bgTypes.has(node.type)) css.background = v;
  }

  // Stroke / border
  const strokes = (node.strokes || []).filter((s) => s.visible !== false);
  if (strokes.length) {
    const sc = paintToCss(strokes[0]);
    if (sc) {
      const sw = node.strokeWeight || 1;
      if (node.type === "ELLIPSE") {
        css.stroke          = sc;
        css["stroke-width"] = `${sw}px`;
      } else {
        css.border = `${sw}px solid ${sc}`;
      }
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity !== 1) {
    css.opacity = String(Math.round(node.opacity * 100) / 100);
  }

  // Aspect ratio
  if (bb && bb.width && bb.height) {
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const g   = gcd(Math.round(bb.width), Math.round(bb.height));
    const aw  = Math.round(bb.width)  / g;
    const ah  = Math.round(bb.height) / g;
    if (aw <= 32 && ah <= 32 && aw !== ah) css["aspect-ratio"] = `${aw}/${ah}`;
  }

  // Overflow
  if (node.clipsContent === true) css.overflow = "hidden";

  // Effects: drop shadow, inner shadow, blur
  if (node.effects && node.effects.length) {
    const shadows = node.effects
      .filter((e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false)
      .map((e) => {
        const c     = figmaColorToRgba(e.color);
        const inset = e.type === "INNER_SHADOW" ? "inset " : "";
        return `${inset}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${e.spread || 0}px ${c}`;
      });
    if (shadows.length) css["box-shadow"] = shadows.join(", ");

    const blurs = node.effects.filter((e) => e.type === "LAYER_BLUR" && e.visible !== false);
    if (blurs.length) css.filter = `blur(${blurs[0].radius}px)`;
  }

  // Text styles
  if (node.type === "TEXT" && node.style) {
    const s      = node.style;
    const fills2 = (node.fills || []).filter((f) => f.visible !== false && f.type === "SOLID");
    if (fills2.length) {
      const { r, g, b } = fills2[0].color;
      const a = (fills2[0].color.a || 1) * (fills2[0].opacity !== undefined ? fills2[0].opacity : 1);
      css.color = Math.abs(a - 1) < 0.001
        ? figmaColorToHex({ r, g, b, a })
        : figmaColorToRgba({ r, g, b, a });
    }
    if (s.fontFamily) css["font-family"]  = s.fontFamily.includes(" ") ? `"${s.fontFamily}"` : s.fontFamily;
    if (s.fontSize)   css["font-size"]    = `${s.fontSize}px`;
    css["font-style"] = s.italic ? "italic" : "normal";
    if (s.fontWeight) css["font-weight"]  = String(s.fontWeight);
    if (s.lineHeightPx && s.lineHeightUnit !== "INTRINSIC_%") {
      const lhPct = s.lineHeightPercentFontSize
        ? `${Math.round(s.lineHeightPercentFontSize)}%`
        : `${Math.round(s.lineHeightPx)}px`;
      css["line-height"] = `${lhPct} /* ${Math.round(s.lineHeightPx)}px */`;
    }
    if (s.letterSpacing && s.letterSpacing !== 0) css["letter-spacing"] = `${s.letterSpacing}px`;
    const textAlignMap = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
    if (s.textAlignHorizontal && s.textAlignHorizontal !== "LEFT") {
      css["text-align"] = textAlignMap[s.textAlignHorizontal] || s.textAlignHorizontal.toLowerCase();
    }
    if (s.textCase === "UPPER")      css["text-transform"] = "uppercase";
    else if (s.textCase === "LOWER") css["text-transform"] = "lowercase";
    else if (s.textCase === "TITLE") css["text-transform"] = "capitalize";
    const decorMap = { STRIKETHROUGH: "line-through", UNDERLINE: "underline" };
    if (s.textDecoration && decorMap[s.textDecoration]) css["text-decoration"] = decorMap[s.textDecoration];
  }

  return css;
}

// ─── Structure Builder ────────────────────────────────────────────────────────

const SKIP_TYPES = new Set(["BOOLEAN_OPERATION"]);

function buildStructure(node, tc) {
  if (SKIP_TYPES.has(node.type)) return null;

  const styles = buildCssProps(node);

  // Collect design token data
  collectColors(node.fills,   tc.colors);
  collectColors(node.strokes, tc.colors);

  if (node.type === "TEXT" && node.style) {
    const s   = node.style;
    const key = s.fontFamily.toLowerCase().replace(/\s+/g, "-");
    if (!tc.fonts[key]) tc.fonts[key] = { family: s.fontFamily, sizes: {}, weights: {} };
    if (s.fontSize)   tc.fonts[key].sizes[`size-${s.fontSize}`]       = `${s.fontSize}px`;
    if (s.fontWeight) tc.fonts[key].weights[`weight-${s.fontWeight}`] = String(s.fontWeight);
  }

  if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
    tc.spacing[`gap-${Math.round(node.itemSpacing)}`] = `${Math.round(node.itemSpacing)}px`;
  }
  ["paddingTop","paddingRight","paddingBottom","paddingLeft"].forEach((p) => {
    if (node[p] !== undefined && node[p] !== 0) {
      const side = p.replace("padding","padding-").toLowerCase();
      tc.spacing[`${side}-${Math.round(node[p])}`] = `${Math.round(node[p])}px`;
    }
  });

  for (const effect of node.effects || []) {
    if (effect.type === "DROP_SHADOW" && effect.visible !== false) {
      const key = `shadow-${effect.radius}-${effect.offset.y}`;
      tc.effects[key] = {
        x:      effect.offset.x,
        y:      effect.offset.y,
        blur:   effect.radius,
        spread: effect.spread || 0,
        color:  figmaColorToRgba(effect.color),
      };
    }
  }

  const entry = { styles, type: node.type, name: node.name };
  if (node.type === "TEXT") entry.characters = node.characters || "";

  const children = (node.children || []).map((c) => buildStructure(c, tc)).filter(Boolean);
  if (children.length) entry.children = children;

  return entry;
}

// ─── Design Token Formatter ───────────────────────────────────────────────────

function buildDesignTokens(tc) {
  const colors = {};
  for (const c of tc.colors) colors[`color-${c}`] = c;
  return { colors, fonts: tc.fonts, spacing: tc.spacing, effects: tc.effects };
}

// ─── Count Helpers ────────────────────────────────────────────────────────────

function countElements(node) {
  let n = 1;
  for (const c of node.children || []) n += countElements(c);
  return n;
}

function maxDepth(node, d = 0) {
  if (!node.children || !node.children.length) return d;
  return Math.max(...node.children.map((c) => maxDepth(c, d + 1)));
}

function safeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").toLowerCase();
}

// ─── Process a single node ID ─────────────────────────────────────────────────

async function processNode(nodeId, figmaFileName) {
  console.log(`\n  ⏳  Fetching node ${nodeId} ...`);

  const nodeData = await figmaGet(
    `/v1/files/${FILE_ID}/nodes?ids=${encodeURIComponent(nodeId)}`
  );

  const nodeEntry = nodeData.nodes[nodeId];
  if (!nodeEntry) throw new Error(`Node "${nodeId}" not found in file.`);

  const targetNode = nodeEntry.document;
  console.log(`  ✅  Found: "${targetNode.name}" (${targetNode.type})`);

  const tc        = { colors: new Set(), fonts: {}, spacing: {}, effects: {} };
  const structure = buildStructure(targetNode, tc);

  const totalElements = countElements(targetNode);
  const nestingDepth  = maxDepth(targetNode);

  const output = {
    metadata: {
      exportedAt:    new Date().toISOString(),
      figmaFileId:   FILE_ID,
      figmaFileName,
      frameId:       nodeId,
      componentName: targetNode.name,
      totalElements,
      nestingDepth,
      plugin:        "Figma to JSON Exporter",
    },
    designTokens: buildDesignTokens(tc),
    structure:    [structure],
  };

  const outFileName = `figma-export-${safeFileName(targetNode.name)}.json`;
  const outPath     = path.resolve(OUTPUT_DIR, outFileName);
  fs.mkdirSync(path.resolve(OUTPUT_DIR), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, PRETTY_JSON ? 2 : 0), "utf8");

  console.log(`  📄  Saved  : ${outPath}`);
  console.log(`      Elements: ${totalElements}  |  Depth: ${nestingDepth}  |  Colors: ${tc.colors.size}  |  Fonts: ${Object.keys(tc.fonts).length}`);

  return outPath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!FIGMA_TOKEN) {
    console.error("❌  Set the FIGMA_TOKEN environment variable (Figma personal access token).");
    console.error("    Example: FIGMA_TOKEN=figd_xxx node figma-export.js <FILE_ID> <NODE_ID>");
    process.exit(1);
  }
  if (!FILE_ID) {
    console.error("❌  Usage: node figma-export.js <FILE_ID> <NODE_ID> [NODE_ID...] [--out <dir>]");
    process.exit(1);
  }
  if (NODE_IDS.length === 0) {
    console.error("❌  Provide at least one NODE_ID (e.g. 5740:998, from the Figma URL's node-id param).");
    process.exit(1);
  }

  console.log(`\n🎨  Figma JSON Exporter`);
  console.log(`   File   : ${FILE_ID}`);
  console.log(`   Frames : ${NODE_IDS.length} node(s) → ${NODE_IDS.join(", ")}`);
  console.log(`   Output : ${path.resolve(OUTPUT_DIR)}\n`);

  // Fetch file name once (depth=1 keeps the response small)
  console.log("⏳  Fetching Figma file info...");
  const fileData     = await figmaGet(`/v1/files/${FILE_ID}?depth=1`);
  const figmaFileName = fileData.name || "Untitled";
  console.log(`✅  File: "${figmaFileName}"`);

  // Process each node sequentially to stay within Figma's rate limits
  const results = [];
  for (let i = 0; i < NODE_IDS.length; i++) {
    const nodeId = NODE_IDS[i];
    console.log(`\n[${i + 1}/${NODE_IDS.length}] Processing node: ${nodeId}`);
    try {
      const outPath = await processNode(nodeId, figmaFileName);
      results.push({ nodeId, status: "ok", outPath });
    } catch (err) {
      console.error(`  ❌  Failed: ${err.message}`);
      results.push({ nodeId, status: "error", error: err.message });
    }
  }

  // Summary
  const ok  = results.filter((r) => r.status === "ok").length;
  const bad = results.filter((r) => r.status === "error").length;
  console.log(`\n${"─".repeat(42)}`);
  console.log(`✅  Exported : ${ok} / ${NODE_IDS.length}`);
  if (bad) {
    console.log(`❌  Failed   : ${bad} / ${NODE_IDS.length}`);
    results.filter((r) => r.status === "error").forEach((r) =>
      console.log(`     ${r.nodeId} → ${r.error}`)
    );
  }
  console.log(`${"─".repeat(42)}\n`);
}

main().catch((err) => {
  console.error("\n❌  Fatal:", err.message);
  process.exit(1);
});
