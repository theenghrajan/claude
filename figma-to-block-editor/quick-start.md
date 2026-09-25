# Quick start: Figma → Block Editor (Gutenberg / FSE)

This file covers the first run. [figma-to-block-editor-guide.txt](figma-to-block-editor-guide.txt) explains every step in full, and [SKILL.md](SKILL.md) holds the instructions Claude follows.

## One-time setup

**1. Connect Figma to Claude. Pick one option:**

- **Option A: hosted connector (recommended).** Go to **claude.ai → Settings → Connectors → Figma → Connect**, approve access, then start a new Claude Code session (or run `/mcp`) so the Figma tools load.
- **Option B: local Figma Dev Mode server.** In the Figma desktop app, enable **Preferences → Enable Dev Mode MCP Server**, then run:
  ```
  claude mcp add --transport http figma http://127.0.0.1:3845/mcp
  ```
  Full details are in [../figma-to-html/quickstart.md](../figma-to-html/quickstart.md).

**2. Install the script dependency.** Skip this if `scripts/node_modules/` already exists.

```
cd scripts
npm install
```

**3. Optional, recommended: install the real block validator.** This runs WordPress's own check for "This block contains unexpected or invalid content" before you import. It needs about 470 MB of disk space.

```
cd scripts/gutenberg-check
npm install
```

## Every time you convert a design

1. **Export the site.** In wp-admin, go to **Tools → Export**, choose **All content**, and click **Download Export File**. Save it as, for example, `projects/<site-name>/export.xml`.
2. **Copy the Figma link.** Right-click the frame and choose **Copy link to selection**. The link must contain `node-id=`.
3. **Send Claude:**
   > Convert this Figma design to the block editor.
   > Export: `projects/<site-name>/export.xml`
   > Figma: `https://www.figma.com/design/...?node-id=...`
   > Output: pattern (the default), draft page, or FSE template / template part
4. **Wait for the build.** Claude scans the export for real blocks and theme presets, pulls the Figma content and images, builds `build-<page>.js`, and validates the `.wxr.xml`.
5. **Import the file.** Go to **Tools → Import → WordPress** and tick **"Download and import file attachments"**. Import soon, because the Figma image links expire within days.
6. **Use it.**
   - **Pattern:** in any page, open the **Inserter (+) → Patterns → My patterns**.
   - **Draft page:** open it under **Pages**.
   - **Template or part:** open **Appearance → Editor**.
7. **Close the loop.** Send Claude a screenshot of the live result.

## Troubleshooting

| Problem | Fix |
|---|---|
| "No block-editor content" when scanning | The site uses the Classic editor or a page builder. Use the Divi or Beaver Builder skill instead. |
| A block shows "unexpected or invalid content" | Send Claude the block name and page. Run `gutenberg-check` on the file, and don't click "Attempt recovery" on the live site until it's fixed. |
| Images are empty after a few days | The import ran without "Download and import file attachments". Upload the local backup from `<section>-images/`, or rebuild after a fresh Figma pull. |
| Pattern not in the inserter | Look under **wp-admin → edit.php?post_type=wp_block**. Check the import finished without errors. |
| Imported template doesn't apply | The theme slug didn't match the active theme, or an existing customized template with the same slug takes priority. Check **Appearance → Editor → Templates**. |
