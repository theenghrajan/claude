'use strict';
/**
 * Core helper library for the figma-to-beaver-builder skill.
 *
 * Node.js port (this machine has no PHP CLI installed). Mirrors the API of
 * the original wxr-helpers.php 1:1 so build-*.js scripts read the same as
 * the historical build-*.php scripts:
 *
 *   flExtractAllTemplates(xmlPath)      -> [{ postId, postName, title, tree }]
 *   flExtractSiteHeader(xmlPath)        -> { authorLogin, authorEmail, authorDisplayName, siteTitle, siteUrl, ... }
 *   flDeepClone(node)                   -> deep clone preserving PHP array vs stdClass-object shape
 *   flGenId(existingIds)                -> fresh unique 12-char lowercase alphanumeric node id (mutates the Set)
 *   flRenderItem(opts)                  -> WXR <item> XML string for one fl-builder-template post
 *   flRenderWxrDocument(header, itemsXml, pubDate) -> full standalone WXR document string
 *   flValidateWxrFile(outPath)          -> [nodeCount, ...] per fl-builder-template item found; throws if invalid
 *
 * Serialization uses the `php-serialize` npm package, which round-trips
 * Beaver Builder's `_fl_builder_data` structure correctly (arrays vs
 * stdClass objects, UTF-8 string byte-lengths) with one known, harmless
 * divergence from PHP's own serialize(): whole-number floats (PHP `d:50;`)
 * come back out as `i:50;` (int) because JS has one numeric type. Beaver
 * Builder only ever consumes these as `(string) $value . '%'`, and PHP's
 * (string) cast on both 50 and 50.0 produces "50" either way, so this does
 * not change rendered output. It only means a byte-diff against a
 * pre-existing PHP-serialized blob won't be 100% identical; a functional
 * round-trip (unserialize back into the same shape) always is, which is
 * what flValidateWxrFile checks.
 */

const fs = require('fs');
const phpSerialize = require('php-serialize');
const { XMLValidator } = require('fast-xml-parser');

class stdClass {}
const SCOPE = { stdClass };

// ---------------------------------------------------------------------
// CDATA-safe helpers
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
  return found ? combined : raw.trim();
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

// ---------------------------------------------------------------------
// Mining: pull real template trees + site header out of a WXR export
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

function extractPostMetaValue(block, key) {
  const postmetaRe = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g;
  let m;
  while ((m = postmetaRe.exec(block))) {
    const chunk = m[1];
    if (extractTag(chunk, 'wp:meta_key') === key) {
      const valMatch = /<wp:meta_value>([\s\S]*?)<\/wp:meta_value>/.exec(chunk);
      return valMatch ? joinCdataChunks(valMatch[1]) : '';
    }
  }
  return null;
}

/**
 * Find every `fl-builder-template` item in a WXR export and return its
 * unserialized `_fl_builder_data` tree, keyed by node id (matches the real
 * shape WordPress/Beaver Builder store: a plain object/array of node id ->
 * stdClass node).
 */
function flExtractAllTemplates(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const blocks = extractItemBlocks(xml);
  const templates = [];

  for (const block of blocks) {
    const postType = extractTag(block, 'wp:post_type');
    if (postType !== 'fl-builder-template') continue;

    const rawTree = extractPostMetaValue(block, '_fl_builder_data');
    if (!rawTree) continue;

    const tree = phpSerialize.unserialize(rawTree, SCOPE, { strict: true });

    templates.push({
      postId: parseInt(extractTag(block, 'wp:post_id'), 10),
      postName: extractTag(block, 'wp:post_name'),
      title: extractTag(block, 'title').trim(),
      tree,
    });
  }

  return templates;
}

/** Pull the channel-level site identity (title/url/author) so nothing is ever hardcoded.
 * Keys are snake_case to match the original wxr-helpers.php's associative-array shape
 * (`$header['author_login']`, `$header['site_url']`, ...) 1:1. */
function flExtractSiteHeader(xmlPath) {
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

// ---------------------------------------------------------------------
// Node tree manipulation
// ---------------------------------------------------------------------

/** Deep clone a value pulled out of an unserialized tree, preserving the
 * PHP array-vs-stdClass-object distinction so re-serializing produces the
 * correct `a:`/`O:8:"stdClass"` type for every field, including ones never
 * touched by the caller. */
function flDeepClone(value) {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof stdClass) {
    const out = new stdClass();
    for (const k of Object.keys(value)) out[k] = flDeepClone(value[k]);
    return out;
  }

  if (Array.isArray(value)) {
    return value.map(flDeepClone);
  }

  const out = {};
  for (const k of Object.keys(value)) out[k] = flDeepClone(value[k]);
  return out;
}

