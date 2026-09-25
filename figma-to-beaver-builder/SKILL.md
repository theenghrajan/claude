---
name: figma-to-beaver-builder
description: Convert a Figma design section/page into a standalone importable WordPress WXR file containing a Beaver Builder template, built from real node objects mined from that site's own WordPress export and/or verified against the actual installed plugin source (Beaver Builder core, PowerPack Elements, Ultimate Addons for Beaver Builder/UABB, theme builder, WP widgets). Use whenever the user gives a Figma node link plus a WordPress export (WXR/.xml) and asks for a Beaver Builder section, page, or template — or mentions Beaver Builder, PowerPack, UABB/Ultimate Addons, fl-builder-template, or converting a Figma design into a WordPress import file.
---

# Figma -> Beaver Builder (WXR) builder

Turns a Figma node into a standalone `.xml` file the target WordPress site can
import via **Tools -> Import -> WordPress**, containing one new
`fl-builder-template` post. Every row/column/module in the output is either a
deep clone of a real, already-working node mined from that site's own export,
or (when no real instance exists to clone) constructed from that module's
actual settings-form source in the installed plugin — never a hand-guessed
settings schema.

**Operating principle: run the phases below to completion without stopping
to ask the user mid-build.** When a section can't be proven at "High"
confidence, resolve it by falling through the ground-truth hierarchy
(mined instance -> real plugin source -> free Lite zip -> HTML fallback) —
don't block on it. The only things worth interrupting the user for are the
two Phase 0 inputs (WXR export + Figma link) and a genuinely missing
capability (e.g. plugin source needed to verify a field and none was
supplied and no fallback applies). Every approximation, guess, or
unverifiable detail gets written down in the Phase 7 handoff report instead
— "flag it, don't fabricate it, don't ask about it mid-build."

---

## Phase 0 — Pre-flight (fail fast, before any Figma/mining work)

| # | Check | If it fails |
|---|-------|-------------|
| 0.1 | User supplied a WXR `.xml` export **from the target site** (`Tools -> Export -> All content`) | Stop and ask for it — nothing else in this skill works without real nodes to clone. |
| 0.2 | User supplied a Figma URL containing a `node-id=` param | Stop and ask for it. |
| 0.3 | `scripts/node_modules/` exists | Run `npm install` inside `scripts/` (needs `php-serialize`, `fast-xml-parser`). |
| 0.4 | The export actually contains at least one `fl-builder-template` post | If not, mining will report zero templates — tell the user the export has no Beaver Builder content to clone from, rather than proceeding to guess. |

Re-exporting is only needed once per site, and again later if that site's
Beaver Builder content has changed since the last export.

## Phase 1 — Mine & catalog (always run; never assume the module set)

```bash
node ~/.claude/skills/figma-to-beaver-builder/scripts/mine-fl-builder-data.js \
  export.xml --out catalog.txt
```

Prints every real row/column-group/column/module node found in every
`fl-builder-template` item, plus a summary of module kinds (`settings->type`)
and instance counts (e.g. `info-box x16, pp-heading x8,
interactive-banner-2 x8, pp-image x2`). After running, note for yourself:
which module kinds exist and how many of each, and whether any `global: true`
nodes or separate `fl-builder-template`/`fl-builder-block-template` items
(this site's own saved patterns) are present. **This catalog is the only
source of truth for "what's actually available to clone" — never invent a
module kind or settings field that doesn't appear here (or in real plugin
source, per the ground-truth hierarchy below).**

## Phase 2 — Figma intake (per visually distinct section, not per page)

A "section" = one visually distinct pattern (hero, card grid, CTA band, FAQ
list). For **each** section on the page:

