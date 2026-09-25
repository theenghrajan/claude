# Quick start: Figma → Divi Builder

This file covers the first run. [figma-to-divi-builder-guide.txt](figma-to-divi-builder-guide.txt) explains every step in full, and [SKILL.md](SKILL.md) holds the instructions Claude follows.

## One-time setup

**1. Connect Figma to Claude. Pick one option:**

- **Option A: hosted connector (recommended, no desktop app needed).**
  1. Go to **claude.ai → Settings → Connectors → Figma → Connect** and approve access.
  2. Start a new Claude Code session, or run `/mcp`, so the Figma tools load.
  3. If Claude Code lists `mcp__claude_ai_Figma__authenticate` as a tool, call it, approve in the browser, and paste the callback URL into `complete_authentication`.
- **Option B: local Figma Dev Mode server.**
  1. Open the design in the **Figma desktop app** and switch to **Dev Mode**.
  2. Go to **Preferences → Enable Dev Mode MCP Server**.
  3. Run:
     ```
     claude mcp add --transport http figma http://127.0.0.1:3845/mcp
     ```
  4. Confirm with `/mcp`.

  Full details are in [../figma-to-html/quickstart.md](../figma-to-html/quickstart.md).

Until one of these is connected, Claude cannot read the design.

**2. Install the script's dependency.** Skip this if `scripts/node_modules/` already exists.

```
cd scripts
npm install
```

## Every time you convert a design

1. **Export the Divi site.** In wp-admin, go to **Tools → Export**, choose **All content**, and click **Download Export File**.
   - Save it in your workspace, for example `projects/<site-name>/export.xml`.
   - Choose "All content": most Divi designs live on pages, not in the Divi Library.
   - Re-export only when the site's Divi content has changed since your last export.
2. **Copy the Figma link.** Right-click the frame and choose **Copy link to selection**. The link must contain `node-id=`.
3. **Optional: add the Divi source.** Zips of the site's Divi theme and any Divi add-on plugins let more sections reach High confidence.
4. **Send Claude three things:**
   > Convert this Figma design to Divi.
   > Export: `projects/<site-name>/export.xml`
   > Figma: `https://www.figma.com/design/...?node-id=...`
   > Output: Divi Library layout (the default) or a draft page
5. **Wait for the build.** Claude doesn't need anything else from you until you import:

   | Step | Who | What |
   |---|---|---|
   | 1 | Claude | Scans the export (`node scripts/mine-divi-data.js export.xml --out catalog.txt`) to list the modules and settings the site really uses, and whether it runs Divi 4 or Divi 5 |
   | 2 | Claude | Pulls each Figma section's text, images and screenshot, and saves the images locally right away |
   | 3 | Claude | Matches each section to a real module and rates it High, Medium or Low confidence |
   | 4–5 | Claude | Sets up the images and writes `build-<page>.js`, which creates and checks the `.wxr.xml` file |
   | 6 | Claude | Compares the build with the Figma screenshots |

6. **Import the file.** On the site, go to **Tools → Import → WordPress** and map or skip the author.
   - Tick **"Download and import file attachments"**. Without it, images keep pointing at Figma links that expire within days.
   - Import soon after the build, while the Figma image links still work.
7. **Use the layout.**
   - **Library layout:** open any page in the Divi Builder, choose **Add From Library → Your Saved Layouts**, and pick it.
   - **Draft page:** open it under **Pages** and edit it with Divi.
8. **Close the loop.** Send Claude a screenshot of the live result. Claude can't render Divi output itself, so this is the only real visual comparison.

## Before you import, read Claude's handoff

- **The section → module → confidence table.** Check Medium and Low sections first.
- **Approximations**, such as a hover effect that couldn't be reproduced or a section built as plain HTML.
- **Any warnings about Figma-hosted images** (import soon).

## Troubleshooting

| Problem | Fix |
|---|---|
| No Figma tools appear in Claude | The connector isn't authorized, or the desktop app with Dev Mode MCP isn't running. Redo the one-time setup, then run `/mcp`. |
| "No Divi layouts found" when scanning | The export has no Divi content. Re-export with **All content**. |
| Images are empty after a few days | The import ran without "Download and import file attachments", or the Figma links had already expired. Upload the local backup images from `<section>-images/` and swap them in the builder, or ask Claude to rebuild after a fresh Figma pull. |
| The page shows raw `[et_pb_…]` text | The Divi builder flag is missing on that post. Check for a build validation error, and rebuild. |