/**
 * Turn a clone of ANY real module node into a core Beaver Builder "html"
 * module (ships with every Beaver Builder install, Lite and Pro — verified
 * against the actual `beaver-builder-lite-version` plugin source, module
 * class FLHtmlModule, settings field `html`, type slug `html`). Leftover
 * fields from whatever module `tpl` was cloned from (e.g. info-box's
 * `title`/`text`/`photo`) are harmless — Beaver Builder's html module only
 * ever reads `settings.html`.
 *
 * Use this for anything needing real JS/CSS behavior this site has no
 * proven module for (e.g. an actual expand/collapse FAQ accordion) instead
 * of guessing at a third-party module's internal field schema that no real
 * instance on this site can confirm.
 */
function flHtmlModule(tpl, htmlContent) {
  const mod = flDeepClone(tpl);
  mod.settings.type = 'html';
  mod.settings.html = htmlContent;
  return mod;
}

/**
 * Build a self-contained, dependency-free FAQ accordion (native
 * `<details>/<summary>`, pure-CSS chevron rotation via `details[open]` — no
 * JS, so it works regardless of what's loaded on the page) for embedding
 * via flHtmlModule. `items`: [{ q, a }]. The first item starts open to
 * match the common "first FAQ expanded" design pattern; pass
 * `{ openFirst: false }` to start all collapsed.
 */
function flAccordionHtml(items, opts = {}) {
  const openFirst = opts.openFirst !== false;
  const wrapClass = opts.wrapClass || 'fl2bb-accordion';
  const accentColor = opts.accentColor || '#fd3d18'; // this site's real accent color (seen on location-pin/checklist icons elsewhere)

  const rows = items.map((item, i) => {
    const openAttr = i === 0 && openFirst ? ' open' : '';
    const answer = item.a
      ? `<div class="${wrapClass}-answer">${item.a}</div>`
      : `<div class="${wrapClass}-answer"></div>`;
    return `<details class="${wrapClass}-item"${openAttr}>
  <summary class="${wrapClass}-question"><span>${xmlEscape(item.q)}</span><i class="${wrapClass}-icon" aria-hidden="true"></i></summary>
  ${answer}
</details>`;
  }).join('\n');

  return `<div class="${wrapClass}">
<style>
.${wrapClass}{max-width:100%;}
.${wrapClass}-item{border:0.5px solid rgba(20,20,20,0.2);border-radius:6px;padding:4px 20px;margin-bottom:12px;transition:box-shadow .2s ease,border-color .2s ease;}
.${wrapClass}-item[open]{box-shadow:0 8px 30px rgba(0,0,0,0.05);border-color:rgba(208,208,208,0.5);}
.${wrapClass}-question{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 0;font-weight:600;font-size:18px;}
.${wrapClass}-question::-webkit-details-marker{display:none;}
.${wrapClass}-icon{position:relative;flex:0 0 auto;width:32px;height:32px;border-radius:50%;background:${accentColor};}
.${wrapClass}-icon::before,.${wrapClass}-icon::after{content:'';position:absolute;background:#ffffff;top:50%;left:50%;transform:translate(-50%,-50%);}
.${wrapClass}-icon::before{width:12px;height:2px;}
.${wrapClass}-icon::after{width:2px;height:12px;transition:transform .2s ease;}
.${wrapClass}-item[open] .${wrapClass}-icon::after{transform:translate(-50%,-50%) rotate(90deg);opacity:0;}
.${wrapClass}-answer{padding:0 0 20px;color:#444;line-height:1.6;}
.${wrapClass}-answer p{margin:0 0 12px;}
.${wrapClass}-answer p:last-child{margin-bottom:0;}
</style>
${rows}
</div>`;
}

/** A "blank"/unset Beaver Builder typography field, in the exact shape
 * confirmed from a real populated instance (interactive-banner-2's
 * title_font_typo in this project's catalog.txt) -- reused here for any
 * module whose typography field has no explicit plugin default. */
function flBlankTypography() {
  return {
    font_family: 'Default',
    font_weight: 'default',
    font_size: { length: '', unit: 'px' },
    line_height: { length: '', unit: '' },
    text_align: '',
    letter_spacing: { length: '', unit: 'px' },
    text_transform: '',
    text_decoration: '',
    font_style: '',
    font_variant: '',
    text_shadow: { color: '', horizontal: '', vertical: '', blur: '' },
  };
}

