---
name: figma-to-divi-builder
description: Convert a Figma design section/page into a standalone importable WordPress WXR file containing a Divi Builder layout (a Divi Library `et_pb_layout` item, or a draft page), built from real section/row/column/module nodes mined from that site's own WordPress export and/or verified against the actual installed Divi theme / Divi Builder plugin / Divi extension source. Handles both Divi 4 (`[et_pb_*]` shortcodes) and Divi 5 (`<!-- wp:divi/* -->` blocks). Use whenever the user gives a Figma node link plus a WordPress export (WXR/.xml) and asks for a Divi section, page, layout or template — or mentions Divi, Divi Builder, Elegant Themes, et_pb_, Divi Library, Divi Theme Builder, or converting a Figma design into a WordPress import file for a Divi site.
---

# Figma -> Divi Builder (WXR) builder

Turns a Figma node into a standalone `.xml` file the target WordPress site can
import via **Tools -> Import -> WordPress**. By default the file holds one new
**Divi Library** item (`et_pb_layout`); on request, a **draft page** instead.
Every section/row/column/module in the output is either a deep clone of a
real, already-working node mined from that site's own export, or (when no
real instance exists to clone) built from that module's actual field
definitions in the installed Divi / extension source — never a
hand-guessed attribute set.

**Operating principle: run the phases below to completion without stopping
to ask the user mid-build.** When a section can't be proven at "High"
confidence, resolve it by falling through the ground-truth hierarchy
(mined instance -> real Divi/extension source -> Divi core module with
content-only attrs -> Code-module fallback) — don't block on it. The only
things worth interrupting the user for are the two Phase 0 inputs (WXR
export + Figma link) and a genuinely missing capability. Every
approximation, guess, or unverifiable detail goes into the Phase 7 handoff
report instead — "flag it, don't fabricate it, don't ask about it mid-build."

---

## How Divi stores a layout (read once — it drives everything below)

Unlike Beaver Builder (a PHP-serialized node tree in `_fl_builder_data`
postmeta), **a Divi layout is the post's `post_content` itself** — the WXR
`<content:encoded>` field — plus a few `_et_*` postmeta flags.

| | Divi 4 ("shortcode") | Divi 5 ("block") |
|---|---|---|
| Markup | `[et_pb_section ...][et_pb_row ...][et_pb_column type="1_2" ...][et_pb_text ...]<p>Hi</p>[/et_pb_text][/et_pb_column]...[/et_pb_section]` | `<!-- wp:divi/section {json} --> ... <!-- wp:divi/text {json} /--> ... <!-- /wp:divi/section -->`, usually inside `<!-- wp:divi/placeholder -->` |
| Module settings | Shortcode attributes, all strings; module body (text, blurb/toggle description) between the tags | Nested JSON attrs per block (e.g. `content.innerContent.desktop.value`), usually no inner HTML |
| Encoding traps | Attr values never contain raw `"` `[` `]` `\` — Divi writes `%22` `%91` `%93` `%92`. `[`/`]` in body HTML must be `&#91;`/`&#93;`. Code-module newlines are `<!-- [et_pb_line_break_holder] -->` | JSON inside the comment must escape `--`, `<`, `>`, `&` as `--`, `<`, `>`, `&` (WordPress's `serialize_block_attributes`) |
| Layout grid | `et_pb_section` > `et_pb_row` (`column_structure="1_2,1_2"`) > `et_pb_column` (`type="1_2"`) > modules. `fullwidth="on"` sections hold `et_pb_fullwidth_*` modules directly. `specialty="on"` sections hold columns > `et_pb_row_inner` > `et_pb_column_inner` | `divi/section` > `divi/row` > `divi/column` > modules — take the exact attr paths from the catalog |

`scripts/wxr-helpers.js` parses both formats into one lossless tree and
serializes it back with all of the above escaping handled — **never
hand-concatenate shortcode or block strings.**

