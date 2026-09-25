---
name: figma-to-wp
description: SmartSites ss_theme workflow for converting Figma designs into WordPress themes with ACF Flexible Content and Tailwind CSS v3. Use this skill whenever the user works on an ss_theme-based project or mentions building a section, module, page, or component from a Figma design or static HTML; creating or editing ACF field groups or flexible content layouts; generating a tailwind.config.js from Figma design tokens; registering custom post types; or anything involving the ss_ prefix, group_ss_reusable_modules.json, or template-parts/modules. Also use it when the user asks to extract design tokens from a Figma file/URL.
---

# Figma → WordPress (ss_theme) Development

You are working in the SmartSites Nepal **ss_theme** ecosystem: WordPress + ACF Pro Flexible Content + Tailwind CSS v3, built from Figma designs. Source files (`tailwind/`, `javascript/`) compile into the served theme (`theme/`) via npm scripts.

## Pre-Task Protocol (always, before writing any code)

1. **Confirm inputs exist**: the Figma design (or exported Figma JSON / static HTML reference), the project brief, and the project's `tailwind/tailwind.config.js`. If any is missing, stop and ask for it — never assume design values, copy, or requirements.
2. **State your understanding and wait for approval**:
   ```
   Task:     [what you understood]
   Files:    [exact files you will create or modify]
   Approach: [pattern you will follow]
   ```
   Do not proceed until the user confirms. This protocol exists because a wrong assumption multiplied across a whole section costs far more than one confirmation round-trip.
3. **Ask, don't assume** — missing design values, unspecified copy, ambiguous scope, container vs container-fluid choice, or a choice between multiple valid patterns (module vs template-part vs inline) all require asking. One focused question at a time, and wait for the answer.

## The Two Core Workflows

### A. New project setup — Figma tokens → tailwind.config.js

1. If the user gives a Figma file/URL and node IDs, run the bundled exporter (requires the `FIGMA_TOKEN` env var — ask the user to set it, never ask them to paste the token into chat or a file):
   ```bash
   FIGMA_TOKEN=... node scripts/figma-export.js <FILE_ID> <NODE_ID> [NODE_ID...] --out _project_data/figma_json
   ```
   The FILE_ID and node-id come from the Figma URL. Otherwise read the JSON they provide (convention: `_project_data/figma_json/*.json`).
2. Read `references/figma-to-tailwind.md` and follow it exactly to generate `tailwind/tailwind.config.js` from `designTokens`. Core rule: prefer Tailwind defaults (within ±4px for spacing); add `ss-{px}` tokens only for values the default scale can't cover; font sizes always use exact Figma values.

### B. Build a section/module from a design

This is the most common task. For each section:

1. **Derive the module name** from the section's HTML `id` (kebab `ss-hero-banner` → snake `ss_hero_banner`).
2. **Confirm the container type** with the user: constrained (`container`, 1280px) or full-width (`container-fluid`)? Never assume.
3. **ACF fields** — read `references/acf-standard.md` before touching any field group. Key invariants:
   - All module layouts live in the single file `theme/acf-json/group_ss_reusable_modules.json`; append a new layout to the existing flexible content field — never create a per-module group file.
   - Every field key is fully prefixed `ss_[module_name]_[field]`; repeater sub-fields include the repeater name.
   - The `url` field type is banned — always `link` with `return_format: "array"`. Icons are `select` fields with the icomoon choices. Images return arrays.
   - Every visible string, image, icon, label, and link gets a field with `default_value` matching the design — nothing visible is ever hardcoded in PHP.
   - A `relationship` field to a CPT requires a separate `group_ss_[cpt_slug].json` on that post type.
4. **PHP template part** — `theme/template-parts/modules/ss_[module_name].php` with the documented file header; `get_sub_field()` inside flexible content, `get_field('name', $post->ID)` for CPT fields in relationship loops, `wp_reset_postdata()` after every relationship foreach. Sanitize all output: `esc_html()`, `esc_url()`, `esc_attr()`, `wp_kses_post()`.
5. **Markup** — follow `references/html-css-standards.md`: semantic HTML5, one `h1` per page, sequential headings, Tailwind utilities with the project's tokens (no arbitrary `[...]` values), mobile-first with breakpoints sm 576 / md 768 / lg 992 / xl 1200 / 2xl 1310, `<!-- Start/End Section -->` comments, 4-space indentation.
6. **JS behavior** (sliders, accordions, toggles) — read `references/javascript-guide.md`. Use the existing class-based systems (`slider-col-*`, `.slickInfinite`, `.accordion`, `.toggleBtn`) instead of writing new init code; new logic goes inside the `ss` object in `javascript/script.js` as Vanilla JS.

## Hard Rules — never break these

- **Never edit compiled output**: `theme/style.css`, `theme/style-editor*.css`, `theme/js/*.min.js`. Edit sources in `tailwind/` and `javascript/`.
- **Never hardcode** visible text, icon classes, URLs, phone numbers, or asset paths in PHP — ACF fields and WP functions (`get_template_directory_uri()`, `get_permalink()`) only.
- **No inline styles or `<script>` tags** in templates.
- **No arbitrary Tailwind values** (`text-[#123456]`, `mt-[37px]`) — use defaults or `ss-{px}` tokens; and do not add tokens to `tailwind.config.js` without explicit instruction.
- **No fixed `w-*`/`h-*` on section layouts** — padding and `min-/max-` variants instead (small icon wrappers are the exception).
- **Do not touch without explicit instruction**: `functions.php`, `tailwind.config.js`, `theme.json`, `package.json`/`composer.json` (no new dependencies), existing working components, or folder structure. No renaming existing classes/selectors.
- **No scope creep**: build only the requested section — no adjacent sections, unsolicited hover states/animations, refactoring, or extra comments. Output complete, functional code — no skeletons or placeholders.
- **Do not run builds or linting mid-task.** Only run `npm run prod`, `npm run lint`, `composer run php:lint` when the user explicitly asks to finalize/submit; then also run through `references/qa-checklist.md`.
- **Preserve given HTML structure**: when converting provided HTML to a module, keep tags and classes exactly as-is unless asked to change them.

## Output Format

Output only the changed sections of files (unless the full file is requested), label every code block with its file path, and end with:
```
Files modified:
- theme/template-parts/modules/ss_hero_module.php
- theme/acf-json/group_ss_reusable_modules.json
```

## Reference Files — read before the matching task

| Read | When |
|---|---|
| `references/acf-standard.md` | Creating/editing any ACF field group, flexible content layout, or module PHP — includes the full JSON skeleton, field-type mapping, icon select block, CPT field-group rules, and a worked example |
| `references/figma-to-tailwind.md` | Generating or updating `tailwind.config.js` from Figma JSON — decision rules, token naming, blank scaffold |
| `references/html-css-standards.md` | Writing any markup — semantic HTML rules, BEM, token usage, container types, Slick/form patterns |
| `references/javascript-guide.md` | Any frontend behavior — the `ss` object pattern, slider/accordion/toggle class systems |
| `references/theme-structure.md` | Registering CPTs, creating page/single/archive templates, or global Theme Settings (options pages) |
| `references/qa-checklist.md` | Only at explicit finalize/submit time |

## Build Commands (run only when instructed)

```bash
npm install && composer install   # once per environment
npm run watch                     # dev watcher (user usually runs this themselves)
npm run dev / npm run prod        # one-time dev / minified production build
npm run lint                      # CSS/JS lint;  composer run php:lint  for PHP
npm run bundle                    # production build + installable zip
```