/** A "blank"/unset Beaver Builder border field, exact shape confirmed from
 * this project's own catalog.txt (a real row with a border configured). */
function flBlankBorder() {
  return {
    style: 'none',
    color: '',
    width: { top: '1', right: '1', bottom: '1', left: '1' },
  };
}

/**
 * Build a real UABB FAQ module (class UABBFAQModule, type slug `uabb-faq`
 * — ships with Ultimate Addons for Beaver Builder, confirmed installed on
 * this project via bb-ultimate-addon/modules/uabb-faq in the supplied
 * plugin source) configured as a genuine accordion: real JS-driven
 * expand/collapse with ARIA roles, first item open, one-at-a-time
 * collapse — not the flHtmlModule/flAccordionHtml hand-rolled fallback.
 *
 * Every field below (and its default) is transcribed directly from the
 * real plugin source (`uabb-faq-bb-2-2-compatibility.php`), not guessed —
 * this site's own export has no existing `uabb-faq` instance to clone, so
 * this reconstructs the module's own shipped defaults instead.
 *
 * `tpl`: any real module node to clone for the generic boilerplate tail
 * (id, class, visibility, animation, margin/padding, etc. — identical
 * across all Beaver Builder module types).
 * `faqs`: [{ q, a }] — `a` may contain HTML (passed to wpautop by the
 * module's own render code, same as a normal WYSIWYG field).
 * `opts.expandFirst` (default true), `opts.collapseOthers` (default true).
 */