1. `get_metadata` — structure, node tree, component boundaries.
2. `get_design_context` — real per-instance text, image asset URLs, colors,
   overrides. **Never use a master-component name as content** — a repeated
   card/component shares one component name but each instance has its own
   overridden title/description/image (Figma's instance-override mechanism).
   `get_metadata` alone won't show these.
3. `get_screenshot` — visual reference to compare the finished build against
   in Phase 6.
4. `download_assets` — save every image to
   `<project>/<section-name>-images/` **immediately**. Figma asset URLs
   (`https://www.figma.com/api/mcp/asset/...`) are live but short-lived
   (`cache-control: private, no-store`) — `curl` each one now to confirm
   it's reachable and keep the local copy as a durable backup.

If the page has ≥2 distinct sections, repeat all four steps for each. A
single top-level call on a whole page reliably misses per-instance content.

## Phase 3 — Module mapping (resolve automatically; report confidence, don't gate on it)

Before writing code, work out which real module each Figma section maps to.
Use the "Section-pattern -> module mapping" table below for the two patterns
this project got wrong before. For anything not covered there, walk the
**ground-truth hierarchy**, in order, and stop at the first that succeeds:

1. **A real instance already in `catalog.txt`** — clone it. Best possible
   evidence; it's already rendering correctly on the live site.
2. **Real plugin/theme source**, if supplied (`bb-plugin/`, `bbpowerpack/`,
   `bb-ultimate-addon/`, `bb-theme/`, `bb-theme-builder/`) — read the
   module's own `get_data()`/`render_*()` and its `-compatibility.php`/
   `settings.php` field list. See "Verifying a module against real plugin
   source" below.
3. **Free Beaver Builder Lite zip** (core modules only) — for modules absent
   from the export and not covered by supplied plugin source.
4. **HTML-module fallback** (`flHtmlModule` + `flAccordionHtml`) — only when
   1–3 all fail (e.g. a Pro-only module with no source supplied). This is a
   real, working, dependency-free substitute, not a placeholder.

For the Phase 7 report, label each section's confidence:
- **High** — real instance in the catalog, or plugin source confirms the
  exact field behavior needed.
- **Medium** — a real instance or module exists, but one specific behavior
  (usually an image field) couldn't be confirmed against source.
- **Low** — no real instance and no plugin source; built from the HTML
  fallback or from assumed defaults.

Report the mapping as a table (section, module, source, confidence) in the
handoff — this is what lets the user spot-check the riskiest parts of an
otherwise-automatic build, without you having to pause and ask mid-build.

### Section-pattern -> module mapping

| Figma pattern | Real module | Source | Notes |
|---|---|---|---|
| Image card grid where hovering reveals a title + description over the image | `interactive-banner-2`, `banner_style: 'style1'` | UABB | The *only* proven module on this class of site with hover-reveal-description behavior. Clone a real working instance if the homepage has promo/service cards — don't build a heading+pp-image combo and call it a card. |
| A plain photo (no hover, no overlay text) | `pp-image`, set `photo_src` | PowerPack | Renders directly from the URL string when `photo_source: 'library'` — no attachment id needed (confirmed in `pp-image.php`'s `_has_source()`). Not true for `interactive-banner-2` (next row). |
| A purpose-built FAQ/accordion list | `uabb-faq`, `faq_layout: 'accordion'` | UABB | See "Interactive behavior" below — use `flUabbFaqModule`, don't hand-roll one. |
| Full-bleed section with a background photo + heading/CTA on top | a `row`/`column` with `bg_type: 'photo'`, cloned from a real row/column that already uses a photo background | Core (Beaver Builder) | Renders `bg_image_src` **directly as the CSS `background-image` URL** when the cloned node's `bg_image_source` is `'library'` (confirmed in `row-css.php`) — no real attachment strictly required, unlike `interactive-banner-2`. |

**The "PowerPack vs UABB" column is not cosmetic** — get it wrong and you'll
check the wrong plugin's source when verifying a field. `info-box` and
`interactive-banner-2` are UABB (confirmed by directory name,
`bb-ultimate-addon/modules/info-box/` and `.../interactive-banner-2/`),
**not** PowerPack, despite PowerPack having similarly-purposed `pp-` modules
alongside them. An earlier pass mislabeled both from having seen them next
to real `pp-` modules — don't repeat that; check the actual module
directory.

## Phase 4 — Image audit & attachment wiring (per new image, before building)

For every image asset pulled from Figma, determine which real field
consumes it — this decides whether it also needs a WXR `<attachment>` item:

| Target field | Needs a WXR `<attachment>` item? | Why |
|---|---|---|
| `interactive-banner-2.banner_image` | **Yes — mandatory** | `get_data()` calls `FLBuilderPhoto::get_attachment_data($this->settings->banner_image)` first; an arbitrary URL string in `banner_image_src` alone satisfies neither that call nor its fallback. |
| `info-box.photo` (when the image feature is used) | **Yes — mandatory** | Same UABB pattern; the module's own official code checks `!empty($photo) && !empty($photo_src)` before treating an image as resolved. |
| `row.bg_image` / `column.bg_image` | No (harmless if added anyway) | Renders straight from the `_src` URL when `bg_image_source: 'library'` (confirmed in `row-css.php`). |
| `pp-image.photo_src` | No | Renders straight from the URL string when `photo_source: 'library'` (confirmed in `pp-image.php`). |

If an attachment is required:
1. Pick a `post_id` well outside the export's used id range (WordPress's
   importer preserves an explicit id when that slot is free).
2. `flRenderAttachmentItem(...)` with that `post_id` and the (live, at
   generation time) `source_url`.
3. Set the module's id field (`banner_image`, `photo`) to that same
   `post_id`, as a string — not the URL.
4. Keep the local backup (`<section>-images/`) regardless.

**This is now enforced in code, not just documentation.**
`flValidateWxrFile` (called automatically by every `build-*.js` script)
runs `flValidateAttachmentFields(tree)` and **throws** if any
`interactive-banner-2`/`info-box` node has an image `_src` set but no
numeric attachment id in the paired id field — the exact bug that silently
collapsed the "Our Areas of Expertise" cards on the About page to zero
height while their text content was perfect. A build can no longer finish
and validate clean while carrying this bug; if you see this error, wire the
missing attachment and re-run, don't work around the check. The registry of
which module/field pairs need this (`ATTACHMENT_ID_FIELDS` in
`wxr-helpers.js`) is a plain object — extend it there (not with an ad hoc
if-branch in a build script) if plugin source confirms a new module has the
same requirement.

**Time-sensitivity**: if `source_url` is a Figma-hosted asset link, tell the
user in the handoff to import soon. If the link goes stale before import,
the page template itself still imports fine — only the `attachment` item
fails to fetch — recoverable via a fresh Figma pull or manually uploading
the local backup and re-pointing the field.

## Phase 5 — Build

Write `build-<section>.js` in the **project directory** (not the skill
folder), following any existing `build-*.js` in that project as precedent:

1. `flExtractAllTemplates(xmlPath)` — load real node trees.
2. Pull the specific real node objects to reuse as templates, by id, found
   via the Phase 1 catalog.
3. `flDeepClone` each one, `flGenId` a fresh id, override **only** content
   fields (text, colors, images, links) on the copy. Don't mutate
   structural fields (width, responsive, margins) unless Figma explicitly
   differs from the cloned template.
4. If constructing a fresh module with no real instance to clone (e.g.
   `flUabbFaqModule`), use `flBlankTypography()`/`flBlankBorder()` for any
   unset nested field — confirm the real populated shape in `catalog.txt`
   before writing into any nested field (see "Nested settings fields"
   below); don't assume a flat convention.
5. `flSerialize(tree)` — never hand-build the serialized string.
6. `flRenderItem(...)` wraps it in a WXR `<item>`, reusing the export's real
   site title/URL/author (`flExtractSiteHeader`) — nothing hardcoded. Add an
   `flRenderAttachmentItem(...)` per new image that needs one (Phase 4).
7. `flRenderWxrDocument(header, itemsXml, pubDate)` wraps everything into
   one importable file (`itemsXml` can be several concatenated `<item>`
   blocks — the page plus its attachments).
8. **Validate**: `flValidateWxrFile(outPath)` — well-formed XML, a
   functional round-trip of every `_fl_builder_data` value, and the
   attachment-id guard from Phase 4. Every `build-*.js` script calls this
   automatically at the end; don't skip it or swallow its error.

## Phase 6 — Final check (do this before calling it done — do not skip)

**Known limitation, state it explicitly to the user rather than implying
otherwise: there is no way to render actual Beaver Builder output from
here.** This skill can screenshot the *Figma* side but has no WordPress
instance to import into and screenshot back. "Comparison" means a careful
read of what the build script sets against the Figma screenshot, not a
pixel diff. Offer to review a live screenshot the user sends back after
import — that's what actually closes the loop.

Walk every section against its Figma screenshot and confirm:

| Check | |
|---|---|
| Every card/block has its image loaded (not just alt text / an empty container) | ☐ |
| Hover/reveal treatments present where Figma shows them | ☐ |
| Background photos/bands present and correct (not leaking from another section) | ☐ |
| Typography sizes and colors match Figma per section | ☐ |
| Button styles correct (filled vs outline, colors, hover states if visible) | ☐ |
| Interactive elements actually *do* something (accordion expands, toggle switches) — not just static text | ☐ |
| No duplicated placeholder text across repeated cards | ☐ |
| No fabricated content where Figma was ambiguous — flag it instead (Phase 7) | ☐ |

This step was skipped once building the About page (cards had correct text
but no image or hover effect — never caught before handoff) and again for
the FAQ accordion (text correct, but functionally dead — a user caught it
by clicking). Both gaps would have been caught here. If anything still
can't be confirmed after this pass, don't silently ship a plausible guess —
carry it into Phase 7 instead.

## Phase 7 — Handoff

Provide, every time:
1. The `.wxr.xml` file path.
2. Import instructions: `Tools -> Import -> WordPress` on the target site,
   map or skip the author. Attachment items with a live source URL are
   downloaded and sideloaded automatically by WordPress's importer at this
   step.
3. The Phase 3 mapping table (section / module / source / confidence).
4. Any approximations made and why (a color that couldn't be confirmed, a
   section built via HTML fallback, a field left at a plugin default).
5. Every new image wired as an attachment, with its local backup path.
6. The time-sensitivity warning if any `source_url` is Figma-hosted — import
   soon.
7. An offer to review a live screenshot after import, given the Phase 6
   limitation.

---

## The module landscape: five sources, don't assume one from a prefix

| Source | Prefix convention | Examples | Verify via |
|---|---|---|---|
| Beaver Builder core (Lite or Pro) | none | `photo`, `heading`, `html`, `button`, `accordion` (Pro only) | `bb-plugin/modules/` |
| PowerPack Elements | `pp-` | `pp-heading`, `pp-image`, `pp-faq`, `pp-advanced-accordion` | `bbpowerpack/modules/` |
| UABB / Ultimate Addons for Beaver Builder | **no consistent prefix** | `info-box`, `interactive-banner-2`, `uabb-faq`, `advanced-accordion` | `bb-ultimate-addon/modules/` |
| WordPress Widgets | wrapped by core `widget` module | any registered WP widget | the widget's own registration |
| Saved/global modules & templates | n/a — this site's own prior work | `global: true` nodes, separate `fl-builder-template`/`fl-builder-block-template` items | already surfaced by Phase 1 mining |

If the user supplies the actual plugin/theme zips (extracted as
`bb-plugin/`, `bbpowerpack/`, `bb-ultimate-addon/`, `bb-theme/`,
`bb-theme-builder/`), that's the best available ground truth — see
"Verifying a module against real plugin source" below. Without those, fall
back to the free Beaver Builder Lite zip (core modules only), or to the
site's own export.

**Runtime: Node.js, not PHP.** This machine (and possibly others this skill
runs on) has no PHP CLI installed, so every script here is Node.js, using
the `php-serialize` npm package to read/write PHP's exact serialization
format. Run everything with `node`, never `php`.

## Interactive behavior (accordions, toggles): don't guess a module schema

Some Figma sections need real interactivity this site's export has no
proven *instance* for — the clearest case: an FAQ list where clicking a
question expands/collapses its answer. Building it as N static `info-box`
rows (title = question, text = answer) looks right in a screenshot but
**has no click-to-expand behavior at all** — this shipped once already and
the user caught it immediately by actually clicking the page.

No real instance existing in the export does **not** mean no real module
exists — this is exactly Phase 3's ground-truth hierarchy:

1. Check `bb-plugin/modules/accordion` (core, Pro-only — absent from the
   free Lite zip), `bbpowerpack/modules/pp-faq` /
   `pp-advanced-accordion` (PowerPack), and
   `bb-ultimate-addon/modules/uabb-faq` / `advanced-accordion` (UABB). This
   project settled on **UABB's `uabb-faq`** (`flUabbFaqModule` in
   `wxr-helpers.js`) — real JS-driven expand/collapse, ARIA roles, one item
   open by default, one-at-a-time collapse, using field names and defaults
   transcribed directly from `uabb-faq-bb-2-2-compatibility.php`.
