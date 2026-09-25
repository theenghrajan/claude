---
name: figma-to-block-editor
description: Convert a Figma design section/page into a standalone importable WordPress WXR file containing native block-editor (Gutenberg) content — an unsynced pattern (`wp_block`, default), a draft page, or a Full Site Editing template / template part — built from real blocks mined from that site's own WordPress export, with every block's comment attrs and saved HTML kept in sync so the editor never flags "This block contains unexpected or invalid content". Works for classic themes using the block editor and for block themes (FSE). Use whenever the user gives a Figma node link plus a WordPress export (WXR/.xml) and asks for a Gutenberg / block editor / default WordPress editor / FSE / Site Editor section, page, pattern, template or template part — or mentions core blocks, `wp:` block markup, block themes, theme.json presets, or converting a Figma design into a WordPress import file for a site that doesn't use a page builder.
---

# Figma -> Block Editor (WXR) builder

Turns a Figma node into a standalone `.xml` file the target WordPress site
imports via **Tools -> Import -> WordPress**. By default the file holds one
new **unsynced pattern** (`wp_block`, shows under Patterns -> My patterns);
on request a **draft page**, or an FSE **template / template part**. Every
block is either a deep clone of a real block mined from that site's export,
or a fresh core block built by the helpers (markup verified against
WordPress's own block validator) — never hand-typed block markup.

**Operating principle: run the phases to completion without stopping to
ask mid-build.** Resolve anything below "High" confidence by falling
through the ground-truth hierarchy (mined block -> fresh core block via
helpers -> Custom HTML block) and report it in the Phase 7 handoff. Only
interrupt for the Phase 0 inputs, a genuinely missing capability, or an FSE
template request when the theme slug can't be found.

---

## How the block editor stores content (read once — it drives everything)

The layout is the post's `post_content` (WXR `<content:encoded>`): block
comments around the HTML each block's `save()` produced.

```
<!-- wp:group {"backgroundColor":"contrast","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-contrast-background-color has-background"><!-- wp:heading {"level":1} -->
<h1 class="wp-block-heading">Hi</h1>
<!-- /wp:heading --></div>
<!-- /wp:group -->
```

**The trap — block validation.** When the editor opens the post it re-runs
`save(attrs)` for every static block and compares the result with the
stored HTML. Any mismatch — a comment attr implying a class, inline style
or tag the HTML lacks, or the reverse — marks the block **invalid** ("This
block contains unexpected or invalid content / Attempt Block Recovery").
The front end still renders the stored HTML, so a broken block looks fine
on the site and only breaks for the editor. This is the block-editor
equivalent of Beaver Builder's serialization trap and Divi's encoding trap.

Rules that follow from it:
- **Text is safe** to change inside rich-text elements (`<p>`, `<hN>`,
  button `<a>`, `<li>`, `<summary>`, `<figcaption>`): those attrs are
  re-read from the HTML.
- **Anything else changes attrs AND HTML together** — use the helpers
  (`beStyle`, `bePreset`, `beAddClass`, `beSetImage`), never `beSetAttr`
  alone for a markup-affecting attr.
- **Dynamic blocks** (`site-title`, `navigation`, `query`, `post-content`,
  `template-part`, `latest-posts`, …) are self-closing comments rendered by
  PHP — no HTML to keep in sync, but cross-post `ref`s must exist on site.
- `core/html` (Custom HTML) is never validated — the safe fallback.

`scripts/wxr-helpers.js` parses content into a lossless tree
(`beSerialize(beParse(x)) === x`) and handles all of the above. **Never
hand-concatenate block markup.**

Where styling comes from: **theme.json presets** (colors, font sizes,
spacing — e.g. `has-primary-color`, `var:preset|spacing|50`), user global
styles (Site Editor -> Styles; exported as a `wp_global_styles` post), then
per-block `style` attrs. Prefer a preset when one matches Figma; use a raw
value (`#0B1F3A`, `48px`) only when none does.

---

## Phase 0 — Pre-flight (fail fast)

| # | Check | If it fails |
|---|-------|-------------|
| 0.1 | User supplied a WXR `.xml` export **from the target site** (`Tools -> Export -> All content`) | Stop and ask — real blocks to clone and the site's preset slugs come from it. |
| 0.2 | User supplied a Figma URL with `node-id=` | Stop and ask. |
| 0.3 | `scripts/node_modules/` exists | `npm install` inside `scripts/` (only `fast-xml-parser`). |
| 0.4 | The export contains block content | Miner exits "No block-editor content" -> the site uses the Classic editor or a page builder. Say so; for Divi / Beaver Builder use those skills. |
| 0.5 | Output type | Default unsynced pattern. Page if asked. Template/part only if asked **and** the site is FSE (catalog: "block theme / FSE: yes") — needs the theme slug (catalog SITE FACTS, else ask). |
| 0.6 | WordPress version (catalog SITE FACTS) | Fresh-block markup targets current core (WP 6.6+). On older WP, prefer clones; `core/details` needs 6.3+. Flag it. |

## Phase 1 — Mine & catalog (always run; never assume the block set)

```bash
node ~/.claude/skills/figma-to-block-editor/scripts/mine-block-data.js export.xml --out catalog.txt
```

Prints, for every item with block markup (pages, posts, patterns,
templates, template parts, navigation menus):

- an outline of every block with its **path** (`path=0.2.1` = 1st top-level
  block -> its 3rd inner block -> its 2nd inner block) — the handle build
  scripts pass to `beGetByPath` — plus its attrs and its own HTML;
- **SUMMARY** — block names and counts, core first, then third-party
  namespaces (`kadence/`, `generateblocks/`, `uagb/`, `stackable/`, …);
- **ATTRIBUTE KEYS SEEN PER BLOCK** — flattened (`style.spacing.padding.top`);
- **SITE FACTS** — WP version, FSE yes/no, theme slug(s), **preset slugs
  used** (the site's real color / font-size / spacing names), global
  styles JSON, cross-post refs, image URLs, highest `wp:post_id`.

**The catalog is the only source of truth for what's proven on this site.**
Never invent a preset slug or a third-party block's attrs.

## Phase 2 — Figma intake (per visually distinct section)

For each section (hero, card grid, CTA band, FAQ …):

1. `get_metadata` — structure and component boundaries.
2. `get_design_context` — per-instance text, image asset URLs, colors,
   overrides. **Never use a master-component name as content.**
3. `get_variable_defs` — Figma variables; match them to the catalog's preset
   slugs (a Figma `Primary/600` that equals the theme's `primary` hex ->
   use the preset).
4. `get_screenshot` — visual reference for Phase 6.
5. `download_assets` — save every image to `<project>/<section>-images/`
   **immediately**; Figma asset URLs are short-lived.

## Phase 3 — Block mapping (resolve automatically; report confidence)

Ground-truth hierarchy, first that succeeds wins:

1. **A real block in `catalog.txt`** — clone it (with its wrapping group so
   spacing, width and background carry over). It already validates and
   renders on this site. **High.**
2. **A fresh core block from the helpers**, styled with the site's presets
   or raw values via `bePreset` / `beStyle`. Markup matches core `save()`
   (verified with the real validator). **High** when every style is a
   preset or verified with `gutenberg-check`; **Medium** otherwise.
3. **Third-party block** (Kadence, Spectra, GenerateBlocks, Stackable, …):
   **clone only** from the catalog, editing text only. Their save() output
   can't be verified here — never build one from scratch. **Medium.**
4. **Custom HTML block** (`beHtml`) — only when 1–3 fail. Always valid, but
   the client edits it as code. **Low.**

| Figma pattern | Block(s) | Helper / notes |
|---|---|---|
| Section band (background, padding) | `core/group` (`tagName: 'section'`), `align: 'full'` for full-bleed | `beGroup(inner, { tagName, layout })` + `bePreset`/`beStyle`; full-bleed: clone a mined `alignfull` group |
| Heading / body copy | `core/heading`, `core/paragraph` | `beHeading(html, level)`, `bePara(html)` |
| Photo | `core/image` | `beImage(url, alt)`; clone: `beSetImage` |
| Photo band with overlay text | `core/cover` | **clone a mined cover** + `beSetImage` (its markup varies by version — don't build fresh). None mined -> group with background color + image, flag it |
| Image + text side by side | `core/media-text` (clone) or `core/columns` | `beColumns([beColumn(inner, { width: '40%' }), …])` |
| Card grid | `core/columns` or group `layout: { type: 'grid', columnCount: 3 }` | one group per card |
| Button(s) | `core/buttons` > `core/button` | `beButtons([beButton(text, url)])`; styles go on the `<a>`: `beStyle(btn, …, { tag: 'a' })` |
| Bullet list | `core/list` > `core/list-item` | `beList(items, { ordered })` |
| FAQ / accordion | `core/details` (native `<details>`) | `beFaq([{ q, a }])` — independent expand; WP 6.3+ |
| Divider / gap | `core/separator`, `core/spacer` | prefer block spacing / padding over spacers |
| Logo strip / gallery | `core/gallery` (clone) or group of images | |
| Header / footer (FSE) | template part with `site-logo`, `navigation`, … | clone a mined part; keep `navigation` `ref` only if it exists on site |
| Embed, SVG icon, custom widget | `core/html` | `beHtml(html)` |

**Tabs, sliders, hover-reveal**: core has none. Use the site's own block
plugin if the catalog shows one (clone it), else a static equivalent and
**flag it** — never claim an interaction you didn't clone.

## Phase 4 — Images (per new image, before building)

Core blocks reference images by URL (`<img src>`, cover background). A
Figma asset URL left in content works for a few days, then shows an empty
box. The WordPress importer fixes this: for each `<attachment>` item it
downloads `wp:attachment_url`, re-hosts it, and **rewrites every occurrence
of that exact URL in the imported post_content**. So:

1. Put the **same** URL string in the block (`beImage(url)` / `beSetImage(node, url)`)
   and in `beRenderAttachmentItem({ source_url: url, ext: 'png' })`. Byte-identical.
2. Pick `post_id`s well above the catalog's highest id.
3. Fresh image blocks carry **no media id** (`id` attr / `wp-image-N`
   class): the importer rewrites URLs, not ids, so an id would point at the
   wrong media item. `beSetImage` strips the old id from clones for the same
   reason — otherwise WordPress adds the old image's `srcset` at render.
   Report it; the client can re-select the image to relink it.
4. **SVG icons**: WordPress blocks SVG uploads. Export with
   `download_assets(defaultFormat: 'svg')`, strip Figma's gray backdrop
   `<rect … fill="#6B6B6B"/>` and full-page `<rect>`, inline the `<svg>` in
   a `core/html` block (or as a base64 `url(data:…)` in the scoped stylesheet).
5. Site-hosted images (same host as the export) need no attachment.

**Enforced in code:** `beValidateWxrFile` throws if any image-looking or
Figma-hosted URL is neither on the site's host nor backed by an attachment
with the identical URL. Add the attachment and re-run.

## Phase 5 — Build

Write `build-<section>.js` in the **project directory**:

```js
const fs = require('fs');
const H = require('<skill>/scripts/wxr-helpers.js');
const items = H.beExtractAllContent('export.xml');
const header = H.beExtractSiteHeader('export.xml');
const home = items.find((i) => i.postId === 10).tree;           // from the catalog

const hero = H.beClone(H.beGetByPath(home, [0]));                // whole mined section
H.beSetText(H.beGetByPath([hero], [0, 0]), 'Roof Installation'); // path relative to the clone
const btn = H.beGetByPath([hero], [0, 2, 0]);
H.beSetText(btn, 'Get a quote', 'a');
H.beSetHtmlAttr(btn, 'a', 'href', '/quote');

const faq = H.beFaq([{ q: 'How long?', a: 'Two days.' }]);
const band = H.bePreset(H.beGroup([H.beHeading('Why us'), H.beImage(figmaUrl, 'Crew')], { tagName: 'section' }), { backgroundColor: 'base-2' });
H.beStyle(band, { spacing: { padding: { top: 'var:preset|spacing|60', bottom: 'var:preset|spacing|60' } } });

const content = H.beSerialize([hero, band, ...faq]);
const base = { author_login: header.author_login, site_url: header.site_url, pub_date, post_date };
const xml = [
  H.beRenderItem({ ...base, post_id: 91001, post_name: 'roof-installation', title: 'Roof Installation (Figma)', content, ...H.beItemDefaults('wp_block') }),
  H.beRenderAttachmentItem({ ...base, post_id: 91002, post_name: 'roof-crew', title: 'Roof crew', source_url: figmaUrl, ext: 'png' }),
].join('\n');
fs.writeFileSync(out, H.beRenderWxrDocument(header, xml, pub_date));
console.log(H.beValidateWxrFile(out));                           // throws on any problem
```

Rules:

1. **Clone, then override only content** (text, links, images, and styles
   Figma clearly differs on). Keep the clone's presets and layout attrs.
2. **Never `beSetAttr` a markup-affecting attr** (colors, fontSize, style,
   className, align, textAlign, level, tagName). Use `bePreset`, `beStyle`,
   `beAddClass`; for the rest change both the attr and the HTML, or rebuild
   the block with its `be*` builder.
3. `beStyle` covers color, spacing (padding/margin), typography (size,
   line-height, weight, style, letter-spacing, transform, decoration),
   border (radius, width, style, color), min-height, shadow. Anything else
   (link color, font-family preset, per-side borders, block gap in the
   editor) -> clone a mined block that already has it, or the scoped stylesheet.
4. **Scoped stylesheet** for what blocks can't express (hover states,
   decorative pseudo-elements): one `beHtml('<style>…</style>')` at the top,
   hooked via `beAddClass(node, 'f2b-…')`. Prefix every selector.
5. `beClone` refuses synced-pattern refs (`core/block` + `ref`): a copy
   would still be the same synced pattern. Clone that `wp_block`'s own
   content instead (it's in the catalog), unless the user wants it reused.
6. Output target via `beItemDefaults`:
   - pattern (default): `beItemDefaults('wp_block', { categories: [...] })` -> `wp_pattern_sync_status=unsynced`. `{ synced: true }` only if asked.
   - page: `post_type: 'page'` (status `draft`), `beItemDefaults('page')`.
   - template: `post_type: 'wp_template'`, `post_name` = template slug (`front-page`, `page`, `single`, …), `beItemDefaults('wp_template', { themeSlug })`.
   - template part: `post_type: 'wp_template_part'`, `post_name` = `header`/`footer`/…, `beItemDefaults('wp_template_part', { themeSlug, area: 'header' })`.
   A template's content is a whole page shell — clone a mined template's
   `template-part` / `post-content` structure rather than inventing one.
7. **Validate**: `beValidateWxrFile(outPath)` — well-formed XML, lossless
   round-trip, unclosed/stray comments, parent rules (`column` in `columns`,
   `list-item` in `list`, `button` in `buttons`), attr<->HTML consistency
   on every core block (classes, presets, inline styles, heading level),
   the image guard, duplicate ids, `wp_theme` term on templates. Carry its
   warnings (cross-post refs, loose HTML) into Phase 7.
8. **Real validator (recommended when available)**:
   `node <skill>/scripts/gutenberg-check/validate.mjs <out.xml>` runs
   WordPress's own `@wordpress/blocks` validator over every core block —
   the exact check the editor does. One-time `npm install` in that folder
   (~470 MB). Any INVALID line is a real editor error: fix and rebuild.
   It validates against the latest core; on an old-WP site treat a pass as Medium.

## Phase 6 — Final check (do not skip)

**Known limitation — say it:** there's no WordPress instance here to
render the front end. `gutenberg-check` proves the editor accepts the
blocks; the look is checked by reading the build against the Figma
screenshot. Offer to review a live screenshot after import.

| Check | |
|---|---|
| Every image set **and** backed by an attachment (or site-hosted) | ☐ |
| Colors/sizes use the site's presets wherever one matches Figma | ☐ |
| Typography sizes and weights match Figma per section | ☐ |
| Full-bleed sections are `alignfull`; content width matches the theme's `contentSize`/`wideSize` | ☐ |
| Buttons: filled vs outline, colors, radius (styles on the `<a>`) | ☐ |
| FAQ is `core/details` (or a cloned accordion block), not static text | ☐ |
| No leftover copy from clones (old text, alt, links, `metadata.name`) | ☐ |
| No duplicated placeholder text across repeated cards | ☐ |
| No kept `ref` pointing at a post that won't exist | ☐ |
| Mobile: columns stack (`isStackedOnMobile` default true); no fixed widths that overflow | ☐ |
| No fabricated content where Figma was ambiguous — flag it | ☐ |

## Phase 7 — Handoff

Every time:
1. The `.wxr.xml` path.
2. Import: **Tools -> Import -> WordPress** (install the importer if
   prompted), map or skip the author, **tick "Download and import file
   attachments"**. Then:
   - Pattern: in any post/page/template, **Inserter (+) -> Patterns -> My
     patterns** (also listed under **Appearance -> Editor -> Patterns** on
     FSE sites, or **wp-admin/edit.php?post_type=wp_block**). Unsynced: each
     insert is an independent copy.
   - Draft page: **Pages** -> open it.
   - Template / part: **Appearance -> Editor -> Templates / Patterns ->
     Template parts**. If the site already had a customized version with
     the same slug, the import creates a duplicate — check and delete the
     old one.
3. The Phase 3 mapping table (section / block / source / confidence).
4. Approximations and why (no preset matched, interaction not reproduced,
   Custom HTML fallback, old WP version).
5. Every new image: attachment `post_id`, URL, local backup path; note
   that images aren't linked to Media Library ids.
6. Time-sensitivity warning if any `source_url` is Figma-hosted.
7. Validator warnings and the `gutenberg-check` result (or that it wasn't run).
8. Offer to review a live screenshot after import.

---

## Third-party block plugins

| Namespace | Plugin | Rule |
|---|---|---|
| `core/` (or none) | WordPress | helpers + real validator |
| `kadence/` | Kadence Blocks | clone only; **`beRenameId(node, 'uniqueID', old + 'f2b1')` on every clone**, or two copies share one generated CSS rule set |
| `generateblocks/` | GenerateBlocks | clone only; `beRenameId(node, 'uniqueId', …)` |
| `uagb/` | Spectra | clone only; `beRenameId(node, 'block_id', …)` |
| `stackable/` | Stackable | clone only; `beRenameId(node, 'uniqueId', …)` |
| others | — | clone only; find the id-like attr in the catalog (`uniqueID`, `blockId`, `block_id`) and `beRenameId` it |

If the user supplies the plugin source, `block.json` (attributes, `save`
vs `render`) is the ground truth for a block not in the catalog.

## Multi-page projects

- One `build-<page>.js` per page with its own `post_id` range;
  `build-all-pages.js` runs each to a temp path, pulls `<item>` blocks with
  `beExtractRawItems`, and wraps them in one `beRenderWxrDocument` (the
  validator throws on duplicate ids).
- Re-auditing several pages against Figma: one research agent per page,
  reporting findings, not edits; apply fixes from one place.

## Files

- `scripts/wxr-helpers.js` — mining (`beExtractAllContent`,
  `beExtractGlobalStyles`, `beExtractAttachments`, `beExtractSiteHeader`,
  `beMaxPostId`), parse/serialize, navigation (`beGetByPath`, `beFindAll`,
  `beWalk`, `beCollectPaths`, `beClone`), in-sync editing (`beSetText`,
  `beSetHtmlAttr`, `beAddClass`, `beSetImage`, `beStyle`, `bePreset`, `beRenameId`,
  `beSetAttr`), fresh core blocks (`bePara`, `beHeading`, `beImage`,
  `beButtons`/`beButton`, `beGroup`, `beColumns`/`beColumn`, `beList`,
  `beDetails`/`beFaq`, `beSpacer`, `beSeparator`, `beHtml`, `beBlock`),
  rendering (`beItemDefaults`, `beRenderItem`, `beRenderAttachmentItem`,
  `beRenderWxrDocument`, `beExtractRawItems`), validation.
- `scripts/mine-block-data.js` — the catalog CLI (Phase 1).
- `scripts/selftest.js` — `node selftest.js` after editing the helpers.
- `scripts/gutenberg-check/validate.mjs` — optional real-validator check.

## FAQ

**Pattern, page or template?** Pattern by default: imports without
touching any live page, insertable anywhere. Page when the user asks for
"the page". Template/part only for FSE sites and only on request — it
changes how the live site renders once assigned.

**The site has no preset for a Figma color.** Use the raw value via
`beStyle` and list it in the handoff; suggest adding it to the theme's
palette (Site Editor -> Styles -> Colors) — changing theme.json is a
separate job.

**Classic theme or block theme — does it matter?** Patterns and pages work
the same on both. Only templates/parts need a block theme. Full-width
(`alignfull`) needs theme support on classic themes — clone a mined full
section to be sure it renders full-bleed.

**Can I use a live site instead of an export?** No — the export is the
source of real blocks and preset slugs.
