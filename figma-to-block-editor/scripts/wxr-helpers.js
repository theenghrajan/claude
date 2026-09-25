'use strict';
/**
 * Core helper library for the figma-to-block-editor skill.
 *
 * The WordPress block editor (Gutenberg — both "classic theme + block
 * editor" sites and Full Site Editing / block themes) stores a layout as
 * the post's `post_content` (WXR `<content:encoded>`): block comments
 * wrapped around the HTML each block's save() function produced.
 *
 *   <!-- wp:group {"layout":{"type":"constrained"}} -->
 *   <div class="wp-block-group"><!-- wp:heading -->
 *   <h2 class="wp-block-heading">Hi</h2>
 *   <!-- /wp:heading --></div>
 *   <!-- /wp:group -->
 *
 * THE trap: on load, the editor re-runs save(attrs) for every static block
 * and compares the result with the stored HTML. Any mismatch (a comment
 * attr that implies a class/style/tag the HTML lacks, or the reverse) shows
 * "This block contains unexpected or invalid content". So every edit here
 * changes the comment attrs AND the HTML together — never one alone.
 *
 * Parsed into a lossless tree (beSerialize(beParse(x)) === x):
 *   { kind: 'block', name, attrs: {...json...}, children: [...], selfClosing }
 *   { kind: 'text',  text }      // the block's own HTML, split around inner blocks
 *
 * Public API (see each function's comment):
 *   beExtractAllContent / beExtractAttachments / beExtractSiteHeader / beMaxPostId
 *   beParse / beSerialize / beWalk / beFindAll / beGetByPath / beCollectPaths / beClone
 *   beGetAttr / beSetAttr / beSetText / beSetHtmlAttr / beAddClass / beSetImage / beStyle / bePreset / beRenameId
 *   beBlock + fresh core blocks: bePara beHeading beImage beButtons beButton beGroup
 *     beColumns beColumn beList beDetails beFaq beSpacer beSeparator beHtml
 *   beItemDefaults / beRenderItem / beRenderAttachmentItem / beRenderWxrDocument / beExtractRawItems
 *   beValidateTree / beValidateImageUrls / beValidateWxrFile
 */

const fs = require('fs');
const { XMLValidator } = require('fast-xml-parser');

// ---------------------------------------------------------------------
// CDATA / XML helpers (same conventions as figma-to-divi-builder)
// ---------------------------------------------------------------------

function joinCdataChunks(raw) {
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m;
  let combined = '';
  let found = false;
  while ((m = cdataRe.exec(raw))) {
    combined += m[1];
    found = true;
  }
  return found ? combined : xmlUnescape(raw.trim());
}

function toCdata(str) {
  return '<![CDATA[' + String(str).split(']]>').join(']]]]><![CDATA[>') + ']]>';
}

function xmlEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlUnescape(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function htmlEscape(str) {
  return xmlEscape(str).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------

function extractItemBlocks(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) items.push(m[1]);
  return items;
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(block);
  return m ? joinCdataChunks(m[1]) : '';
}

function extractAllPostMeta(block) {
  const meta = {};
  const postmetaRe = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g;
  let m;
  while ((m = postmetaRe.exec(block))) {
    const key = extractTag(m[1], 'wp:meta_key');
    const valMatch = /<wp:meta_value>([\s\S]*?)<\/wp:meta_value>/.exec(m[1]);
    meta[key] = valMatch ? joinCdataChunks(valMatch[1]) : '';
  }
  return meta;
}

function extractTerms(block) {
  const terms = [];
  const catRe = /<category domain="([^"]*)" nicename="([^"]*)">([\s\S]*?)<\/category>/g;
  let m;
  while ((m = catRe.exec(block))) terms.push({ domain: m[1], nicename: m[2], name: joinCdataChunks(m[3]) });
  return terms;
}

const hasBlocks = (content) => /<!--\s+wp:[a-z]/.test(content);

/**
 * Every item whose post_content holds block markup: pages, posts, synced/
 * unsynced patterns (`wp_block`), FSE templates and template parts
 * (`wp_template`, `wp_template_part`), navigation menus (`wp_navigation`).
 * `wp_global_styles` holds JSON, not blocks — returned separately by
 * beExtractGlobalStyles.
 */
function beExtractAllContent(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const out = [];
  for (const block of extractItemBlocks(xml)) {
    const postType = extractTag(block, 'wp:post_type');
    if (['attachment', 'revision', 'nav_menu_item', 'wp_global_styles'].includes(postType)) continue;
    const content = extractTag(block, 'content:encoded');
    if (!hasBlocks(content)) continue;
    out.push({
      postId: parseInt(extractTag(block, 'wp:post_id'), 10),
      postName: extractTag(block, 'wp:post_name'),
      title: extractTag(block, 'title').trim(),
      postType,
      status: extractTag(block, 'wp:status'),
      content,
      tree: beParse(content),
      meta: extractAllPostMeta(block),
      terms: extractTerms(block),
    });
  }
  return out;
}

/** User-customized global styles (Site Editor -> Styles) — theme.json-shaped JSON, one per theme. */
function beExtractGlobalStyles(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return extractItemBlocks(xml)
    .filter((b) => extractTag(b, 'wp:post_type') === 'wp_global_styles')
    .map((b) => ({ postId: parseInt(extractTag(b, 'wp:post_id'), 10), terms: extractTerms(b), json: extractTag(b, 'content:encoded') }));
}

function beExtractAttachments(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return extractItemBlocks(xml)
    .filter((b) => extractTag(b, 'wp:post_type') === 'attachment')
    .map((b) => ({ postId: parseInt(extractTag(b, 'wp:post_id'), 10), url: extractTag(b, 'wp:attachment_url') }));
}

function beMaxPostId(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  let max = 0;
  const re = /<wp:post_id>(\d+)<\/wp:post_id>/g;
  let m;
  while ((m = re.exec(xml))) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

/** Channel-level site identity + the WordPress version from the export's <generator>. */
function beExtractSiteHeader(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const channelMatch = /<channel>([\s\S]*?)<item>/.exec(xml);
  const channelBlock = channelMatch ? channelMatch[1] : xml;
  const authorMatch = /<wp:author>([\s\S]*?)<\/wp:author>/.exec(xml);
  const authorBlock = authorMatch ? authorMatch[1] : '';
  const gen = /<generator>[^<]*\?v=([\d.]+)[^<]*<\/generator>/.exec(xml);
  return {
    site_title: extractTag(channelBlock, 'title'),
    site_url: extractTag(channelBlock, 'link'),
    language: extractTag(channelBlock, 'language') || 'en-US',
    wxr_version: extractTag(channelBlock, 'wp:wxr_version') || '1.2',
    base_site_url: extractTag(channelBlock, 'wp:base_site_url'),
    base_blog_url: extractTag(channelBlock, 'wp:base_blog_url'),
    wp_version: gen ? gen[1] : '',
    author_login: extractTag(authorBlock, 'wp:author_login'),
    author_email: extractTag(authorBlock, 'wp:author_email'),
    author_display_name: extractTag(authorBlock, 'wp:author_display_name'),
    author_first_name: extractTag(authorBlock, 'wp:author_first_name'),
    author_last_name: extractTag(authorBlock, 'wp:author_last_name'),
  };
}

// ---------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------

// Same grammar as WordPress's block parser: optional namespace, JSON attrs ending in `}` + whitespace, optional `/` void marker.
const BLOCK_RE = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(?:(\{[\s\S]*?\})\s+)?(\/)?-->/g;

/** Parse block markup into `{ children, unclosed, strays }`. */
function beParse(content) {
  const root = { kind: 'root', children: [] };
  const stack = [root];
  const strays = [];
  let last = 0;
  let m;
  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const prev = parent.children[parent.children.length - 1];
    if (prev && prev.kind === 'text') prev.text += text;
    else parent.children.push({ kind: 'text', text });
  };
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(content))) {
    pushText(content.slice(last, m.index));
    last = m.index + m[0].length;
    const [, isClose, name, json, selfClose] = m;
    if (isClose) {
      let idx = stack.length - 1;
      while (idx > 0 && stack[idx].name !== name) idx--;
      if (idx === 0) { strays.push(m[0]); pushText(m[0]); continue; }
      stack.length = idx;
      continue;
    }
    let attrs = {};
    if (json) {
      try { attrs = JSON.parse(json); } catch (e) { throw new Error(`Invalid block JSON in ${name}: ${e.message}`); }
    }
    const node = { kind: 'block', name, attrs, children: [], selfClosing: !!selfClose, _rawOpen: m[0], _rawOpenAttrs: JSON.stringify(attrs) };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  pushText(content.slice(last));
  return { children: root.children, unclosed: stack.slice(1).map((n) => n.name), strays };
}