2. Only if no plugin/theme source is available at all (no zips supplied,
   and the module isn't in the free Lite zip either — e.g. its accordion is
   Pro-only), fall back to the core **`html`** module (class
   `FLHtmlModule`, field `html`, ships in every install) via
   `flHtmlModule(tpl, htmlContent)` + `flAccordionHtml(items, opts)`: a
   self-contained `<details>/<summary>` accordion, no JS dependency. This is
   a real fallback, not a placeholder — prefer the real module whenever its
   source is available to verify against.
3. This applies to *any* needed interaction (tabs, toggles, carousels,
   sliders) the export doesn't already have a real instance of — check real
   plugin source for a purpose-built module before reaching for the
   `html`-module fallback, and never guess a proprietary module's settings
   shape from memory or convention.

### Verifying a module against real plugin source

If the user supplies the site's actual plugin/theme files, this is strictly
better evidence than either a mined real instance *or* a guess — it's the
literal PHP that decides what every field does:

1. Find the module's directory: `<plugin>/modules/<slug>/`. The directory
   name is the module's `settings->type` slug (confirmed repeatedly:
   `interactive-banner-2`, `info-box`, `uabb-faq` all match their folder
   names exactly).
2. Read `<slug>.php` for the module class — its `get_data()`/`render_*()`
   methods show exactly which settings field is actually read at render
   time (this is how the `banner_image` attachment-id trap was confirmed,
   and how it was confirmed *not* to apply to `pp-image` or row/column
   backgrounds).
