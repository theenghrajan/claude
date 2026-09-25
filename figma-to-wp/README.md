# figma-to-wp

A Claude Code skill for the SmartSites **ss_theme** workflow: turning Figma designs (or static HTML) into WordPress theme code — ACF Pro Flexible Content modules and Tailwind CSS v3 — following the ss_theme conventions.

## What this is

This directory is a self-contained Claude Code skill package. `SKILL.md` is the instruction set Claude follows; everything else supports it:

```
figma-to-wp/
├── SKILL.md                        # Skill definition — triggers, workflows, hard rules
├── scripts/
│   └── figma-export.js             # Figma API → design-token JSON exporter
├── references/                     # Detailed docs Claude reads on demand
│   ├── figma-to-tailwind.md        # Design tokens → tailwind.config.js rules
│   ├── acf-standard.md             # ACF field group / flexible content conventions
│   ├── html-css-standards.md       # Markup, BEM, container types, breakpoints
│   ├── javascript-guide.md         # Slider/accordion/toggle class systems, `ss` JS object
│   ├── theme-structure.md          # CPTs, template hierarchy, options pages
│   └── qa-checklist.md             # Finalize/submit checklist
└── evals/
    └── evals.json                  # Sample tasks + expected output for testing the skill
```

## When it triggers

Claude loads this skill automatically when a request involves an `ss_theme`-based WordPress project — building a section/module/page from a Figma design or static HTML, creating/editing ACF field groups or flexible content layouts, generating `tailwind.config.js` from Figma tokens, registering custom post types, or anything touching the `ss_` prefix / `group_ss_reusable_modules.json` / `template-parts/modules`.

## The two workflows

1. **New project setup** — export Figma tokens (via `scripts/figma-export.js`) and generate `tailwind/tailwind.config.js`.
2. **Build a section/module** — convert a Figma frame or static HTML into an ACF flexible content layout + PHP template part + Tailwind markup, wired into the shared `group_ss_reusable_modules.json`.

See `SKILL.md` for the full pre-task protocol, hard rules (never edit compiled output, no hardcoded strings, no arbitrary Tailwind values, etc.), and the reference table of which doc to read for which task.

## Using the Figma exporter

```bash
FIGMA_TOKEN=figd_xxx node scripts/figma-export.js <FILE_ID> <NODE_ID> [NODE_ID...] --out _project_data/figma_json
```

- `FILE_ID` and `NODE_ID` come from the Figma URL (`.../file/<FILE_ID>/...?node-id=<NODE_ID>`).
- Requires a Figma personal access token in the `FIGMA_TOKEN` environment variable — never paste the token into chat or a file.
- Outputs one `figma-export-<frame-name>.json` per node, containing extracted layout, style, and design-token data for a module.

## Testing the skill

`evals/evals.json` contains sample prompts with expected outputs (building a module from static HTML, generating a Tailwind config from Figma JSON, and building a relationship-driven CPT-backed module). Use these to sanity-check skill behavior after edits to `SKILL.md` or the reference docs.