/** WordPress's serialize_block_attributes() escaping. */
function serializeBlockAttributes(attrs) {
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

function serializeNodes(children) {
  let out = '';
  for (const n of children) {
    if (n.kind === 'text') { out += n.text; continue; }
    const hasAttrs = n.attrs && Object.keys(n.attrs).length > 0;
    const fresh = `<!-- wp:${n.name} ${hasAttrs ? serializeBlockAttributes(n.attrs) + ' ' : ''}${n.selfClosing ? '/' : ''}-->`;
    out += n._rawOpen && n._rawOpenAttrs === JSON.stringify(n.attrs) ? n._rawOpen : fresh;
    if (n.selfClosing) continue;
    out += serializeNodes(n.children) + `<!-- /wp:${n.name} -->`;
  }
  return out;
}

/** Serialize a tree or an array of top-level blocks (joined by a blank line, like WordPress). */
function beSerialize(treeOrBlocks) {
  if (Array.isArray(treeOrBlocks)) return treeOrBlocks.map((b) => serializeNodes([b])).join('\n\n');
  return serializeNodes(treeOrBlocks.children);
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

const shortName = (name) => name.replace(/^core\//, '');
const elementChildren = (node) => (node.children || []).filter((c) => c.kind === 'block');

function beWalk(nodes, cb, path = [], parent = null) {
  const list = Array.isArray(nodes) ? nodes : nodes.children;
  let i = 0;
  for (const n of list) {
    if (n.kind !== 'block') continue;
    const p = [...path, i];
    cb(n, p, parent);
    beWalk(n.children, cb, p, n);
    i++;
  }
}

/** Node at a block-index path (what the catalog prints), e.g. [0, 1] = 1st top-level block -> its 2nd inner block. */
function beGetByPath(tree, path) {
  let cur = { children: Array.isArray(tree) ? tree : tree.children };
  for (const i of path) {
    cur = elementChildren(cur)[i];
    if (!cur) throw new Error(`No block at path ${path.join('.')}`);
  }
  return cur;
}

function beFindAll(tree, pred) {
  const out = [];
  beWalk(tree, (n, p) => { if (pred(n, p)) out.push(n); });
  return out;
}

function beCollectPaths(tree) {
  const out = [];
  beWalk(tree, (n, p) => out.push({ path: p.join('.'), name: n.name }));
  return out;
}

/**
 * Deep clone (edits never touch the mined original). By default a synced
 * pattern reference (`core/block` with `ref`) is refused: a clone of it is
 * still the *same* synced pattern — editing it edits every page using it.
 * Clone the referenced wp_block's own content instead, or pass
 * { keepRefs: true } if the user explicitly wants the synced pattern reused.
 */
function beClone(node, opts = {}) {
  const copy = JSON.parse(JSON.stringify(node, (k, v) => (k === '_rawOpen' || k === '_rawOpenAttrs' ? undefined : v)));
  if (!opts.keepRefs) {
    beWalk([copy], (n) => {
      if (shortName(n.name) === 'block' && n.attrs.ref) throw new Error(`Clone contains a synced pattern reference (core/block ref=${n.attrs.ref}); clone that wp_block's content instead, or pass { keepRefs: true }`);
    });
  }
  return copy;
}

// ---------------------------------------------------------------------
// Editing — every helper keeps comment attrs and HTML in sync
// ---------------------------------------------------------------------

function beGetAttr(node, key) {
  let cur = node.attrs;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Set a comment attr by dot path (`undefined` deletes). Only use this for
 * attrs that do NOT change the saved HTML (layout, sizeSlug, metadata,
 * blockGap, …) — for anything that does, use the helpers below.
 */
function beSetAttr(node, key, value) {
  const parts = key.split('.');
  let cur = node.attrs;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  if (value === undefined) delete cur[parts[parts.length - 1]];
  else cur[parts[parts.length - 1]] = value;
  return node;
}

/** Locate the first `<tag …>` (or the first element if tag is omitted) in the block's own HTML. */
function findTag(node, tag) {
  const re = tag ? new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, 'i') : /<([a-z][a-z0-9-]*)(?=[\s>/])[^>]*>/i;
  for (const child of node.children) {
    if (child.kind !== 'text') continue;
    const m = re.exec(child.text);
    if (m) return { child, index: m.index, open: m[0], tag: (tag || m[1]).toLowerCase() };
  }
  return null;
}

/**
 * Replace the inner HTML of `<tag>` in the block's own HTML (default: the
 * wrapper element). For rich-text blocks the editor re-reads this HTML as
 * the attribute, so text is always safe to change. Examples:
 *   beSetText(heading, 'Our services')
 *   beSetText(button, 'Get a quote', 'a')
 *   beSetText(details, 'Question?', 'summary')
 */
function beSetText(node, html, tag) {
  const hit = findTag(node, tag);
  if (!hit) throw new Error(`beSetText: no <${tag || 'element'}> in ${node.name}`);
  const { child, index, open } = hit;
  const start = index + open.length;
  const end = child.text.lastIndexOf(`</${hit.tag}>`);
  if (end < start) throw new Error(`beSetText: <${hit.tag}> in ${node.name} is not closed in the same HTML run (it wraps inner blocks — edit those instead)`);
  child.text = child.text.slice(0, start) + html + child.text.slice(end);
  return node;
}

function parseAttrs(openTag) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:="([^"]*)")?/g;
  const body = openTag.replace(/^<[^\s>/]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) attrs[m[1]] = m[2] === undefined ? null : m[2];
  return attrs;
}

function rewriteOpenTag(node, tag, fn) {
  const hit = findTag(node, tag);
  if (!hit) throw new Error(`no <${tag || 'element'}> in ${node.name}`);
  const attrs = parseAttrs(hit.open);
  fn(attrs);
  const selfClose = /\/>$/.test(hit.open);
  const attrStr = Object.entries(attrs).map(([k, v]) => (v === null ? ` ${k}` : ` ${k}="${v}"`)).join('');
  const rebuilt = `<${hit.open.match(/^<([^\s>/]+)/)[1]}${attrStr}${selfClose ? '/>' : '>'}`;
  hit.child.text = hit.child.text.slice(0, hit.index) + rebuilt + hit.child.text.slice(hit.index + hit.open.length);
}

/** Set (or with `undefined`, remove) an HTML attribute on `<tag>` in the block's own HTML: beSetHtmlAttr(button, 'a', 'href', url). */
function beSetHtmlAttr(node, tag, attr, value) {
  rewriteOpenTag(node, tag, (a) => {
    if (value === undefined) delete a[attr];
    else a[attr] = htmlEscape(value);
  });
  return node;
}

function editClasses(node, tag, add = [], remove = () => false) {
  rewriteOpenTag(node, tag, (a) => {
    const list = (a.class || '').split(/\s+/).filter((c) => c && !remove(c));
    for (const c of add) if (!list.includes(c)) list.push(c);
    if (list.length) a.class = list.join(' ');
    else delete a.class;
  });
}

/** Add a custom CSS class the way the editor's "Additional CSS class(es)" field does: attrs.className + the wrapper's class. */
function beAddClass(node, cls) {
  const list = (node.attrs.className || '').split(/\s+/).filter(Boolean);
  for (const c of cls.split(/\s+/)) if (c && !list.includes(c)) list.push(c);
  node.attrs.className = list.join(' ');
  editClasses(node, null, cls.split(/\s+/));
  return node;
}

/**
 * Point an image-bearing block (image, cover, media-text, or a clone of
 * one) at a new image. Replaces the old URL everywhere in the block's own
 * HTML and attrs (src, background-image, attrs.url/mediaUrl), sets alt,
 * and drops the old media-library link (`id`/`mediaId` + `wp-image-N`
 * class) — otherwise WordPress would add the OLD image's srcset at render.
 */
function beSetImage(node, url, alt) {
  const img = findTag(node, 'img');
  const oldUrl = (img && parseAttrs(img.open).src) || node.attrs.url || node.attrs.mediaUrl;
  if (!oldUrl) throw new Error(`beSetImage: ${node.name} has no image to replace`);
  const oldPlain = xmlUnescape(oldUrl);
  for (const c of node.children) if (c.kind === 'text') c.text = c.text.split(oldUrl).join(htmlEscape(url)).split(oldPlain).join(htmlEscape(url));
  for (const k of ['url', 'mediaUrl']) if (node.attrs[k] !== undefined) node.attrs[k] = url;
  for (const k of ['id', 'mediaId', 'mediaLink']) delete node.attrs[k];
  if (img) {
    editClasses(node, 'img', [], (c) => /^wp-image-\d+$/.test(c));
    if (alt !== undefined) beSetHtmlAttr(node, 'img', 'alt', alt);
  }
  if (alt !== undefined && node.attrs.alt !== undefined) node.attrs.alt = alt;
  return node;
}