3. Read `<slug>-bb-2-2-compatibility.php` (or `settings.php` on older/
   simpler modules) for the full settings-form field list, including each
   field's real default value — use this to construct a fresh node's
   settings object from the module's own shipped defaults when no real
   instance exists to clone (see `flUabbFaqModule` for a worked example).
4. `bb-plugin/data/*.dat` (Beaver Builder's own official prebuilt row
   library) is PHP-serialized in the *exact same* node-tree shape as
   `_fl_builder_data` — worth checking for a real, complete, working example
   of a design pattern (hero band, CTA, FAQ list) the site's own export has
   no instance of. There are entries literally named `row-11-Faq-1.dat`
   through `row-15-Faq-5.dat`, `row-81-Heroes-1.dat` onward, etc.
5. If nothing above yields ground truth (module absent from every supplied
   source, and absent from the free Lite zip too), only then fall back to
   the `html`-module workaround above.

## Nested settings fields: verify the real shape before writing into it

Not every settings field is a flat string. Some (border, box-shadow,
gradients, typography) are nested arrays/objects with their own sub-keys,
and the *unset* default is often a plain empty string (`''`), not the full
nested shape — you only see the real shape by finding one real instance in
`catalog.txt` where that field is actually configured. Example: a column's
`border` field defaults to `''`, but once set looks like
`{ style, color, width: {top,right,bottom,left}, radius: {...}, shadow: {...} }`.
Setting `node.settings.border.style = 'x'` when the field is still the
default `''` string silently does nothing (or throws) — always confirm the
real populated shape in the catalog first, then replace the whole field
with a same-shaped object.