function flUabbFaqModule(tpl, faqs, opts = {}) {
  const expandFirst = opts.expandFirst !== false;
  const collapseOthers = opts.collapseOthers !== false;

  const mod = flDeepClone(tpl);
  const faqItems = faqs.map((f) => {
    const item = new stdClass();
    item.faq_question = f.q;
    item.faq_answer = f.a;
    return item;
  });

  mod.settings = Object.assign(new stdClass(), {
    type: 'uabb-faq',
    preset_select: 'none',
    faq_items: faqItems,
    enable_schema: 'no',
    faq_layout: 'accordion',
    columns: '3', // grid-layout-only field, irrelevant while faq_layout='accordion'
    faq_collapse: collapseOthers ? 'yes' : 'no',
    faq_enable_first: expandFirst ? 'yes' : 'no',
    layout_style: 'accordion_style',
    row_gap: '10', // grid-layout-only
    column_gap: '10', // grid-layout-only
    faq_equal_height: 'no', // grid-layout-only
    style_background_col: 'f6f6f6',
    style_border_param: flBlankBorder(),
    faq_title_color: '',
    faq_title_hover_color: '',
    faq_title_bg_color: 'f9f9f9',
    faq_title_bg_hover_color: '',
    faq_item_margin: '10',
    faq_item_padding: '',
    faq_border_param: flBlankBorder(),
    answers_color: '',
    answers_bg_color: 'f9f9f9',
    answers_padding: '',
    answers_border: flBlankBorder(),
    close_icon: 'fas fa-plus',
    open_icon: 'fas fa-minus',
    icon_size: '',
    icon_position: 'before',
    icon_color: '',
    icon_hover_color: '',
    tag_selection: 'h4',
    title_font_typo: flBlankTypography(),
    content_font_typo: flBlankTypography(),
  });

  return mod;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a fresh unique 12-char lowercase alphanumeric node id (Beaver Builder's format) and register it in existingIds. */
function flGenId(existingIds) {
  let id;
  do {
    id = '';
    for (let i = 0; i < 12; i++) id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  } while (existingIds.has(id));
  existingIds.add(id);
  return id;
}

/** Serialize a node tree the same way `serialize($newTree)` did in the PHP scripts. */
function flSerialize(tree) {
  return phpSerialize.serialize(tree, SCOPE);
}

/** Inverse of flSerialize — mainly useful for ad hoc inspection/debugging. */
function flUnserialize(raw) {
  return phpSerialize.unserialize(raw, SCOPE, { strict: true });
}

// ---------------------------------------------------------------------
// Rendering: wrap a new node tree into a standalone importable WXR file
// ---------------------------------------------------------------------

/**
 * Render one `<item>` block for a new fl-builder-template post. Mirrors the
 * original fl_render_item($opts) 1:1 — snake_case keys, `serialized` is
 * already a serialize()'d string (call flSerialize(tree) first):
 *   { post_id, post_name, title, serialized, author_login, site_url, pub_date, post_date }
 */
function flRenderItem(opts) {
  const { post_id, post_name, title, serialized, author_login, site_url, pub_date, post_date } = opts;

  return `\t\t<item>
\t\t<title>${xmlEscape(title)}</title>
\t\t<link>${xmlEscape(site_url)}/fl-builder-template/${xmlEscape(post_name)}/</link>
\t\t<pubDate>${xmlEscape(pub_date)}</pubDate>
\t\t<dc:creator>${toCdata(author_login)}</dc:creator>
\t\t<guid isPermaLink="false">${xmlEscape(site_url)}/fl-builder-template/${xmlEscape(post_name)}/</guid>
\t\t<description></description>
\t\t<content:encoded>${toCdata('')}</content:encoded>
\t\t<excerpt:encoded>${toCdata('')}</excerpt:encoded>
\t\t<wp:post_id>${post_id}</wp:post_id>
\t\t<wp:post_date>${toCdata(post_date)}</wp:post_date>
\t\t<wp:post_date_gmt>${toCdata(post_date)}</wp:post_date_gmt>
\t\t<wp:comment_status>${toCdata('closed')}</wp:comment_status>
\t\t<wp:ping_status>${toCdata('closed')}</wp:ping_status>
\t\t<wp:post_name>${toCdata(post_name)}</wp:post_name>
\t\t<wp:status>${toCdata('publish')}</wp:status>
\t\t<wp:post_parent>0</wp:post_parent>
\t\t<wp:menu_order>0</wp:menu_order>
\t\t<wp:post_type>${toCdata('fl-builder-template')}</wp:post_type>
\t\t<wp:post_password>${toCdata('')}</wp:post_password>
\t\t<wp:is_sticky>0</wp:is_sticky>
\t\t<category domain="fl-builder-template-type" nicename="layout">${toCdata('layout')}</category>
\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata('_fl_builder_data')}</wp:meta_key>
\t\t<wp:meta_value>${toCdata(serialized)}</wp:meta_value>
\t\t</wp:postmeta>
\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata('_fl_builder_data_settings')}</wp:meta_key>
\t\t<wp:meta_value>${toCdata(phpSerialize.serialize({ css: '', js: '' }, SCOPE))}</wp:meta_value>
\t\t</wp:postmeta>
\t\t<wp:postmeta>
\t\t<wp:meta_key>${toCdata('_fl_builder_enabled')}</wp:meta_key>
\t\t<wp:meta_value>${toCdata('1')}</wp:meta_value>
\t\t</wp:postmeta>
\t\t</item>`;
}

/**
 * Render one `<item>` block for a real WordPress media-library attachment,
 * so a brand-new image referenced by a module (e.g. interactive-banner-2's
 * `banner_image`, which — unlike pp-image's `photo_src` — needs a real
 * attachment ID, not just a URL, to render on the front end) gets created
 * automatically by WordPress's own importer at import time.
 *
 * `source_url` must be a URL the *target* WordPress server can fetch over
 * HTTP(S) at the moment of import (WP's importer downloads it there and
 * then re-hosts it in its own uploads/ directory) — it is not embedded in
 * the WXR file itself. If this is a short-lived link (e.g. a Figma asset
 * URL), import soon after generating the file.
 *
 * opts: { post_id, title, post_name, source_url, author_login, site_url, pub_date, post_date }
 *   - post_id: choose a number well outside the source export's used id
 *     range (WordPress's importer preserves an explicit post_id when that
 *     slot is free, the same mechanism the other build-*.php/js scripts
 *     already rely on for their template post_ids) — this is also the
 *     exact numeric value to put in the referencing module's image-id field.
 */
function flRenderAttachmentItem(opts) {
  const { post_id, title, post_name, source_url, author_login, site_url, pub_date, post_date } = opts;
  const ext = (source_url.match(/\.(\w+)(?:\?|$)/) || [, 'png'])[1];
  const attachedFile = `figma-to-beaver-builder/${post_name}.${ext}`;

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
function flRenderWxrDocument(header, itemsXml, pubDate) {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- This is a WordPress eXtended RSS file generated for the figma-to-beaver-builder skill. -->
<!-- It contains one or more fl-builder-template posts, importable via Tools -> Import -> WordPress. -->
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

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

/**
 * Registry of module types whose image field renders from a real WordPress
 * attachment id, not directly from a raw URL string — the "banner_image
 * attachment-id trap" documented in SKILL.md. Keyed by `settings.type`;
 * value is `[idField, srcField]`. `srcField` is the field that gets set
 * to a display/backup URL and is what someone reaches for by habit;
 * `idField` is the one that actually has to hold a numeric attachment id
 * for the image to render at all.
 *
 * Extend this map (don't hand-roll a new if-branch) when a new module is
 * confirmed via its own plugin source to have the same requirement.
 */
const ATTACHMENT_ID_FIELDS = {
  'interactive-banner-2': ['banner_image', 'banner_image_src'],
  'info-box': ['photo', 'photo_src'],
};

/**
 * Scan a node tree for the attachment-id trap: a module in
 * ATTACHMENT_ID_FIELDS whose src field indicates an image was intended
 * (non-empty) but whose id field isn't a real numeric attachment id. This
 * is the exact bug that shipped an empty card grid on the About page and a
 * dead-looking section elsewhere — both had perfect text content and a
 * plausible-looking `_src` URL, so nothing about them looked wrong in the
 * build script until the page was actually imported.
 *
 * Returns an array of human-readable problem strings (empty if clean).
 */
function flValidateAttachmentFields(tree) {
  const problems = [];
  for (const node of Object.values(tree)) {
    if (!node || node.type !== 'module') continue;
    const settings = node.settings;
    if (!settings || typeof settings !== 'object') continue;

    const fields = ATTACHMENT_ID_FIELDS[settings.type];
    if (!fields) continue;
    const [idField, srcField] = fields;

    const srcVal = settings[srcField];
    const idVal = settings[idField];
    const srcIntendsImage = srcVal !== undefined && srcVal !== null && String(srcVal).trim() !== '';
    const idIsNumeric = idVal !== undefined && idVal !== null && String(idVal).trim() !== '' && !isNaN(parseInt(idVal, 10));

    if (srcIntendsImage && !idIsNumeric) {
      problems.push(
        `${settings.type} node ${node.node}: ${srcField}=${JSON.stringify(srcVal)} is set but ` +
        `${idField}=${JSON.stringify(idVal)} is not a numeric attachment id. This field renders from ` +
        `the attachment id, not the raw URL — add a flRenderAttachmentItem() for this image and set ` +
        `${idField} to its post_id.`
      );
    }
  }
  return problems;
}

/**
 * Pull every full `<item>...</item>` block (page templates AND attachment
 * items alike) out of an already-rendered WXR file, tags included. Used to
 * combine several separately-built pages (each its own valid WXR file) into
 * one importable file without re-running any build logic -- see
 * build-all-pages.js.
 */
function flExtractRawItems(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  return extractItemBlocks(xml).map((body) => `\t\t<item>${body}</item>`);
}

/** Well-formedness check (fast-xml-parser) + functional round-trip of every
 * `_fl_builder_data` value in the file. Returns the node count per item
 * found; throws on any structural problem. */
function flValidateWxrFile(outPath) {
  const xml = fs.readFileSync(outPath, 'utf8');

  const wellFormed = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (wellFormed !== true) {
    throw new Error(`WXR file is not well-formed XML: ${JSON.stringify(wellFormed)}`);
  }

  const blocks = extractItemBlocks(xml);
  const counts = [];
  for (const block of blocks) {
    const postType = extractTag(block, 'wp:post_type');
    if (postType !== 'fl-builder-template') continue;
    const raw = extractPostMetaValue(block, '_fl_builder_data');
    if (!raw) throw new Error('fl-builder-template item is missing its _fl_builder_data postmeta');
    const tree = phpSerialize.unserialize(raw, SCOPE, { strict: true });
    const nodeCount = Object.keys(tree).length;
    if (nodeCount === 0) throw new Error('_fl_builder_data unserialized to an empty tree');

    const attachmentProblems = flValidateAttachmentFields(tree);
    if (attachmentProblems.length > 0) {
      throw new Error(
        `Attachment-id trap detected (${attachmentProblems.length} issue(s)) — this would silently render ` +
        `as an empty/collapsed element, not an error, so it must be fixed before handoff:\n` +
        attachmentProblems.map((p) => `  - ${p}`).join('\n')
      );
    }

    counts.push(nodeCount);
  }
  if (counts.length === 0) throw new Error('No fl-builder-template items found in output file');
  return counts;
}

module.exports = {
  stdClass,
  flExtractAllTemplates,
  flExtractSiteHeader,
  flDeepClone,
  flGenId,
  flHtmlModule,
  flAccordionHtml,
  flUabbFaqModule,
  flBlankTypography,
  flBlankBorder,
  flSerialize,
  flUnserialize,
  flRenderItem,
  flRenderAttachmentItem,
  flRenderWxrDocument,
  flExtractRawItems,
  flValidateWxrFile,
  flValidateAttachmentFields,
  ATTACHMENT_ID_FIELDS,
  toCdata,
  xmlEscape,
};
