# Quick start: AC task → Elementor image swap

[SKILL.md](SKILL.md) holds the instructions Claude follows. [elementor-image-swap-guide.txt](elementor-image-swap-guide.txt) explains each step in plain words.

## One-time setup
1. **ImageMagick:** `winget install ImageMagick.ImageMagick`
2. **Node.js and Git Bash:** already needed by the other skills in this repo.
3. **ActiveCollab connector** (AcMCP) connected in claude.ai, so Claude can *read* tasks.
4. **Make the skill and agents available everywhere** (pick one):
   - Claude Code, all projects: copy `elementor-image-swap/` to `%USERPROFILE%\.claude\skills\`, and copy `.claude/agents/ac-task-reader.md` and `elementor-image-swapper.md` to `%USERPROFILE%\.claude\agents\`.
   - claude.ai: zip the `elementor-image-swap` folder and upload it under Settings → Capabilities → Skills.

## Each new project
1. Create the project folder, e.g. `D:\work\dev\<site>\`, and put Design's images in `images\source\<page folder>\`.
2. Copy `templates\env.example` to `<project>\.env` and fill it in (no quotes).
3. Tell Claude:
   > Read <AC task link> and provide solutions.
   > Then: optimize the images, rename them to slugs, and swap them on the pages like I did on <reference page URL>.
4. Approve the CSV (Title/Alt per image). Check the first page in the browser and reply **"go"**.
5. Ask for **"draft reply to comment #N"** and post it yourself. Claude never posts on AC.

## Files Claude keeps in the project
`LOG.md` (every action) · `SOLUTIONS.md` (per task) · `CLAUDE.md` (rules + facts) · `images/output/` (optimized images, `swap.csv`, `backups/`)