Required postmeta: `_et_pb_use_builder = on` (without it WordPress shows
raw shortcodes, not the layout). Divi Library items also carry taxonomy
terms `layout_type` (`layout`/`section`/`row`/`module`), `scope`
(`non_global` — always, for a new item) and `module_width` (`regular`/
`fullwidth`), plus `_et_pb_built_for_post_type = page`.
`dvItemDefaultsFromExport` copies these from a real item on the site.

---

## Phase 0 — Pre-flight (fail fast, before any Figma/mining work)

| # | Check | If it fails |
|---|-------|-------------|
| 0.1 | User supplied a WXR `.xml` export **from the target site** (`Tools -> Export -> All content`) | Stop and ask for it — nothing else in this skill works without real nodes to clone. |
| 0.2 | User supplied a Figma URL containing a `node-id=` param | Stop and ask for it. |
| 0.3 | `scripts/node_modules/` exists | Run `npm install` inside `scripts/` (needs `fast-xml-parser`). |
| 0.4 | The export contains Divi content (any post with `[et_pb_section` or `<!-- wp:divi/`) | If mining reports zero layouts, tell the user the export has no Divi content to clone from, rather than guessing. Common cause: they exported a single post type that has none — ask for "All content". |
| 0.5 | Note the format(s) the catalog reports (`shortcode`, `block`, or both) | Build in the format the site's **own** content uses. Mixed = the site is mid-migration to Divi 5: build in `block` if any block layouts exist, and say so in the handoff. |

Re-exporting is only needed once per site, and again later if that site's
Divi content has changed since the last export.

## Phase 1 — Mine & catalog (always run; never assume the module set)

```bash
node ~/.claude/skills/figma-to-divi-builder/scripts/mine-divi-data.js \
  export.xml --out catalog.txt
```

Prints, for every Divi layout in the export (library items, Theme Builder
layouts, and every Divi-built page/post/project — **most real Divi content
lives on pages, not in the Library**):

- an outline of every node with its **element path** (`path=1.0.0.2` =
  2nd section -> 1st row -> 1st column -> 3rd module) — the handle build
  scripts pass to `dvGetByPath`;
- each node's full decoded attributes and (truncated) body content;
- **SUMMARY** — module kinds and instance counts;
- **ATTRIBUTE KEYS SEEN PER KIND** — every attr key actually used on this
  site, per module. This is the site's real field list;
- **SITE FACTS** — formats, builder versions, attr-encoding tokens seen,
  highest `wp:post_id`, module presets in use, global-module links, image
  URLs already referenced.

**This catalog is the only source of truth for "what's actually available
to clone" — never invent a module kind or attribute that doesn't appear
here (or in real Divi/extension source, per the hierarchy below).**

## Phase 2 — Figma intake (per visually distinct section, not per page)

A "section" = one visually distinct pattern (hero, card grid, CTA band, FAQ
list). For **each** section on the page:

1. `get_metadata` — structure, node tree, component boundaries.
2. `get_design_context` — real per-instance text, image asset URLs, colors,
   overrides. **Never use a master-component name as content** — each
   instance of a repeated card has its own overridden title/text/image.
   `get_metadata` alone won't show these.
3. `get_screenshot` — visual reference for Phase 6.
4. `download_assets` — save every image to `<project>/<section-name>-images/`
   **immediately**. Figma asset URLs (`https://www.figma.com/api/mcp/asset/...`)
   are live but short-lived — `curl` each one now to confirm it's
   reachable and keep the local copy as a durable backup.

If the page has ≥2 distinct sections, repeat all four steps for each. A
single top-level call on a whole page reliably misses per-instance content.

## Phase 3 — Module mapping (resolve automatically; report confidence, don't gate on it)

For each Figma section, walk the **ground-truth hierarchy** in order and stop
at the first that succeeds:

1. **A real instance already in `catalog.txt`** — clone it (and its section/
   row wrapper, so spacing, max-width and background treatment carry over).
   Best evidence: it already renders correctly on the live site.
2. **Real Divi / extension source**, if supplied (`Divi/` theme or
   `divi-builder/` plugin, plus any extension plugin) — read the module's
   field definitions. See "Verifying a module against real source" below.
