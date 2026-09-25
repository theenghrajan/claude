'use strict';
/**
 * Core helper library for the figma-to-divi-builder skill.
 *
 * Divi does not store layouts the way Beaver Builder does. There is no
 * PHP-serialized node tree in postmeta; the layout IS the post's
 * `post_content` (WXR `<content:encoded>`), in one of two formats:
 *
 *   - Divi 4 ("shortcode"): nested shortcodes
 *       [et_pb_section ...][et_pb_row ...][et_pb_column type="4_4" ...]
 *         [et_pb_text ...]<p>Hi</p>[/et_pb_text]
 *       [/et_pb_column][/et_pb_row][/et_pb_section]
 *   - Divi 5 ("block"): WordPress block-comment markup
 *       <!-- wp:divi/section {...json...} --> ... <!-- /wp:divi/section -->
 *
 * Both are parsed into the same generic, lossless node tree so build
 * scripts can clone real, already-working nodes out of a site's own export:
 *
 *   { kind: 'shortcode', tag, attrs: {k: encodedValue}, children: [...], selfClosing }
 *   { kind: 'block',     name, attrs: {...json...},    children: [...], selfClosing }
 *   { kind: 'text',      text }
 *
 * A "tree" is just `{ format, children }`. dvSerialize(dvParse(x)) === x for
 * every well-formed input — dvValidateWxrFile checks exactly that.
 *
 * Public API (see each function's comment):
 *   dvExtractAllLayouts(xmlPath)   -> [{ postId, postName, title, postType, status, format, content, tree, meta, terms }]
 *   dvExtractSiteHeader(xmlPath)   -> { site_title, site_url, author_login, ... }
 *   dvItemDefaultsFromExport(layouts, postType) -> { meta, terms } copied from a real item of that type
 *   dvParse / dvSerialize / dvDetectFormat
 *   dvWalk / dvFindAll / dvGetByPath / dvClone / dvCollectPaths
 *   dvGetAttr / dvSetAttr / dvSetText / dvShortcode / dvSyncColumnStructure
 *   dvEncodeAttr / dvDecodeAttr
 *   dvCodeModule / dvAccordionHtml / dvAccordionModule
 *   dvRenderItem / dvRenderAttachmentItem / dvRenderWxrDocument / dvExtractRawItems
 *   dvValidateTree / dvValidateImageUrls / dvValidateWxrFile
 */

const fs = require('fs');
const { XMLValidator } = require('fast-xml-parser');

// ---------------------------------------------------------------------
// CDATA / XML helpers (same conventions as figma-to-beaver-builder)
// ---------------------------------------------------------------------

/** Concatenate all `<![CDATA[...]]>` chunks inside a captured tag body (handles WP's `]]>`-splitting). */
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

/** Wrap arbitrary text in one or more CDATA sections, safely escaping any literal `]]>`. */
function toCdata(str) {
  return '<![CDATA[' + String(str).split(']]>').join(']]]]><![CDATA[>') + ']]>';
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
// Mining: pull real layouts + site header out of a WXR export
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
  while ((m = catRe.exec(block))) {
    terms.push({ domain: m[1], nicename: m[2], name: joinCdataChunks(m[3]) });
  }
  return terms;
}