## Multi-page projects: parallelize the Figma-comparison research

When re-auditing several already-built pages against Figma (not building
from scratch), dispatch one research agent per page rather than working
through them serially — each agent needs: the Figma file key + that page's
node id, the existing `build-<page>.js` to read for current content/known
gaps, and instructions to report concrete section-by-section findings (not
vague "looks close") including any real hex colors/asset URLs it fetches.
Keep agents to *reporting* findings only (no file edits) so the fixes get
applied consistently from one place afterward. This found real, specific,
fixable gaps (missing background photos, inverted card colors, wrong
typography sizes, a dead FAQ accordion) across four pages in parallel in
about the time one page would normally take serially.

## Building a combined file for multiple pages

If asked for "all the pages in one file" (one import instead of five), add
a `build-all-pages.js` in the project that: lists every `build-<page>.js`
script, runs each with `execFileSync` against a temp output path, pulls
every `<item>` block out of each temp file with `flExtractRawItems(tmpPath)`
(covers both the page template item and its image `attachment` items),
concatenates all of them, and wraps the result in one
`flRenderWxrDocument(...)` call. Each individual `build-<page>.js` stays
independently runnable — this is purely an aggregation step, not a
different code path. Sanity-check the result has no duplicate `wp:post_id`
across pages (each page script should already use a distinct id range; a
duplicate there is a bug to fix in the page script, not in the combiner).