3. **A Divi core module with content-only attrs** — Divi core ships far more
   than Beaver Builder Lite (accordion, toggle, tabs, blurb, CTA, slider,
   counters, testimonial, pricing tables, …) and a shortcode with missing
   attrs simply renders with that module's defaults / the site's presets.
   So a core module built from content attrs only (`title`, body, `src`,
   `button_text`, `button_url`, `open`, `type`) is safe — but **all visual
   attrs must come from a mined clone or real source**. Mark it Medium.
4. **Code-module fallback** (`dvCodeModule` + `dvAccordionHtml`) — only when
   1–3 all fail (e.g. a third-party module with no source and no instance).
   A real, dependency-free substitute, not a placeholder. Mark it Low.

Confidence labels for the Phase 7 report:
- **High** — real instance in the catalog, or real source confirms the exact
  attrs needed.
- **Medium** — right module, but some behavior/style couldn't be confirmed
  (core module on content-only attrs; a Divi 5 attr path seen only once).
- **Low** — built from the Code-module fallback or assumed defaults.

### Section-pattern -> module mapping (Divi 4 slugs; Divi 5 = `divi/<name>`)

| Figma pattern | Module | Notes |
|---|---|---|
| Heading + paragraph copy | `et_pb_text` (body = HTML between tags) or `et_pb_heading` if the catalog shows the site uses it | Set body with `dvSetText`; keep the clone's font attrs unless Figma differs. |
| Plain photo | `et_pb_image` (`src`, `alt`, optional `url`) | Renders straight from the `src` URL. |
| Icon/image + title + text card | `et_pb_blurb` (`title`, `image` or `use_icon="on"` + `font_icon`, body = description) | |
| Image card whose title/description appear on hover | Only if the catalog shows a real hover pattern (a blurb/image with `__hover` attrs, a third-party flip/hover-box module) — clone that. Otherwise build it as a static blurb and **flag** the missing hover in Phase 7 | Never claim a hover effect you didn't clone or verify. |
| Button | `et_pb_button` (`button_text`, `button_url`, `url_new_window`) | Filled/outline/hover styles live in `custom_button` + `button_*` attrs — clone a mined button that already matches. |
| CTA band | `et_pb_cta` (`title`, `button_text`, `button_url`, body) — or a section with a background + text + button | |
| FAQ / accordion | `et_pb_accordion` > `et_pb_accordion_item` (`title`, `open`, body) via `dvAccordionModule(tpl, faqs)` | Real JS expand/collapse, core Divi. One-at-a-time. For independent expand, use `et_pb_toggle` per item. |
| Tabs | `et_pb_tabs` > `et_pb_tab` (`title`, body) | |
| Full-bleed band with a background photo | `et_pb_section` with `background_image` (and `parallax`, `background_size` etc. from a mined section) | Renders straight from the URL. Clone a mined section that already uses a background image so overlay/size/position attrs come along. |
| Full-width hero | `et_pb_fullwidth_header` in a `fullwidth="on"` section, or a regular section with background + text + button — whichever the site already uses | |
| Logo/testimonial/stat strips | `et_pb_image` grid / `et_pb_testimonial` / `et_pb_number_counter` or `et_pb_circle_counter` | |
| Raw HTML/embed | `et_pb_code` via `dvCodeModule` | |

## Phase 4 — Image audit & attachment wiring (per new image, before building)

Divi modules reference images **by URL** (`et_pb_image.src`, `et_pb_blurb.image`,
`background_image` on any section/row/column/module, `logo`, `portrait_url`,
…). Nothing breaks at import if that URL is a Figma asset link — the page
just shows the image **until the Figma link expires (days), then an empty
box**. That is the Divi version of Beaver Builder's attachment-id trap.

The fix relies on WordPress's own importer: for every `<attachment>` item it
downloads `wp:attachment_url`, re-hosts it in `uploads/`, and then **rewrites
every occurrence of that exact URL in the imported posts' `post_content`** to
the new local URL. So:

1. For every new image, put the **same** URL string in both the module attr
   (`dvSetAttr(img, 'src', url)`) and a `dvRenderAttachmentItem({ source_url:
   url, ... })`. Byte-identical — the rewrite is a plain string replace.
2. Pick `post_id`s well above the catalog's "highest wp:post_id".
3. Figma asset URLs have no file extension; pass `ext: 'png'`/`'jpg'`/`'svg'`
   matching the downloaded file so the attachment gets a sensible filename.
4. Keep the local backup (`<section>-images/`) regardless.

**Icons and other SVGs**: WordPress rejects SVG uploads unless the site runs
an SVG plugin, so don't make SVG attachments. Export each icon node with
`download_assets(defaultFormat: 'svg')`, which gives the correctly oriented
render (the raw `svgAssets` often need Figma's flip transforms to look
right). Strip the export's gray backdrop `<rect … fill="#6B6B6B"/>` and the
full-page `<rect width="<page w>" height="<page h>" …/>`, then inline the
result as a base64 `url(data:image/svg+xml;base64,…)` in the layout's
scoped stylesheet (a Code module). Never use a `data:` URI as a module's
`src`/`image` attr, because Divi runs those through `esc_url`, which strips
the `data:` scheme.

**Scoped stylesheet rules**: put one Code module at the top of the first
section holding `<style>…</style>`. Put it on one line, with no `[` or `]`
anywhere, so no attribute selectors (a bracket is read as a shortcode, and
an escaped `&#91;` inside `<style>` breaks the rule silently). Hook modules
to it with `module_class`. Check that braces and parentheses balance before
handoff.

Images already hosted on the target site (same host as the export's site
URL) need no attachment item — reuse their URL as-is.

**Enforced in code:** `dvValidateWxrFile` runs `dvValidateImageUrls` and
**throws** if any image-looking or Figma-hosted URL in the layout is neither
on the site's own host nor backed by an attachment item with that identical
URL. Don't work around the check; add the attachment and re-run.

**Time-sensitivity**: if any `source_url` is Figma-hosted, tell the user to
import soon, with **"Download and import file attachments"** ticked. If the
link has gone stale, the layout still imports — only the attachment fetch
fails and the URL is not rewritten. Recover by uploading the local backup to
the Media Library and swapping the image in the builder, or by regenerating
the file after a fresh Figma pull.

## Phase 5 — Build

Write `build-<section>.js` in the **project directory** (not the skill
folder), following any existing `build-*.js` there as precedent:

```js
const H = require('<skill>/scripts/wxr-helpers.js');
const layouts = H.dvExtractAllLayouts('export.xml');
const header = H.dvExtractSiteHeader('export.xml');
const home = layouts.find((l) => l.postId === 10).tree;          // from the catalog

const hero = H.dvClone(H.dvGetByPath(home, [0]));                  // whole section
const heroText = H.dvGetByPath({ children: [hero] }, [0, 0, 0]);   // path relative to the clone
H.dvSetText(heroText, '<h1>Roof Installation</h1><p>…</p>');
H.dvSetAttr(hero, 'background_image', figmaHeroUrl);               // + attachment item (Phase 4)

const content = H.dvSerialize({ format: 'shortcode', children: [hero, /* … */] });
const { meta, terms } = H.dvItemDefaultsFromExport(layouts, 'et_pb_layout', { layoutType: 'layout' });
const base = { author_login: header.author_login, site_url: header.site_url, pub_date, post_date };
const items = [
  H.dvRenderItem({ ...base, post_id: 91001, post_name: 'roof-installation', title: 'Roof Installation (Figma)', content, meta, terms }),
  H.dvRenderAttachmentItem({ ...base, post_id: 91002, post_name: 'roof-hero', title: 'Roof hero', source_url: figmaHeroUrl, ext: 'png' }),
].join('\n');
fs.writeFileSync(out, H.dvRenderWxrDocument(header, items, pub_date));
console.log(H.dvValidateWxrFile(out));                             // throws on any problem
```

Rules:

1. **Clone, then override only content** (text, links, images, colors that
   Figma explicitly differs on). Don't touch structural/spacing attrs unless
   Figma clearly differs from the cloned node.
2. `dvClone` strips `global_module` / `global_parent` / `saved_tabs` /
   `template_type` by default — a clone that kept them would *be* the global
   Library item, and editing the new layout would edit every page using it.
   Pass `{ keepGlobal: true }` only if the user explicitly wants the global
   item reused.
3. Attr values go through `dvSetAttr` (encodes `"` `[` `]` `\`); body HTML
   through `dvSetText` (escapes `[`/`]`). For Divi 5, set content with
   `dvSetAttr(node, '<dot.path>', value)` using the path shown in the
   catalog — don't guess the path.
4. After adding/removing columns in a row, call `dvSyncColumnStructure(row)`;
   column `type`s must add up to one row (`1_2,1_2`, `1_3,2_3`, `1_4,1_4,1_4,1_4`, …).
5. Keep the clone's `_builder_version`, `_module_preset`, and
   `global_colors_info` — presets and global colors live in the site's
   options (not the export) and already exist on the target site.
6. A fresh module with no instance to clone: `dvShortcode(tag, attrs, body)`
   — content attrs only unless real source confirms more (Phase 3.3).
7. Output: a **Divi Library item** by default (`post_type: 'et_pb_layout'`,
   status `publish`). If the user asks for a page, use
   `post_type: 'page'`, status `draft`, and `dvItemDefaultsFromExport(layouts, 'page')`
   (copies the site's real `_et_pb_page_layout`, `_wp_page_template`, …).
8. **Validate**: `dvValidateWxrFile(outPath)` — well-formed XML, exact parse
   round-trip, structural rules (rows inside sections, modules inside
   columns, column fractions add up, `column_structure` in sync, no loose
   modules), the Phase 4 image guard, and `_et_pb_use_builder=on`. It
   returns warnings (e.g. a kept global link) — carry them into Phase 7.
   Never skip it or swallow its error.

## Phase 6 — Final check (do this before calling it done — do not skip)

**Known limitation — say it explicitly: there is no way to render actual Divi
output from here.** There's no WordPress instance to import into and
screenshot. "Comparison" means a careful read of what the build script sets
against the Figma screenshot, not a pixel diff. Offer to review a live
screenshot after import — that's what actually closes the loop.

| Check | |
|---|---|
| Every card/block has its image set **and** an attachment item (or a site-hosted URL) | ☐ |
| Hover/reveal treatments present where Figma shows them — or flagged | ☐ |
| Background photos/bands on the right section (not leaking from the cloned source) | ☐ |
| Typography sizes and colors match Figma per section (incl. `_tablet`/`_phone` variants on the clone) | ☐ |
| Button styles correct (filled vs outline, colors, hover) | ☐ |
| Interactive elements are real modules (accordion/toggle/tabs), not static text | ☐ |
| No leftover copy from the cloned source (old headings, alt text, links, `admin_label`) | ☐ |
| No duplicated placeholder text across repeated cards | ☐ |
| No global-module links kept by accident (validator warnings) | ☐ |
| No fabricated content where Figma was ambiguous — flag it instead | ☐ |

Cloning whole sections makes "leftover copy" the most likely Divi-specific
miss: a cloned blurb keeps its old `alt`, `url`, and `admin_label`; a cloned
section keeps its old `background_image`. Walk every attr in the catalog for
each cloned node and decide keep/override.

## Phase 7 — Handoff

Provide, every time:
1. The `.wxr.xml` file path.
2. Import instructions: **Tools -> Import -> WordPress** (install the
   WordPress Importer if prompted), map or skip the author, **tick "Download
   and import file attachments"**. Then:
   - Library item: **Divi -> Divi Library** shows it; on any page open the
     Divi Builder -> **Add From Library -> Your Saved Layouts** (or "Load
     From Library") and pick it.
   - Draft page: **Pages** -> open it -> Enable/Edit with Divi.
3. The Phase 3 mapping table (section / module / source / confidence).
4. Approximations and why (a color not confirmed, a hover effect not
   reproduced, a Code-module fallback, a module left on defaults/presets).
5. Every new image: attachment `post_id`, URL, and local backup path.
6. The time-sensitivity warning if any `source_url` is Figma-hosted.
7. Validator warnings, if any.
8. An offer to review a live screenshot after import (Phase 6 limitation).

---

## The module landscape: don't assume a source from a prefix

| Source | Slug convention | Examples | Verify via |
|---|---|---|---|
| Divi core (theme or Divi Builder plugin) | `et_pb_*` (Divi 4), `divi/*` (Divi 5) | `et_pb_text`, `et_pb_image`, `et_pb_blurb`, `et_pb_accordion`, `et_pb_fullwidth_header` | `Divi/includes/builder/module/*.php` (Divi 4); the Divi 5 module definitions in the theme source (search for `"divi/<name>"`) |
| Divi extensions (third-party plugins) | their own prefix, **not reliable** | commonly `dsm_` (Divi Supreme), `dipi_` (Divi Pixel), `dipl_` (Divi Plus), `difl_` (DiviFlash), `dnxte_` (Divi Next/Essential) — confirm per site | the plugin's module class (`public $slug = '...'`) and its `get_fields()` |
| Divi Library items | post type `et_pb_layout` | saved layouts/sections/rows/modules, global items (`scope=global`) | already surfaced by Phase 1 mining |
| Divi Theme Builder | `et_template`, `et_header_layout`, `et_body_layout`, `et_footer_layout` | headers, footers, post templates | Phase 1 mining (header/footer patterns worth cloning) |
| Presets & global colors | `_module_preset="…"`, `gcid-…` in attrs | site-wide style defaults | stored in site options, **not** in the WXR — they exist on the target site, so keep references on clones |

If the user supplies the actual theme/plugin zips (`Divi/`, `divi-builder/`,
extension plugins), that's the best ground truth for anything not in the
export. There is no free "Lite" Divi to fall back to — Divi is paid-only.

**Runtime: Node.js, not PHP.** Every script here is Node.js (`fast-xml-parser`
is the only dependency). Divi 4 content is plain shortcode text and Divi 5
content is JSON, so no PHP (un)serialization is involved.

## Interactive behavior (accordions, toggles, tabs, sliders)

A FAQ built as N static text modules looks right in a screenshot and does
nothing when clicked. Divi core ships the real thing in every install:

1. **Accordion** — `dvAccordionModule(tpl, faqs)`; pass a mined
   `et_pb_accordion` as `tpl` so its styling and its first item's styling
   carry over to every generated item. One item open at a time; first open.
2. **Toggle** — `et_pb_toggle` (`title`, `open="on|off"`, body), one per
   item, when items should open independently.
3. **Tabs / slider / counters** — `et_pb_tabs`/`et_pb_tab`,
   `et_pb_slider`/`et_pb_slide`, `et_pb_number_counter` — clone a mined
   instance if one exists; otherwise content attrs only (Medium).
4. **Code-module fallback** — only for an interaction no core or installed
   module can express: `dvCodeModule(tpl, dvAccordionHtml(items, { accentColor }))`
   (native `<details>/<summary>`, no JS, no attribute selectors so nothing
   is read as a shortcode). Pass the site's real accent color.

For Divi 5 sites, the same rule applies with `divi/accordion` etc. — clone a
mined block; `dvAccordionModule`/`dvCodeModule` build Divi 4 shortcodes only.

### Verifying a module against real source

1. **Divi 4 core**: `Divi/includes/builder/module/<Name>.php` (e.g.
   `Accordion.php`, `AccordionItem.php`, `Blurb.php`). `$this->slug` is the
   shortcode tag; `get_fields()` lists every content field with its
   default; `get_advanced_fields_config()` generates the design attrs
   (`<prefix>_font`, `<prefix>_text_color`, `custom_button`, `button_*`,
   borders, box shadows), which is why design attr names are best taken
   from a mined instance; `render()` shows what is actually output.
2. **Divi 5 core**: find the module's definition by its block name
   (`divi/<name>`) in the theme source; its attribute metadata gives the
   real JSON paths. Cross-check against a mined instance before writing.
3. **Extensions**: the module class in the plugin (`class X extends
   ET_Builder_Module`), same `slug` / `get_fields()` pattern.
4. Nothing found anywhere -> Code-module fallback, Low confidence.

## Attribute shapes: verify before writing

Most Divi 4 attrs are flat strings, but several pack multiple values:
`custom_padding` / `custom_margin` = `top|right|bottom|left|linkedTB|linkedLR`
(e.g. `40px||40px||true|false`), `*_font` = `family|weight|italic|uppercase|underline|…`
(e.g. `Poppins|600|||||||`), `box_shadow_*`, `border_radii` =
`on|tl|tr|br|bl`, and `_tablet` / `_phone` / `__hover` / `_last_edited`
variants (`text_font_size_tablet="16px" text_font_size_last_edited="on|phone"`).
Copy the exact shape from a mined instance in the catalog and change only
the part Figma differs on. Divi 5 packs everything into nested JSON by
breakpoint/state (`...desktop.value`, `...tablet.value`, `...desktop.hover`)
— again, take the path from the catalog.

## Multi-page projects

- **Parallel research**: when re-auditing several built pages against Figma,
  dispatch one research agent per page (Figma file key + node id, the
  existing `build-<page>.js`, and instructions to report concrete
  section-by-section findings, not edits). Apply fixes from one place.
- **One combined import**: add `build-all-pages.js` that runs each
  `build-<page>.js` to a temp path (`execFileSync`), pulls all `<item>`
  blocks with `dvExtractRawItems`, concatenates them and wraps them in one
  `dvRenderWxrDocument`. Give each page script its own `post_id` range —
  the validator throws on duplicate ids.

## Files

- `scripts/wxr-helpers.js` — the core library: mining
  (`dvExtractAllLayouts`, `dvExtractAttachments`, `dvExtractSiteHeader`,
  `dvItemDefaultsFromExport`, `dvMaxPostId`), parse/serialize (`dvParse`,
  `dvSerialize`, `dvDetectFormat`), navigation (`dvGetByPath`, `dvFindAll`,
  `dvWalk`, `dvCollectPaths`), editing (`dvClone`, `dvGetAttr`, `dvSetAttr`,
  `dvSetText`, `dvShortcode`, `dvSyncColumnStructure`, `dvEncodeAttr`/
  `dvDecodeAttr`), interactive/fallback (`dvAccordionModule`, `dvCodeModule`,
  `dvAccordionHtml`), rendering (`dvRenderItem`, `dvRenderAttachmentItem`,
  `dvRenderWxrDocument`, `dvExtractRawItems`), validation (`dvValidateTree`,
  `dvValidateImageUrls`, `dvValidateWxrFile`). Parsed nodes remember their
  original open tag, so untouched nodes re-serialize byte-for-byte.
- `scripts/mine-divi-data.js` — the catalog CLI (Phase 1).

In the target project (not this skill folder): one `build-<page>.js` per
page/section, plus an optional `build-all-pages.js`.

## FAQ

**Do I need to re-export every time?** No — only for a different site, or
when this site's Divi content has changed since the last export.

**Library item or page?** Library item by default: it imports without
touching any live page, and can be dropped into any page (or several) from
the builder. Build a draft page when the user asks for "the page".

**What if the site has no module for something in the design** (a star
rating, a stat)? Fold it into a field already proven to accept HTML (e.g.
★★★★★ in a text module) rather than guessing at an uninstalled extension.
Report it in Phase 7.

**The site is on Divi 5 but the export has only a few block layouts.** Build
in `block` format by cloning those. If none exist for a needed module, a
Divi 4 shortcode layout is the fallback — Divi 5 is designed to load Divi 4
content through its backward-compatibility layer — but say so in the
handoff and ask the user to confirm it opens correctly in the builder.

**Can I use this on a live site instead of an export file?** No — the WXR
export is the source of truth for real, proven nodes.