/** 'shortcode' (Divi 4), 'block' (Divi 5), or null if the content has no Divi markup at all. */
function dvDetectFormat(content) {
  if (/<!--\s*wp:divi\//.test(content)) return 'block';
  if (/\[et_pb_section[\s\]]/.test(content)) return 'shortcode';
  return null;
}

/**
 * Every item in the export whose post_content holds Divi layout markup —
 * Divi Library items (`et_pb_layout`), Theme Builder layouts
 * (`et_header_layout`/`et_body_layout`/`et_footer_layout`), and any
 * page/post/project built with the Divi Builder. Unlike Beaver Builder,
 * real Divi content usually lives mostly on the site's *pages*, not in
 * the library, so all post types are mined.
 */
function dvExtractAllLayouts(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const layouts = [];
  for (const block of extractItemBlocks(xml)) {
    const postType = extractTag(block, 'wp:post_type');
    if (postType === 'attachment' || postType === 'revision' || postType === 'nav_menu_item') continue;
    const content = extractTag(block, 'content:encoded');
    const format = dvDetectFormat(content);
    if (!format) continue;
    layouts.push({
      postId: parseInt(extractTag(block, 'wp:post_id'), 10),
      postName: extractTag(block, 'wp:post_name'),
      title: extractTag(block, 'title').trim(),
      postType,
      status: extractTag(block, 'wp:status'),
      format,
      content,
      tree: dvParse(content, format),
      meta: extractAllPostMeta(block),
      terms: extractTerms(block),
    });
  }
  return layouts;
}

/** Every attachment already in the export: { postId, url }. Used to tell already-hosted images from new ones. */
function dvExtractAttachments(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const out = [];
  for (const block of extractItemBlocks(xml)) {
    if (extractTag(block, 'wp:post_type') !== 'attachment') continue;
    out.push({ postId: parseInt(extractTag(block, 'wp:post_id'), 10), url: extractTag(block, 'wp:attachment_url') });
  }
  return out;
}

/** Highest wp:post_id used anywhere in the export (pick new ids well above this). */
function dvMaxPostId(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  let max = 0;
  const re = /<wp:post_id>(\d+)<\/wp:post_id>/g;
  let m;
  while ((m = re.exec(xml))) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

/** Channel-level site identity (title/url/author) so nothing is ever hardcoded. */
function dvExtractSiteHeader(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const channelMatch = /<channel>([\s\S]*?)<item>/.exec(xml);
  const channelBlock = channelMatch ? channelMatch[1] : xml;
  const authorMatch = /<wp:author>([\s\S]*?)<\/wp:author>/.exec(xml);
  const authorBlock = authorMatch ? authorMatch[1] : '';
  return {
    site_title: extractTag(channelBlock, 'title'),
    site_url: extractTag(channelBlock, 'link'),
    language: extractTag(channelBlock, 'language') || 'en-US',
    wxr_version: extractTag(channelBlock, 'wp:wxr_version') || '1.2',
    base_site_url: extractTag(channelBlock, 'wp:base_site_url'),
    base_blog_url: extractTag(channelBlock, 'wp:base_blog_url'),
    author_login: extractTag(authorBlock, 'wp:author_login'),
    author_email: extractTag(authorBlock, 'wp:author_email'),
    author_display_name: extractTag(authorBlock, 'wp:author_display_name'),
    author_first_name: extractTag(authorBlock, 'wp:author_first_name'),
    author_last_name: extractTag(authorBlock, 'wp:author_last_name'),
  };
}

/** Per-post meta that must never be copied onto a new item (caches, A/B data, revisions of *that* post). */
const NON_COPYABLE_META = /^(_et_pb_old_content|_et_dynamic_cached_|_et_pb_ab_|_et_pb_first_image|_et_pb_truncate_post|_et_pb_truncate_post_date|_et_builder_dynamic_assets_loading_attr_threshold|_edit_lock|_edit_last|_thumbnail_id|_wp_old_slug|_wp_old_date)/;

/**
 * Copy the Divi-specific postmeta (`_et_*`, `_wp_page_template`) and the
 * Divi taxonomy terms from a real item of `postType` in this site's own
 * export, so the new item carries exactly what this site's Divi version
 * writes, not a hardcoded guess. Returns { meta, terms, sourcePostId }.
 * Falls back to the minimum Divi needs (`_et_pb_use_builder=on`) when the
 * export has no item of that type.
 *
 * For Divi Library items the `scope` and `layout_type` terms are never
 * copied, because they describe the *source* item. A new item is always
 * `scope=non_global` (a global item syncs edits across every page using
 * it) with `layout_type=opts.layoutType` ('layout' by default, or
 * 'section' / 'row' / 'module' for a single saved section/row/module).
 */
function dvItemDefaultsFromExport(layouts, postType, opts = {}) {
  const layoutType = opts.layoutType || 'layout';
  const src = layouts.find((l) => l.postType === postType && l.status === 'publish') ||
    layouts.find((l) => l.postType === postType);
  const meta = {};
  const terms = [];
  if (src) {
    for (const [k, v] of Object.entries(src.meta)) {
      if (!/^_et_|^_wp_page_template$/.test(k)) continue;
      if (NON_COPYABLE_META.test(k)) continue;
      meta[k] = v;
    }
    for (const t of src.terms) {
      // Divi Library taxonomies; layout_category/layout_tag are the source item's own filing, not copied.
      if (['module_width', 'layout_pack'].includes(t.domain)) terms.push({ ...t });
    }
  }
  if (!meta._et_pb_use_builder) meta._et_pb_use_builder = 'on';
  if (postType === 'et_pb_layout') {
    terms.push({ domain: 'layout_type', nicename: layoutType, name: layoutType });
    terms.push({ domain: 'scope', nicename: 'non_global', name: 'non_global' });
    if (!terms.some((t) => t.domain === 'module_width')) terms.push({ domain: 'module_width', nicename: 'regular', name: 'regular' });
    if (!meta._et_pb_built_for_post_type) meta._et_pb_built_for_post_type = 'page';
  }
  return { meta, terms, sourcePostId: src ? src.postId : null };
}

// ---------------------------------------------------------------------
// Divi 4 shortcode attribute encoding
// ---------------------------------------------------------------------

/**
 * Divi 4 never writes a raw `"`, `[`, `]` or `\` inside a shortcode
 * attribute value — they would end the attribute/shortcode early. The
 * Visual Builder encodes them as below (visible in real exports, e.g.
 * `global_colors_info="{%22gcid-...%22:%91%22...%22%93}"`). Run the
 * Phase 1 catalog's "encoded tokens seen" summary to confirm on each site.
 */
const ATTR_ENCODING = [
  ['\\', '%92'],
  ['"', '%22'],
  ['[', '%91'],
  [']', '%93'],
];

function dvEncodeAttr(plain) {
  let s = String(plain);
  for (const [raw, enc] of ATTR_ENCODING) s = s.split(raw).join(enc);
  return s;
}

function dvDecodeAttr(encoded) {
  let s = String(encoded);
  for (const [raw, enc] of [...ATTR_ENCODING].reverse()) s = s.split(enc).join(raw);
  return s;
}

// ---------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------

/** Divi's code-module newline placeholder — looks like a shortcode but is plain text. */
const LINE_BREAK_HOLDER = '[et_pb_line_break_holder]';

function parseShortcodeAttrs(raw) {
  const attrs = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'|([\w-]+)\s*=\s*([^\s'"\]]+)|"([^"]*)"|(\S+)/g;
  let m;
  let positional = 0;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) attrs[m[1]] = m[2];
    else if (m[3] !== undefined) attrs[m[3]] = m[4];
    else if (m[5] !== undefined) attrs[m[5]] = m[6];
    else if (m[7] !== undefined) attrs[`__pos${positional++}`] = m[7];
    else if (m[8] !== undefined && m[8] !== '/') attrs[`__pos${positional++}`] = m[8];
  }
  return attrs;
}

/**
 * Parse Divi 4 shortcode content. A tag is a container only if a matching
 * `[/tag]` exists later; otherwise it is kept as a void (self-closing) node.
 * Tags must start with a letter, so `[1]`-style footnotes stay plain text.
 */
function parseShortcodes(content) {
  const tagRe = /\[(\/)?([a-zA-Z][\w-]*)((?:[^\]"']|"[^"]*"|'[^']*')*?)(\/)?\]/g;
  const tokens = [];
  let last = 0;
  let m;
  while ((m = tagRe.exec(content))) {
    if (m[0] === LINE_BREAK_HOLDER) continue;
    if (m.index > last) tokens.push({ t: 'text', text: content.slice(last, m.index) });
    tokens.push({ t: m[1] ? 'close' : 'open', tag: m[2], rawAttrs: m[3], selfClosing: !!m[4], raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < content.length) tokens.push({ t: 'text', text: content.slice(last) });

  // A tag name is a container if any close tag for it follows the open.
  const closeCountAfter = new Map();
  const hasCloseAfter = new Array(tokens.length).fill(false);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (tok.t === 'close') closeCountAfter.set(tok.tag, (closeCountAfter.get(tok.tag) || 0) + 1);
    if (tok.t === 'open') hasCloseAfter[i] = (closeCountAfter.get(tok.tag) || 0) > 0;
  }

  const root = { kind: 'root', children: [] };
  const stack = [root];
  const strays = [];
  tokens.forEach((tok, i) => {
    const parent = stack[stack.length - 1];
    if (tok.t === 'text') {
      const prev = parent.children[parent.children.length - 1];
      if (prev && prev.kind === 'text') prev.text += tok.text;
      else parent.children.push({ kind: 'text', text: tok.text });
      return;
    }
    if (tok.t === 'open') {
      const node = { kind: 'shortcode', tag: tok.tag, attrs: parseShortcodeAttrs(tok.rawAttrs), children: [], selfClosing: tok.selfClosing };
      node._rawOpen = tok.raw;
      parent.children.push(node);
      if (!tok.selfClosing && hasCloseAfter[i]) stack.push(node);
      else node.void = true;
      return;
    }
    // close
    let idx = stack.length - 1;
    while (idx > 0 && stack[idx].tag !== tok.tag) idx--;
    if (idx === 0) {
      strays.push(tok.raw);
      parent.children.push({ kind: 'text', text: tok.raw });
      return;
    }
    stack.length = idx;
  });
  const unclosed = stack.slice(1).map((n) => n.tag);
  return { children: root.children, unclosed, strays };
}

/**
 * Parse Divi 5 / WordPress block-comment markup
 * (`<!-- wp:ns/name {json} -->…<!-- /wp:ns/name -->` or `<!-- wp:ns/name {json} /-->`).
 */
function parseBlocks(content) {
  const re = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(\{[\s\S]*?\}\s+)?(\/)?-->/g;
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
  while ((m = re.exec(content))) {
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
    const node = { kind: 'block', name, attrs, children: [], selfClosing: !!selfClose };
    node._rawOpen = m[0];
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  pushText(content.slice(last));
  const unclosed = stack.slice(1).map((n) => n.name);
  return { children: root.children, unclosed, strays };
}

/** Parse Divi content into a tree `{ format, children, unclosed, strays }`. */
function dvParse(content, format) {
  const fmt = format || dvDetectFormat(content) || 'shortcode';
  const parsed = fmt === 'block' ? parseBlocks(content) : parseShortcodes(content);
  snapshotRawAttrs(parsed.children);
  return { format: fmt, ...parsed };
}

// ---------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------

/** WordPress's own serialize_block_attributes() escaping, so the block parser never sees `--` or `-->` inside JSON. */
function serializeBlockAttributes(attrs) {
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

function serializeShortcodeOpen(node) {
  const parts = [node.tag];
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k.startsWith('__pos')) parts.push(/\s/.test(v) ? `"${v}"` : v);
    else parts.push(`${k}="${v}"`);
  }
  return `[${parts.join(' ')}${node.selfClosing ? ' /' : ''}]`;
}

function serializeNodes(children) {
  let out = '';
  for (const n of children) {
    if (n.kind === 'text') { out += n.text; continue; }
    if (n.kind === 'shortcode') {
      // Untouched nodes re-emit their original open tag byte-for-byte (keeps round-trips exact).
      const open = n._rawOpen && n._rawOpenAttrs === JSON.stringify(n.attrs) ? n._rawOpen : serializeShortcodeOpen(n);
      out += open;
      if (n.void || n.selfClosing) continue;
      out += serializeNodes(n.children) + `[/${n.tag}]`;
      continue;
    }
    if (n.kind === 'block') {
      const hasAttrs = n.attrs && Object.keys(n.attrs).length > 0;
      const fresh = `<!-- wp:${n.name} ${hasAttrs ? serializeBlockAttributes(n.attrs) + ' ' : ''}${n.selfClosing ? '/' : ''}-->`;
      const open = n._rawOpen && n._rawOpenAttrs === JSON.stringify(n.attrs) ? n._rawOpen : fresh;
      out += open;
      if (n.selfClosing) continue;
      out += serializeNodes(n.children) + `<!-- /wp:${n.name} -->`;
    }
  }
  return out;
}

/** Serialize a tree (from dvParse, or hand-assembled `{ format, children }`) back to post_content. */
function dvSerialize(tree) {
  return serializeNodes(tree.children);
}

// Record each parsed node's original attrs so serializeNodes can tell whether it was edited.
function snapshotRawAttrs(children) {
  for (const n of children) {
    if (n.kind === 'shortcode' || n.kind === 'block') {
      n._rawOpenAttrs = JSON.stringify(n.attrs);
      snapshotRawAttrs(n.children);
    }
  }
}

// ---------------------------------------------------------------------
// Tree navigation & manipulation
// ---------------------------------------------------------------------

function nodeName(n) {
  return n.kind === 'shortcode' ? n.tag : n.kind === 'block' ? n.name : '#text';
}

/** Depth-first walk over element nodes (text nodes skipped). cb(node, path, parent). */
function dvWalk(nodes, cb, path = [], parent = null) {
  const list = Array.isArray(nodes) ? nodes : nodes.children;
  let i = 0;
  for (const n of list) {
    if (n.kind === 'text') continue;
    const p = [...path, i];
    cb(n, p, parent);
    dvWalk(n.children, cb, p, n);
    i++;
  }
}

/** Element children only (text/whitespace between tags skipped). */
function elementChildren(node) {
  return (node.children || []).filter((c) => c.kind !== 'text');
}

/** Get the node at an element-index path, e.g. [0, 1, 0] = 1st section -> 2nd row -> 1st column. Paths are what the catalog prints. */
function dvGetByPath(tree, path) {
  let cur = { children: tree.children };
  for (const i of path) {
    cur = elementChildren(cur)[i];
    if (!cur) throw new Error(`No node at path ${path.join('.')}`);
  }
  return cur;
}

function dvFindAll(tree, pred) {
  const out = [];
  dvWalk(tree, (n, p) => { if (pred(n, p)) out.push(n); });
  return out;
}

/** List every node with its path + name (debug aid). */
function dvCollectPaths(tree) {
  const out = [];
  dvWalk(tree, (n, p) => out.push({ path: p.join('.'), name: nodeName(n) }));
  return out;
}

/**
 * Attributes that tie a node to *another* post (a global Library item) or
 * to Divi's global-module sync. A clone that keeps these is not a copy — it
 * becomes (or points at) the original global item, and editing it edits
 * every page using it. Stripped by default in dvClone.
 */
const GLOBAL_LINK_ATTRS = ['global_module', 'global_parent', 'saved_tabs', 'template_type'];

/** Deep clone a node (edits to the clone never touch the mined original). Strips global-module links unless opts.keepGlobal. */
function dvClone(node, opts = {}) {
  const copy = JSON.parse(JSON.stringify(node, (k, v) => (k === '_rawOpen' || k === '_rawOpenAttrs' ? undefined : v)));
  if (!opts.keepGlobal) {
    const strip = (n) => {
      if (n.kind === 'shortcode') for (const a of GLOBAL_LINK_ATTRS) delete n.attrs[a];
      if (n.kind === 'block' && n.attrs) {
        delete n.attrs.globalModule;
        delete n.attrs.globalParent;
      }
      (n.children || []).forEach(strip);
    };
    strip(copy);
  }
  return copy;
}

/**
 * Read an attribute. Shortcodes: decoded plain value. Blocks: a dot path
 * into the JSON attrs (e.g. 'content.innerContent.desktop.value' — take the
 * real path from the catalog, don't assume it).
 */
function dvGetAttr(node, key) {
  if (node.kind === 'shortcode') return node.attrs[key] === undefined ? undefined : dvDecodeAttr(node.attrs[key]);
  let cur = node.attrs;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Set an attribute (shortcode: plain value, encoded for you; block: dot path, intermediate objects created). `undefined` deletes. */
function dvSetAttr(node, key, value) {
  if (node.kind === 'shortcode') {
    if (value === undefined) delete node.attrs[key];
    else node.attrs[key] = dvEncodeAttr(value);
    return node;
  }
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

/**
 * Replace a Divi 4 container module's inner content (et_pb_text body,
 * et_pb_blurb/et_pb_toggle/et_pb_cta description, ...). `html` must not
 * contain `[`/`]` — they are escaped to `&#91;`/`&#93;` so WordPress does
 * not try to run them as shortcodes. For Divi 5 blocks, content lives in
 * the JSON attrs — use dvSetAttr with the path shown in the catalog.
 */
function dvSetText(node, html) {
  if (node.kind !== 'shortcode') throw new Error('dvSetText is for Divi 4 shortcodes; for Divi 5 blocks set the content attr path with dvSetAttr');
  node.children = [{ kind: 'text', text: String(html).replace(/\[/g, '&#91;').replace(/\]/g, '&#93;') }];
  node.void = false;
  node.selfClosing = false;
  return node;
}

/** Construct a fresh Divi 4 shortcode node. `attrs` are plain values (encoded for you). `children`: nodes or an HTML string. */
function dvShortcode(tag, attrs = {}, children = []) {
  const node = { kind: 'shortcode', tag, attrs: {}, children: [], selfClosing: false };
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.attrs[k] = dvEncodeAttr(v);
  if (typeof children === 'string') dvSetText(node, children);
  else node.children = children;
  return node;
}

/** Recompute an et_pb_row / et_pb_row_inner `column_structure` from its columns' `type` attrs (call after adding/removing columns). */
function dvSyncColumnStructure(row) {
  if (row.kind !== 'shortcode') return row;
  const types = elementChildren(row)
    .filter((c) => c.tag === 'et_pb_column' || c.tag === 'et_pb_column_inner')
    .map((c) => dvDecodeAttr(c.attrs.type || '4_4'));
  if (row.attrs.column_structure !== undefined || types.length > 1) row.attrs.column_structure = dvEncodeAttr(types.join(','));
  return row;
}

// ---------------------------------------------------------------------
// Interactive modules & HTML fallback
// ---------------------------------------------------------------------

/**
 * Turn a clone of a real module into a Divi 4 core Code module
 * (`et_pb_code`, ships with every Divi install) holding `html`. The
 * cloned module's design attrs (spacing, visibility, custom CSS classes,
 * _builder_version) are kept; module-specific attrs are harmless leftovers.
 * Pass `tpl = null` to build a bare one.
 *
 * Newlines are collapsed to Divi's `<!-- [et_pb_line_break_holder] -->`
 * placeholder (what the Visual Builder itself writes), and `[`/`]` are
 * escaped, so nothing in the HTML can be mistaken for a shortcode.
 */
function dvCodeModule(tpl, html) {
  const mod = tpl ? dvClone(tpl) : dvShortcode('et_pb_code', {});
  mod.tag = 'et_pb_code';
  const body = String(html)
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\r?\n/g, '<!-- [et_pb_line_break_holder] -->');
  mod.children = [{ kind: 'text', text: body }];
  mod.void = false;
  mod.selfClosing = false;
  return mod;
}

/**
 * Self-contained `<details>/<summary>` FAQ accordion for dvCodeModule —
 * the LAST-resort fallback. Divi core already ships real accordion,
 * toggle and tabs modules (see dvAccordionModule), so this is only for a
 * design those cannot express. The CSS uses no attribute selectors
 * (`[open]` would be read as a shortcode); the open-state icon uses the
 * `:open` pseudo-class and simply stays "+" in browsers without it.
 * `items`: [{ q, a }] (a may be HTML).
 */
function dvAccordionHtml(items, opts = {}) {
  const openFirst = opts.openFirst !== false;
  const c = opts.wrapClass || 'f2d-accordion';
  const accent = opts.accentColor || '#2ea3f2'; // Divi's stock accent — override with the site's real brand color
  const rows = items.map((item, i) =>
    `<details class="${c}-item"${i === 0 && openFirst ? ' open' : ''}><summary class="${c}-q"><span>${xmlEscape(item.q)}</span><i class="${c}-icon" aria-hidden="true"></i></summary><div class="${c}-a">${item.a || ''}</div></details>`
  ).join('');
  const css = [
    `.${c}-item{border:1px solid rgba(0,0,0,.12);border-radius:6px;padding:0 20px;margin-bottom:12px}`,
    `.${c}-q{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;font-weight:600;font-size:18px}`,
    `.${c}-q::-webkit-details-marker{display:none}`,
    `.${c}-icon{position:relative;flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:${accent}}`,
    `.${c}-icon::before,.${c}-icon::after{content:'';position:absolute;background:#fff;top:50%;left:50%;transform:translate(-50%,-50%)}`,
    `.${c}-icon::before{width:12px;height:2px}`,
    `.${c}-icon::after{width:2px;height:12px}`,
    `.${c}-item:open .${c}-icon::after{opacity:0}`,
    `.${c}-a{padding:0 0 18px;line-height:1.6}`,
  ].join('');
  return `<div class="${c}"><style>${css}</style>${rows}</div>`;
}

/**
 * Build a Divi 4 core Accordion (`et_pb_accordion` > `et_pb_accordion_item`)
 * or Toggle list — real JS expand/collapse that ships with Divi itself.
 *
 * Prefer `tpl` = a real et_pb_accordion mined from this site: its first
 * item is used as the per-item template so every design attr (colors,
 * fonts, borders, icon) carries over, and only `title` + body change.
 * With `tpl = null`, only content attrs are written (`title`, `open`) and
 * everything visual falls back to the site's Divi defaults/presets —
 * report that as Medium confidence.
 * `faqs`: [{ q, a }]. `opts.openFirst` (default true).
 */
function dvAccordionModule(tpl, faqs, opts = {}) {
  const openFirst = opts.openFirst !== false;
  const acc = tpl ? dvClone(tpl) : dvShortcode('et_pb_accordion', {});
  const itemTpl = tpl ? elementChildren(tpl).find((c) => c.tag === 'et_pb_accordion_item') : null;
  acc.children = faqs.map((f, i) => {
    const item = itemTpl ? dvClone(itemTpl) : dvShortcode('et_pb_accordion_item', {});
    dvSetAttr(item, 'title', f.q);
    dvSetAttr(item, 'open', i === 0 && openFirst ? 'on' : 'off');
    return dvSetText(item, f.a || '');
  });
  acc.void = false;
  return acc;
}

// ---------------------------------------------------------------------
// Rendering: wrap new content into a standalone importable WXR file
// ---------------------------------------------------------------------

function renderPostmeta(meta) {
  return Object.entries(meta).map(([k, v]) => `\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata(k)}</wp:meta_key>
\t\t<wp:meta_value>${toCdata(v)}</wp:meta_value>
\t\t</wp:postmeta>`).join('\n');
}

/**
 * Render one `<item>` holding Divi content.
 * opts: { post_id, post_name, title, content (serialized post_content),
 *         post_type ('et_pb_layout' default | 'page' | ...), status
 *         ('publish' for library items, 'draft' recommended for pages),
 *         meta {}, terms [{domain, nicename, name}], author_login,
 *         site_url, pub_date, post_date }
 * Get `meta`/`terms` from dvItemDefaultsFromExport so they match what this
 * site's Divi version actually writes.
 */
function dvRenderItem(opts) {
  const {
    post_id, post_name, title, content, author_login, site_url, pub_date, post_date,
    post_type = 'et_pb_layout', status, meta = { _et_pb_use_builder: 'on' }, terms = [],
  } = opts;
  const st = status || (post_type === 'et_pb_layout' ? 'publish' : 'draft');
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
 * Render one `<item>` for a media-library attachment. WordPress's importer
 * downloads `source_url` at import time, re-hosts it in uploads/, and then
 * rewrites every occurrence of `source_url` in the imported posts'
 * post_content to the new local URL. Divi modules reference images by URL
 * (et_pb_image `src`, background_image, blurb `image`, ...), so that
 * rewrite is what turns a short-lived Figma URL in the layout into a
 * permanent one — which is why every new image URL in the layout MUST have
 * an attachment item with the *identical* URL (enforced by
 * dvValidateImageUrls).
 * opts: { post_id, title, post_name, source_url, author_login, site_url, pub_date, post_date, ext? }
 */
function dvRenderAttachmentItem(opts) {
  const { post_id, title, post_name, source_url, author_login, site_url, pub_date, post_date } = opts;
  const ext = opts.ext || (source_url.match(/\.(\w{3,4})(?:\?|#|$)/) || [, 'png'])[1];
  const attachedFile = `figma-to-divi-builder/${post_name}.${ext}`;
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
\t\t<wp:meta_value>${toCdata(attachedFile)}</wp:meta_value>
\t\t</wp:postmeta>
\t\t</item>`;
}

/** Wrap one or more rendered `<item>` blocks in a complete, standalone, importable WXR document. */
function dvRenderWxrDocument(header, itemsXml, pubDate) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- This is a WordPress eXtended RSS file generated by the figma-to-divi-builder skill. -->
<!-- It contains Divi layout posts (and their images), importable via Tools -> Import -> WordPress. -->
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

/** Every full `<item>...</item>` block of an already-rendered WXR file (for combining several builds into one import). */
function dvExtractRawItems(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return extractItemBlocks(xml).map((body) => `\t\t<item>${body}</item>`);
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

/** Divi 4 structural nesting rules: which parent each structural tag must sit directly inside. */
const SHORTCODE_PARENTS = {
  et_pb_section: ['#root'],
  et_pb_row: ['et_pb_section'],
  et_pb_column: ['et_pb_row', 'et_pb_section'], // section parent = specialty section
  et_pb_row_inner: ['et_pb_column'],
  et_pb_column_inner: ['et_pb_row_inner'],
};

/** Divi 4 column `type` values -> fraction of the row, for column_structure checks. */
const COLUMN_FRACTIONS = {
  '4_4': 1, '1_2': 1 / 2, '1_3': 1 / 3, '2_3': 2 / 3, '1_4': 1 / 4, '3_4': 3 / 4,
  '1_5': 1 / 5, '2_5': 2 / 5, '3_5': 3 / 5, '4_5': 4 / 5, '1_6': 1 / 6, '5_6': 5 / 6,
};

/**
 * Structural checks on a parsed tree. Returns { errors, warnings }.
 * Errors = would import but render broken/empty (unclosed tags, a row
 * outside a section, a column row that does not add up, modules directly
 * in a regular section). Warnings = worth a line in the handoff.
 */
function dvValidateTree(tree) {
  const errors = [];
  const warnings = [];
  if (tree.unclosed && tree.unclosed.length) errors.push(`Unclosed tags: ${tree.unclosed.join(', ')}`);
  if (tree.strays && tree.strays.length) errors.push(`Closing tags with no opener: ${tree.strays.join(', ')}`);

  if (tree.format === 'shortcode') {
    const visit = (nodes, parent) => {
      for (const n of nodes) {
        if (n.kind === 'text') {
          if (parent === null && n.text.trim()) warnings.push(`Loose text outside any section: ${JSON.stringify(n.text.trim().slice(0, 60))}`);
          continue;
        }
        const parentName = parent ? parent.tag : '#root';
        const allowed = SHORTCODE_PARENTS[n.tag];
        if (allowed && !allowed.includes(parentName)) errors.push(`${n.tag} inside ${parentName} (allowed: ${allowed.join(', ')})`);
        if (!allowed && parentName === '#root') errors.push(`Module ${n.tag} at top level — every module must be inside a section`);
        if (!allowed && (parentName === 'et_pb_row' || parentName === 'et_pb_row_inner')) {
          errors.push(`Module ${n.tag} directly inside ${parentName} — modules must sit inside an et_pb_column`);
        }
        if (parentName === 'et_pb_section' && !allowed) {
          const fullwidth = dvDecodeAttr(parent.attrs.fullwidth || '') === 'on';
          if (!fullwidth) errors.push(`Module ${n.tag} directly inside a regular et_pb_section (needs row > column, or a fullwidth="on" section)`);
          else if (n.tag.startsWith('et_pb_') && !n.tag.startsWith('et_pb_fullwidth_')) warnings.push(`${n.tag} inside a fullwidth section — only et_pb_fullwidth_* modules render there`);
        }
        if (n.tag === 'et_pb_row' || n.tag === 'et_pb_row_inner') {
          const cols = elementChildren(n).filter((c) => /^et_pb_column(_inner)?$/.test(c.tag));
          const types = cols.map((c) => dvDecodeAttr(c.attrs.type || ''));
          if (!cols.length) errors.push(`${n.tag} has no columns — it renders as an empty band`);
          const unknown = types.filter((t) => !(t in COLUMN_FRACTIONS));
          if (unknown.length) errors.push(`${n.tag} has columns with unknown type: ${unknown.join(', ')}`);
          else if (cols.length) {
            const sum = types.reduce((s, t) => s + COLUMN_FRACTIONS[t], 0);
            if (Math.abs(sum - 1) > 0.01) errors.push(`${n.tag} columns ${types.join(',')} add up to ${sum.toFixed(2)}, not 1`);
          }
          if (n.attrs.column_structure !== undefined && dvDecodeAttr(n.attrs.column_structure) !== types.join(',')) {
            errors.push(`${n.tag} column_structure="${dvDecodeAttr(n.attrs.column_structure)}" does not match its columns (${types.join(',')}) — call dvSyncColumnStructure`);
          }
        }
        for (const a of GLOBAL_LINK_ATTRS) {
          if (n.attrs[a] !== undefined) warnings.push(`${n.tag} carries ${a}="${n.attrs[a]}" — it is linked to a global Library item; editing it edits every page using it`);
        }
        visit(n.children, n);
      }
    };
    visit(tree.children, null);
  }
  return { errors, warnings };
}

/** Every http(s) URL anywhere in the serialized content (attrs, JSON, inner HTML), decoded. */
function collectUrls(content) {
  const decoded = dvDecodeAttr(content).replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>()\]\[\\,]+/g;
  let m;
  while ((m = re.exec(decoded))) urls.add(m[0].replace(/[.;]+$/, ''));
  return [...urls];
}

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i;
const FIGMA_ASSET_RE = /figma\.com\/api\/mcp\/asset\/|figma-alpha-api\.s3|s3-(?:us-west-2|alpha)\.amazonaws\.com\/figma/i;

/**
 * The Divi image trap: Divi modules point at images by URL, so a new image
 * URL left in the layout without an attachment item is hotlinked forever —
 * and a Figma asset URL stops working within days, leaving an empty image
 * box. Every image-looking or Figma-hosted URL must be either already on
 * the site's own host, or have an attachment item with the identical
 * `wp:attachment_url` in this file (so the importer downloads it and
 * rewrites the URL to the local copy).
 * Returns problem strings (empty if clean).
 */
function dvValidateImageUrls(content, attachmentUrls, siteUrl) {
  const siteHost = siteUrl ? (() => { try { return new URL(siteUrl).host; } catch (e) { return ''; } })() : '';
  const problems = [];
  for (const url of collectUrls(content)) {
    if (!IMAGE_URL_RE.test(url) && !FIGMA_ASSET_RE.test(url)) continue;
    let host = '';
    try { host = new URL(url).host; } catch (e) { /* malformed -> treat as external */ }
    if (siteHost && host === siteHost) continue;
    if (attachmentUrls.has(url)) continue;
    problems.push(
      `${url} is used in the layout but has no attachment item with that exact URL — it would be hotlinked` +
      (FIGMA_ASSET_RE.test(url) ? ' (and Figma asset URLs expire)' : '') +
      '. Add dvRenderAttachmentItem({ source_url: <this exact URL>, ... }).'
    );
  }
  return problems;
}

/**
 * Full output check, run at the end of every build script:
 *   1. well-formed XML;
 *   2. every Divi item's post_content re-serializes byte-identically after parsing;
 *   3. structural rules (dvValidateTree) — errors throw;
 *   4. the image trap (dvValidateImageUrls) — throws;
 *   5. every Divi item has `_et_pb_use_builder=on` (otherwise WordPress
 *      shows raw shortcodes instead of the Divi layout).
 * Returns [{ title, postType, format, nodeCount, warnings }]. Throws on any error.
 */
function dvValidateWxrFile(outPath) {
  const xml = fs.readFileSync(outPath, 'utf8');
  const wellFormed = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (wellFormed !== true) throw new Error(`WXR file is not well-formed XML: ${JSON.stringify(wellFormed)}`);

  const channelMatch = /<channel>([\s\S]*?)<item>/.exec(xml);
  const siteUrl = channelMatch ? extractTag(channelMatch[1], 'link') : '';
  const blocks = extractItemBlocks(xml);
  const attachmentUrls = new Set(
    blocks.filter((b) => extractTag(b, 'wp:post_type') === 'attachment').map((b) => extractTag(b, 'wp:attachment_url'))
  );

  const results = [];
  const errors = [];
  const seenIds = new Set();
  for (const block of blocks) {
    const id = extractTag(block, 'wp:post_id');
    if (seenIds.has(id)) errors.push(`Duplicate wp:post_id ${id}`);
    seenIds.add(id);

    const content = extractTag(block, 'content:encoded');
    const format = dvDetectFormat(content);
    if (!format) continue;
    const title = extractTag(block, 'title');
    const label = `"${title}" (post_id ${id})`;

    const tree = dvParse(content, format);
    if (dvSerialize(tree) !== content) errors.push(`${label}: content does not round-trip through the parser — malformed markup`);

    const { errors: treeErrors, warnings } = dvValidateTree(tree);
    treeErrors.forEach((e) => errors.push(`${label}: ${e}`));
    dvValidateImageUrls(content, attachmentUrls, siteUrl).forEach((p) => errors.push(`${label}: ${p}`));

    const meta = extractAllPostMeta(block);
    if (meta._et_pb_use_builder !== 'on') errors.push(`${label}: missing postmeta _et_pb_use_builder=on — WordPress would show raw shortcodes`);

    let nodeCount = 0;
    dvWalk(tree, () => { nodeCount++; });
    if (nodeCount === 0) errors.push(`${label}: no Divi nodes found`);
    results.push({ title, postType: extractTag(block, 'wp:post_type'), format, nodeCount, warnings });
  }
  if (results.length === 0) errors.push('No Divi layout items found in output file');
  if (errors.length) throw new Error(`Divi WXR validation failed (${errors.length} issue(s)):\n` + errors.map((e) => `  - ${e}`).join('\n'));
  return results;
}

module.exports = {
  dvExtractAllLayouts,
  dvExtractAttachments,
  dvExtractSiteHeader,
  dvItemDefaultsFromExport,
  dvMaxPostId,
  dvDetectFormat,
  dvParse,
  dvSerialize,
  dvWalk,
  dvFindAll,
  dvGetByPath,
  dvCollectPaths,
  dvClone,
  dvGetAttr,
  dvSetAttr,
  dvSetText,
  dvShortcode,
  dvSyncColumnStructure,
  dvEncodeAttr,
  dvDecodeAttr,
  dvCodeModule,
  dvAccordionHtml,
  dvAccordionModule,
  dvRenderItem,
  dvRenderAttachmentItem,
  dvRenderWxrDocument,
  dvExtractRawItems,
  dvValidateTree,
  dvValidateImageUrls,
  dvValidateWxrFile,
  elementChildren,
  nodeName,
  GLOBAL_LINK_ATTRS,
  COLUMN_FRACTIONS,
  toCdata,
  xmlEscape,
  htmlEscape,
};