/**
 * Give a cloned plugin block a new unique id (Kadence `uniqueID`,
 * GenerateBlocks `uniqueId`, Spectra `block_id`, …). Several plugins bake
 * the id into saved class names (`kb-row-layout-id_abc`), so the old value
 * is replaced in the attr AND everywhere in the block's own HTML.
 */
function beRenameId(node, key, newId) {
  const old = node.attrs[key];
  if (!old) throw new Error(`beRenameId: ${node.name} has no attr ${key}`);
  node.attrs[key] = newId;
  for (const c of node.children) if (c.kind === 'text') c.text = c.text.split(old).join(newId);
  return node;
}

/** `var:preset|spacing|50` -> `var(--wp--preset--spacing--50)` (WordPress style-engine convention). */
function cssValue(v) {
  const s = String(v);
  const m = /^var:(.+)$/.exec(s);
  return m ? `var(--wp--${m[1].split('|').join('--')})` : s;
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = { topLeft: 'top-left', topRight: 'top-right', bottomLeft: 'bottom-left', bottomRight: 'bottom-right' };

/**
 * attrs.style -> the inline declarations and classes the block supports
 * write in save() (mirrors @wordpress/style-engine for the common keys).
 * Keys outside this map (elements.link, typography.fontFamily presets,
 * per-side borders, …) aren't serialized here — clone a mined block that
 * already has them.
 */
function styleToCss(style = {}) {
  const decl = {};
  const classes = [];
  const c = style.color || {};
  if (c.text) { decl.color = cssValue(c.text); classes.push('has-text-color'); }
  if (c.background) { decl['background-color'] = cssValue(c.background); classes.push('has-background'); }
  if (c.gradient) { decl.background = cssValue(c.gradient); classes.push('has-background'); }
  const sp = style.spacing || {};
  for (const box of ['padding', 'margin']) {
    const v = sp[box];
    if (typeof v === 'string') decl[box] = cssValue(v);
    else if (v) for (const side of SIDES) if (v[side] !== undefined) decl[`${box}-${side}`] = cssValue(v[side]);
  }
  const t = style.typography || {};
  const typo = { fontSize: 'font-size', lineHeight: 'line-height', fontWeight: 'font-weight', fontStyle: 'font-style', letterSpacing: 'letter-spacing', textTransform: 'text-transform', textDecoration: 'text-decoration' };
  for (const [k, prop] of Object.entries(typo)) if (t[k] !== undefined) decl[prop] = cssValue(t[k]);
  const b = style.border || {};
  if (typeof b.radius === 'string') decl['border-radius'] = cssValue(b.radius);
  else if (b.radius) for (const [k, css] of Object.entries(CORNERS)) if (b.radius[k] !== undefined) decl[`border-${css}-radius`] = cssValue(b.radius[k]);
  if (b.width) decl['border-width'] = cssValue(b.width);
  if (b.style) decl['border-style'] = b.style;
  if (b.color) { decl['border-color'] = cssValue(b.color); classes.push('has-border-color'); }
  if (style.dimensions && style.dimensions.minHeight) decl['min-height'] = cssValue(style.dimensions.minHeight);
  if (style.shadow) decl['box-shadow'] = cssValue(style.shadow);
  return { decl, classes };
}

function parseStyleAttr(s) {
  const out = {};
  for (const part of (s || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else if (v === undefined) delete target[k];
    else target[k] = v;
  }
  return target;
}

/**
 * Apply design-panel styles (the editor's Color / Typography / Dimensions /
 * Border panels) to attrs.style AND the HTML. `opts.tag` = the element the
 * block puts its styles on — the wrapper for most blocks, but 'a' for
 * core/button and 'img' for core/image borders.
 *   beStyle(group, { color: { background: '#0B1F3A' }, spacing: { padding: { top: '80px', bottom: '80px' } } })
 *   beStyle(button, { border: { radius: '999px' } }, { tag: 'a' })
 */
function beStyle(node, style, opts = {}) {
  node.attrs.style = deepMerge(node.attrs.style || {}, style);
  const { decl, classes } = styleToCss(node.attrs.style);
  rewriteOpenTag(node, opts.tag, (a) => {
    const merged = { ...parseStyleAttr(a.style), ...decl };
    const str = Object.entries(merged).map(([k, v]) => `${k}:${v}`).join(';');
    if (str) a.style = str;
  });
  if (classes.length) editClasses(node, opts.tag, classes);
  // core/image puts border styles on <img> but flags them on the <figure>.
  if (shortName(node.name) === 'image' && node.attrs.style.border) editClasses(node, 'figure', ['has-custom-border']);
  return node;
}

/**
 * Use a theme.json preset (slug) instead of a raw value — preferred when
 * the theme has a matching preset. Sets the attr + the class save() writes.
 *   bePreset(heading, { textColor: 'primary', fontSize: 'x-large' })
 *   bePreset(button, { backgroundColor: 'accent' }, { tag: 'a' })
 */
function bePreset(node, presets, opts = {}) {
  const cls = [];
  if (presets.textColor) cls.push(`has-${presets.textColor}-color`, 'has-text-color');
  if (presets.backgroundColor) cls.push(`has-${presets.backgroundColor}-background-color`, 'has-background');
  if (presets.gradient) cls.push(`has-${presets.gradient}-gradient-background`, 'has-background');
  if (presets.fontSize) cls.push(`has-${presets.fontSize}-font-size`);
  if (presets.borderColor) cls.push(`has-${presets.borderColor}-border-color`, 'has-border-color');
  Object.assign(node.attrs, presets);
  editClasses(node, opts.tag, cls);
  return node;
}

// ---------------------------------------------------------------------
// Fresh core blocks (content only; markup = current core save() output)
// ---------------------------------------------------------------------

/**
 * Construct a block. Leaf: beBlock(name, attrs, html). Container:
 * beBlock(name, attrs, openHtml, innerBlocks, closeHtml) — inner blocks
 * sit between the wrapper's open and close HTML, like save()'s InnerBlocks.
 */
function beBlock(name, attrs, html, inner, closeHtml) {
  const node = { kind: 'block', name, attrs: attrs || {}, children: [], selfClosing: false };
  if (!inner) {
    node.children = [{ kind: 'text', text: `\n${html}\n` }];
    return node;
  }
  node.children.push({ kind: 'text', text: `\n${html}` });
  inner.forEach((b, i) => {
    if (i > 0) node.children.push({ kind: 'text', text: '\n\n' });
    node.children.push(b);
  });
  node.children.push({ kind: 'text', text: `${closeHtml}\n` });
  return node;
}

const bePara = (html) => beBlock('paragraph', {}, `<p>${html}</p>`);

function beHeading(html, level = 2) {
  return beBlock('heading', level === 2 ? {} : { level }, `<h${level} class="wp-block-heading">${html}</h${level}>`);
}

/** Image by URL only (no media-library id — see Phase 4). */
function beImage(url, alt = '', opts = {}) {
  const sizeSlug = opts.sizeSlug || 'full';
  const caption = opts.caption ? `<figcaption class="wp-element-caption">${opts.caption}</figcaption>` : '';
  return beBlock('image', { sizeSlug, linkDestination: 'none' },
    `<figure class="wp-block-image size-${sizeSlug}"><img src="${htmlEscape(url)}" alt="${htmlEscape(alt)}"/>${caption}</figure>`);
}

function beButton(text, url, opts = {}) {
  const href = url ? ` href="${htmlEscape(url)}"` : '';
  const target = opts.newTab ? ' target="_blank" rel="noreferrer noopener"' : '';
  return beBlock('button', {}, `<div class="wp-block-button"><a class="wp-block-button__link wp-element-button"${href}${target}>${text}</a></div>`);
}

const beButtons = (buttons) => beBlock('buttons', {}, '<div class="wp-block-buttons">', buttons, '</div>');

/** opts.layout: { type: 'constrained' } (default) | { type: 'flex', flexWrap: 'nowrap' } | { type: 'grid', columnCount: 3 }; opts.tagName: 'section' etc. */
function beGroup(inner, opts = {}) {
  const tagName = opts.tagName || 'div';
  const attrs = {};
  if (tagName !== 'div') attrs.tagName = tagName;
  attrs.layout = opts.layout || { type: 'constrained' };
  return beBlock('group', attrs, `<${tagName} class="wp-block-group">`, inner, `</${tagName}>`);
}

const beColumns = (columns) => beBlock('columns', {}, '<div class="wp-block-columns">', columns, '</div>');

/** opts.width: e.g. '33.33%' (omit for equal columns). */
function beColumn(inner, opts = {}) {
  if (opts.width) return beBlock('column', { width: opts.width }, `<div class="wp-block-column" style="flex-basis:${opts.width}">`, inner, '</div>');
  return beBlock('column', {}, '<div class="wp-block-column">', inner, '</div>');
}

/** items: array of HTML strings. */
function beList(items, opts = {}) {
  const tag = opts.ordered ? 'ol' : 'ul';
  const lis = items.map((html) => beBlock('list-item', {}, `<li>${html}</li>`));
  return beBlock('list', opts.ordered ? { ordered: true } : {}, `<${tag} class="wp-block-list">`, lis, `</${tag}>`);
}

/** Native <details> disclosure (core/details, WP 6.3+). `answer`: HTML string (one paragraph) or an array of blocks. */
function beDetails(summary, answer, opts = {}) {
  const inner = Array.isArray(answer) ? answer : [bePara(answer)];
  return beBlock('details', opts.open ? { showContent: true } : {},
    `<details class="wp-block-details"${opts.open ? ' open' : ''}><summary>${summary}</summary>`, inner, '</details>');
}

/** FAQ list: [{ q, a }] -> core/details blocks (first open unless opts.openFirst === false). */
function beFaq(items, opts = {}) {
  return items.map((it, i) => beDetails(it.q, it.a, { open: i === 0 && opts.openFirst !== false }));
}

const beSpacer = (height = '40px') => beBlock('spacer', { height }, `<div style="height:${height}" aria-hidden="true" class="wp-block-spacer"></div>`);
const beSeparator = () => beBlock('separator', {}, '<hr class="wp-block-separator has-alpha-channel-opacity"/>');

/** Custom HTML block — always valid (no save() comparison). The fallback, like Divi's Code module. */
const beHtml = (html) => beBlock('html', {}, html);

// ---------------------------------------------------------------------
// Rendering WXR
// ---------------------------------------------------------------------

/**
 * postmeta + terms for a new item, by target:
 *   'wp_block'          unsynced pattern (default; Patterns -> My patterns). opts.synced = true for a synced one.
 *                       opts.categories = ['hero'] -> wp_pattern_category terms.
 *   'page'              draft page. opts.template = a block-theme template slug, if not the default.
 *   'wp_template'       FSE template (post_name = slug, e.g. 'front-page'). Needs opts.themeSlug.
 *   'wp_template_part'  FSE template part. Needs opts.themeSlug; opts.area = 'header' | 'footer' | 'uncategorized'.
 */
function beItemDefaults(postType, opts = {}) {
  const meta = {};
  const terms = [];
  if (postType === 'wp_block') {
    if (!opts.synced) meta.wp_pattern_sync_status = 'unsynced';
    for (const c of opts.categories || []) terms.push({ domain: 'wp_pattern_category', nicename: c, name: c });
  }
  if (postType === 'page' && opts.template) meta._wp_page_template = opts.template;
  if (postType === 'wp_template' || postType === 'wp_template_part') {
    if (!opts.themeSlug) throw new Error(`${postType} needs opts.themeSlug (the active theme's folder name — see the catalog's SITE FACTS)`);
    terms.push({ domain: 'wp_theme', nicename: opts.themeSlug, name: opts.themeSlug });
    if (postType === 'wp_template_part') {
      const area = opts.area || 'uncategorized';
      terms.push({ domain: 'wp_template_part_area', nicename: area, name: area });
    }
  }
  return { meta, terms };
}

function renderPostmeta(meta) {
  return Object.entries(meta).map(([k, v]) => `\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata(k)}</wp:meta_key>
\t\t<wp:meta_value>${toCdata(v)}</wp:meta_value>
\t\t</wp:postmeta>`).join('\n');
}

/**
 * One `<item>`. opts: { post_id, post_name, title, content, post_type
 * ('wp_block' default), status, meta, terms, author_login, site_url,
 * pub_date, post_date }. Status defaults: page -> draft, everything else -> publish.
 */
function beRenderItem(opts) {
  const {
    post_id, post_name, title, content, author_login, site_url, pub_date, post_date,
    post_type = 'wp_block', status, meta = {}, terms = [],
  } = opts;
  const st = status || (post_type === 'page' || post_type === 'post' ? 'draft' : 'publish');
  const link = post_type === 'page' ? `${site_url}/?page_id=${post_id}` : `${site_url}/?post_type=${post_type}&p=${post_id}`;
  const cats = terms.map((t) => `\t\t<category domain="${xmlEscape(t.domain)}" nicename="${xmlEscape(t.nicename)}">${toCdata(t.name)}</category>`).join('\n');
  return `\t\t<item>
\t\t<title>${xmlEscape(title)}</title>
\t\t<link>${xmlEscape(link)}</link>
\t\t<pubDate>${xmlEscape(pub_date)}</pubDate>
\t\t<dc:creator>${toCdata(author_login)}</dc:creator>
\t\t<guid isPermaLink="false">${xmlEscape(link)}</guid>
\t\t<description></description>
\t\t<content:encoded>${toCdata(content)}</content:encoded>
\t\t<excerpt:encoded>${toCdata('')}</excerpt:encoded>
\t\t<wp:post_id>${post_id}</wp:post_id>
\t\t<wp:post_date>${toCdata(post_date)}</wp:post_date>
\t\t<wp:post_date_gmt>${toCdata(post_date)}</wp:post_date_gmt>
\t\t<wp:comment_status>${toCdata('closed')}</wp:comment_status>
\t\t<wp:ping_status>${toCdata('closed')}</wp:ping_status>
\t\t<wp:post_name>${toCdata(post_name)}</wp:post_name>
\t\t<wp:status>${toCdata(st)}</wp:status>
\t\t<wp:post_parent>0</wp:post_parent>
\t\t<wp:menu_order>0</wp:menu_order>
\t\t<wp:post_type>${toCdata(post_type)}</wp:post_type>
\t\t<wp:post_password>${toCdata('')}</wp:post_password>
\t\t<wp:is_sticky>0</wp:is_sticky>
${cats ? cats + '\n' : ''}${renderPostmeta(meta)}
\t\t</item>`;
}

/**
 * Media-library attachment. The WordPress importer downloads `source_url`,
 * re-hosts it, and rewrites every occurrence of that exact URL in the
 * imported post_content to the local copy — so the block's img src must
 * be byte-identical to `source_url` (enforced by beValidateImageUrls).
 */
function beRenderAttachmentItem(opts) {
  const { post_id, title, post_name, source_url, author_login, site_url, pub_date, post_date } = opts;
  const ext = opts.ext || (source_url.match(/\.(\w{3,4})(?:\?|#|$)/) || [, 'png'])[1];
  return `\t\t<item>
\t\t<title>${xmlEscape(title)}</title>
\t\t<link>${xmlEscape(site_url)}/${xmlEscape(post_name)}/</link>
\t\t<pubDate>${xmlEscape(pub_date)}</pubDate>
\t\t<dc:creator>${toCdata(author_login)}</dc:creator>
\t\t<guid isPermaLink="false">${xmlEscape(site_url)}/?attachment_id=${post_id}</guid>
\t\t<description></description>
\t\t<content:encoded>${toCdata('')}</content:encoded>
\t\t<excerpt:encoded>${toCdata('')}</excerpt:encoded>
\t\t<wp:post_id>${post_id}</wp:post_id>
\t\t<wp:post_date>${toCdata(post_date)}</wp:post_date>
\t\t<wp:post_date_gmt>${toCdata(post_date)}</wp:post_date_gmt>
\t\t<wp:comment_status>${toCdata('open')}</wp:comment_status>
\t\t<wp:ping_status>${toCdata('closed')}</wp:ping_status>
\t\t<wp:post_name>${toCdata(post_name)}</wp:post_name>
\t\t<wp:status>${toCdata('inherit')}</wp:status>
\t\t<wp:post_parent>0</wp:post_parent>
\t\t<wp:menu_order>0</wp:menu_order>
\t\t<wp:post_type>${toCdata('attachment')}</wp:post_type>
\t\t<wp:post_password>${toCdata('')}</wp:post_password>
\t\t<wp:is_sticky>0</wp:is_sticky>
\t\t<wp:attachment_url>${xmlEscape(source_url)}</wp:attachment_url>
\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata('_wp_attached_file')}</wp:meta_key>
\t\t<wp:meta_value>${toCdata(`figma-to-block-editor/${post_name}.${ext}`)}</wp:meta_value>
\t\t</wp:postmeta>
\t\t</item>`;
}

function beRenderWxrDocument(header, itemsXml, pubDate) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- This is a WordPress eXtended RSS file generated by the figma-to-block-editor skill. -->
<!-- It contains block-editor content (and its images), importable via Tools -> Import -> WordPress. -->
<rss version="2.0"
\txmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
\txmlns:content="http://purl.org/rss/1.0/modules/content/"
\txmlns:wfw="http://wellformedweb.org/CommentAPI/"
\txmlns:dc="http://purl.org/dc/elements/1.1/"
\txmlns:wp="http://wordpress.org/export/1.2/"
>

<channel>
\t<title>${xmlEscape(header.site_title)}</title>
\t<link>${xmlEscape(header.site_url)}</link>
\t<description></description>
\t<pubDate>${xmlEscape(pubDate)}</pubDate>
\t<language>${xmlEscape(header.language)}</language>
\t<wp:wxr_version>${xmlEscape(header.wxr_version)}</wp:wxr_version>
\t<wp:base_site_url>${xmlEscape(header.base_site_url)}</wp:base_site_url>
\t<wp:base_blog_url>${xmlEscape(header.base_blog_url)}</wp:base_blog_url>

\t<wp:author><wp:author_id>1</wp:author_id><wp:author_login>${toCdata(header.author_login)}</wp:author_login><wp:author_email>${toCdata(header.author_email)}</wp:author_email><wp:author_display_name>${toCdata(header.author_display_name)}</wp:author_display_name><wp:author_first_name>${toCdata(header.author_first_name)}</wp:author_first_name><wp:author_last_name>${toCdata(header.author_last_name)}</wp:author_last_name></wp:author>

${itemsXml}
</channel>
</rss>
`;
}

function beExtractRawItems(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return extractItemBlocks(xml).map((body) => `\t\t<item>${body}</item>`);
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

/** Core blocks that only work directly inside a given parent. */
const REQUIRED_PARENT = {
  column: ['columns'],
  'list-item': ['list'],
  button: ['buttons'],
  'social-link': ['social-links'],
  'navigation-link': ['navigation', 'navigation-submenu'],
  'navigation-submenu': ['navigation'],
};

/**
 * Consistency check on an edited/fresh block: do the comment attrs imply
 * classes/styles/tags its HTML lacks? These are exactly the mismatches
 * that make the editor flag a block as invalid. Only run on blocks whose
 * attrs changed (untouched mined blocks already validate on the site).
 */
function checkAttrHtml(n) {
  const problems = [];
  const name = shortName(n.name);
  const own = n.children.filter((c) => c.kind === 'text').map((c) => c.text).join('');
  const wrapper = findTag(n);
  if (!wrapper) return problems; // dynamic/void block with no saved HTML
  const wrapperClasses = (parseAttrs(wrapper.open).class || '').split(/\s+/);
  const need = [];
  if (n.attrs.className) need.push(...n.attrs.className.split(/\s+/));
  const isCore = !n.name.includes('/') || n.name.startsWith('core/');
  if (isCore) {
    if (n.attrs.align) need.push(name === 'paragraph' ? `has-text-align-${n.attrs.align}` : `align${n.attrs.align}`);
    if (n.attrs.textAlign) need.push(`has-text-align-${n.attrs.textAlign}`);
    if (name === 'image' && n.attrs.style && n.attrs.style.border) need.push('has-custom-border');
  }
  for (const c of need) if (!wrapperClasses.includes(c)) problems.push(`class "${c}" is in attrs but missing on the wrapper <${wrapper.tag}>`);
  if (!isCore) return problems; // third-party blocks reuse attr names (textColor: '#fff', …) with their own meaning
  const presetClass = { textColor: (v) => `has-${v}-color`, backgroundColor: (v) => `has-${v}-background-color`, fontSize: (v) => `has-${v}-font-size`, gradient: (v) => `has-${v}-gradient-background`, borderColor: (v) => `has-${v}-border-color` };
  for (const [k, fn] of Object.entries(presetClass)) {
    if (n.attrs[k] && !new RegExp(`class="[^"]*\\b${fn(n.attrs[k])}\\b`).test(own)) problems.push(`${k}="${n.attrs[k]}" but no ${fn(n.attrs[k])} class in the HTML`);
  }
  if (name === 'heading') {
    const level = n.attrs.level || 2;
    if (wrapper.tag !== `h${level}`) problems.push(`level ${level} but the HTML is <${wrapper.tag}>`);
  }
  const { decl } = styleToCss(n.attrs.style);
  const allStyles = [...own.matchAll(/style="([^"]*)"/g)].map((m) => parseStyleAttr(m[1]));
  for (const [prop, val] of Object.entries(decl)) {
    if (!allStyles.some((s) => s[prop] === val)) problems.push(`style ${prop}:${val} is in attrs.style but not in the HTML`);
  }
  return problems;
}

function beValidateTree(tree) {
  const errors = [];
  const warnings = [];
  if (tree.unclosed && tree.unclosed.length) errors.push(`Unclosed blocks: ${tree.unclosed.join(', ')}`);
  if (tree.strays && tree.strays.length) errors.push(`Closing comments with no opener: ${tree.strays.join(', ')}`);
  for (const t of tree.children) {
    if (t.kind === 'text' && t.text.trim()) warnings.push(`HTML outside any block becomes a Classic block: ${JSON.stringify(t.text.trim().slice(0, 60))}`);
  }
  beWalk(tree, (n, p, parent) => {
    const name = shortName(n.name);
    const at = `${n.name} at ${p.join('.')}`;
    const need = REQUIRED_PARENT[name];
    if (need && !(parent && need.includes(shortName(parent.name)))) errors.push(`${at} must sit directly inside ${need.join('/')}`);
    if (n.attrs.ref && ['block', 'navigation', 'template-part'].includes(name)) warnings.push(`${at} references post ${n.attrs.ref} — that id must exist on the target site`);
    if (n._rawOpen && n._rawOpenAttrs === JSON.stringify(n.attrs)) return; // untouched mined block
    for (const prob of checkAttrHtml(n)) errors.push(`${at}: ${prob} — the editor would show it as invalid`);
  });
  return { errors, warnings };
}

function collectUrls(content) {
  const decoded = content.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>()\]\[\\,]+/g;
  let m;
  while ((m = re.exec(decoded))) urls.add(m[0].replace(/[.;]+$/, ''));
  return [...urls];
}

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;
const FIGMA_ASSET_RE = /figma\.com\/api\/mcp\/asset\/|figma-alpha-api\.s3|s3-(?:us-west-2|alpha)\.amazonaws\.com\/figma/i;

/** Every image-looking or Figma-hosted URL must be on the site's host or backed by an attachment item with the identical URL. */
function beValidateImageUrls(content, attachmentUrls, siteUrl) {
  const siteHost = siteUrl ? (() => { try { return new URL(siteUrl).host; } catch (e) { return ''; } })() : '';
  const problems = [];
  for (const url of collectUrls(content)) {
    if (!IMAGE_URL_RE.test(url) && !FIGMA_ASSET_RE.test(url)) continue;
    let host = '';
    try { host = new URL(url).host; } catch (e) { /* malformed -> external */ }
    if (siteHost && host === siteHost) continue;
    if (attachmentUrls.has(url)) continue;
    problems.push(`${url} is used but has no attachment item with that exact URL — it would be hotlinked${FIGMA_ASSET_RE.test(url) ? ' (and Figma asset URLs expire)' : ''}. Add beRenderAttachmentItem({ source_url: <this exact URL>, ... }).`);
  }
  return problems;
}

/**
 * Run at the end of every build script. Throws on:
 *   well-formedness, parse round-trip, unclosed/stray block comments,
 *   parent rules, attr<->HTML mismatches on edited blocks, the image trap,
 *   duplicate post ids, templates/parts without a wp_theme term.
 * Returns [{ title, postType, blockCount, warnings }].
 */
function beValidateWxrFile(outPath) {
  const xml = fs.readFileSync(outPath, 'utf8');
  const wellFormed = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (wellFormed !== true) throw new Error(`WXR file is not well-formed XML: ${JSON.stringify(wellFormed)}`);

  const channelMatch = /<channel>([\s\S]*?)<item>/.exec(xml);
  const siteUrl = channelMatch ? extractTag(channelMatch[1], 'link') : '';
  const blocks = extractItemBlocks(xml);
  const attachmentUrls = new Set(blocks.filter((b) => extractTag(b, 'wp:post_type') === 'attachment').map((b) => extractTag(b, 'wp:attachment_url')));

  const results = [];
  const errors = [];
  const seenIds = new Set();
  for (const block of blocks) {
    const id = extractTag(block, 'wp:post_id');
    if (seenIds.has(id)) errors.push(`Duplicate wp:post_id ${id}`);
    seenIds.add(id);
    const postType = extractTag(block, 'wp:post_type');
    if (postType === 'attachment') continue;
    const title = extractTag(block, 'title');
    const label = `"${title}" (post_id ${id})`;
    const content = extractTag(block, 'content:encoded');
    if (!hasBlocks(content)) { errors.push(`${label}: no block markup`); continue; }

    // The written file can't tell edited blocks from untouched ones, so the attr<->HTML check runs on every block.
    const tree = beParse(content);
    if (beSerialize(tree) !== content) errors.push(`${label}: content does not round-trip through the parser — malformed markup`);
    beWalk(tree, (n) => { delete n._rawOpen; });
    const { errors: treeErrors, warnings } = beValidateTree(tree);
    treeErrors.forEach((e) => errors.push(`${label}: ${e}`));
    beValidateImageUrls(content, attachmentUrls, siteUrl).forEach((p) => errors.push(`${label}: ${p}`));

    if ((postType === 'wp_template' || postType === 'wp_template_part') && !extractTerms(block).some((t) => t.domain === 'wp_theme')) {
      errors.push(`${label}: ${postType} without a wp_theme term — WordPress would not attach it to any theme`);
    }
    let blockCount = 0;
    beWalk(tree, () => { blockCount++; });
    results.push({ title, postType, blockCount, warnings });
  }
  if (!results.length) errors.push('No block content items found in output file');
  if (errors.length) throw new Error(`Block-editor WXR validation failed (${errors.length} issue(s)):\n` + errors.map((e) => `  - ${e}`).join('\n'));
  return results;
}

module.exports = {
  beExtractAllContent, beExtractGlobalStyles, beExtractAttachments, beExtractSiteHeader, beMaxPostId,
  beParse, beSerialize, beWalk, beFindAll, beGetByPath, beCollectPaths, beClone,
  beGetAttr, beSetAttr, beSetText, beSetHtmlAttr, beAddClass, beSetImage, beStyle, bePreset, beRenameId,
  beBlock, bePara, beHeading, beImage, beButton, beButtons, beGroup, beColumns, beColumn,
  beList, beDetails, beFaq, beSpacer, beSeparator, beHtml,
  beItemDefaults, beRenderItem, beRenderAttachmentItem, beRenderWxrDocument, beExtractRawItems,
  beValidateTree, beValidateImageUrls, beValidateWxrFile,
  styleToCss, elementChildren, shortName, toCdata, xmlEscape, htmlEscape,
};
