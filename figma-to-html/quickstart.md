# Quickstart: Figma → HTML

For the full explanation of why each step exists, see `plan.md`.

## One-time setup — pick one

**Option A: hosted connector (recommended, no desktop app needed).** If Claude Code shows `mcp__claude_ai_Figma__authenticate` as an available tool, you already have this installed — just call `authenticate`, approve in the browser, then paste the callback URL into `complete_authentication`. Done; it stays connected across sessions. Full detail in `plan.md` §3a.

**Option B: local Figma Desktop Dev Mode server.**
1. Open the design in the **Figma desktop app** (not browser), switch to **Dev Mode**.
2. **Preferences → Enable Dev Mode MCP Server**. Note the local URL it shows (usually `http://127.0.0.1:3845/mcp`).
3. In a terminal:
   ```
   claude mcp add --transport http figma http://127.0.0.1:3845/mcp
   ```
4. In Claude Code, run `/mcp` — confirm `figma` is connected.

## Every time you convert a design

1. Get the target: with Option A, copy the frame/component's share link from Figma (contains a `node-id`); with Option B, **select the frame/component** in the desktop app (a share link with `node-id` also works).
2. In Claude Code, either run `/figma-to-html <link or description>`, or ask directly, e.g.:
   > Use the figma-to-html agent to convert this Figma frame into HTML/CSS, output to `./output/`.
3. Review what it flags as assumptions (fonts, missing hover states, unclear alt text, which widths were pixel-verified vs. interpolated) before shipping.

## No subagent or skill available in this project?

Copy `figma-to-html-agent.md` from this folder into that project's `.claude/agents/figma-to-html.md`, and `figma-to-html-skill.md` into `.claude/skills/figma-to-html/SKILL.md`. Or, if you just want a one-off conversion without registering anything, paste `figma-to-html-prompt.md` into the chat instead.

## Nothing works / no Figma tools show up

- Hosted connector: check whether `mcp__claude_ai_Figma__authenticate` exists but hasn't been completed yet — run through auth (above).
- Local server: only runs while Figma Desktop is open with Dev Mode MCP enabled, and having an entry in `.mcp.json` does *not* mean it's connected. Restart Figma, re-check Preferences, and re-run `/mcp` in Claude Code.
- If neither path shows any Figma tools at all, tell the user rather than guessing from a pasted screenshot.