## Files

- `scripts/wxr-helpers.js` — the core library (`flExtractAllTemplates`,
  `flExtractSiteHeader`, `flDeepClone`, `flGenId`, `flHtmlModule`,
  `flAccordionHtml`, `flUabbFaqModule`, `flBlankTypography`, `flBlankBorder`,
  `flSerialize`/`flUnserialize`, `flRenderItem`, `flRenderAttachmentItem`,
  `flRenderWxrDocument`, `flExtractRawItems`, `flValidateWxrFile`,
  `flValidateAttachmentFields`, `ATTACHMENT_ID_FIELDS`). Read the file's
  header comment for the one known, harmless divergence from PHP's native
  `serialize()` (whole-number floats round-trip as ints — doesn't affect
  rendering). `flBlankTypography`/`flBlankBorder` return the exact "unset"
  shape of Beaver Builder's typography/border field types — reuse them
  whenever constructing a fresh module's settings from plugin-source
  defaults rather than a real clone. `flValidateAttachmentFields` /
  `ATTACHMENT_ID_FIELDS` are the Phase 4 runtime guard — extend the
  registry there when a new module is confirmed to need a real attachment
  id, rather than adding a one-off check in a build script.
- `scripts/mine-fl-builder-data.js` — the catalog/mining CLI (Phase 1).

In the target project directory (not this skill folder), the convention is
one `build-<page>.js` per page/section, plus an optional
`build-all-pages.js` that combines all of them (see above).

Run `npm install` once inside `scripts/` if `node_modules/` is missing
(`php-serialize`, `fast-xml-parser`).

## FAQ

**Do I need to re-export every time?** No — only when the site is different,
or the same site's Beaver Builder content has changed since your last
export.

**What if the site has no matching module for something in the Figma
design** (a star rating, a stat counter)? Fold it into a field already
proven to accept raw HTML (e.g. render a 5-star rating as Unicode ★
characters inside a heading/title field) rather than guessing at a plugin
feature that might not be installed. Report this in Phase 7 — don't ask
about it mid-build.

**What if a section can't be verified at High confidence and no plugin
source was supplied?** Resolve it via the ground-truth hierarchy (Phase 3)
down to the HTML fallback if needed, build it, and mark it Low confidence
in the Phase 7 report. Don't stop and ask unless the two Phase 0 inputs
themselves are missing.

**Can I use this on a live site instead of an export file?** No — the
workflow needs the WXR file as its source of truth for real, proven node
examples.
