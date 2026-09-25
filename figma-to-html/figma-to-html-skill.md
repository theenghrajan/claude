---
name: figma-to-html
description: Convert a Figma frame/component into pixel-perfect, responsive HTML + CSS. Use when the user runs /figma-to-html, pastes a Figma link, or asks to "convert this Figma design/frame to HTML" or "build this page from Figma." Handles first-time setup: detects whether the local Dev Mode MCP server or the hosted claude.ai Figma connector is available, and walks through OAuth if neither is connected yet, before handing off to the figma-to-html agent for the actual conversion.
user-invocable: true
allowed-tools:
  - ToolSearch
  - Agent
  - Read
  - Bash(claude mcp *)
  - mcp__claude_ai_Figma__authenticate
  - mcp__claude_ai_Figma__complete_authentication
---

# /figma-to-html

Arguments passed: `$ARGUMENTS` — usually a Figma URL (ideally containing a `node-id`), sometimes just a description like "the pricing page" if the user has it selected in the desktop app.

This skill exists for two things the `figma-to-html` agent shouldn't have to redo on every task: (1) figuring out *which* Figma MCP path is actually connected right now, including walking through OAuth for the hosted connector if needed, and (2) making explicit, up front, what "pixel-perfect and responsive" will and won't mean for this specific conversion. Once both are settled, it hands off to the `figma-to-html` agent to do the actual conversion — don't duplicate that agent's pipeline here.

Background reading if you need it: `claude/figma-to-html/plan.md` (why this is built this way, especially §5 on the pixel-perfect/responsive tradeoff), `claude/figma-to-html/quickstart.md` (condensed setup steps).

## 1. Detect what's connected

Search your available tools (`ToolSearch`, query like `"figma"`) for two possible sources:

- **Local Desktop Dev Mode MCP** — real tools named `mcp__figma__*` or `mcp__figma-dev-mode-mcp-server__*` (not just registered in `.mcp.json`; the entry existing there does not mean Figma Desktop is actually running with the server enabled).
- **Hosted connector** — tools prefixed `mcp__claude_ai_Figma__*`.

Three outcomes:

**A. One or both already have real working tools (not just `authenticate`).** Skip to step 2 — prefer whichever source is connected; if both are, prefer the hosted connector (it works from an explicit link, no desktop app dependency).

**B. Hosted connector shows only `mcp__claude_ai_Figma__authenticate` / `…__complete_authentication`.** It's installed but not logged in. Ask the user if they want to connect it now (it's the lower-friction path — no desktop app required). If yes:
1. Call `authenticate`. It returns an authorization URL.
2. Tell the user to open it and approve access with the Figma account that owns the target file.
3. Ask them to paste back the `localhost` callback URL from their browser's address bar after approving.
4. Call `complete_authentication` with that URL.
5. Re-run the tool search to confirm real `mcp__claude_ai_Figma__*` tools are now present.

If they decline, or it fails, fall through to C.

**C. Neither source has any usable tools.** Tell the user plainly: no Figma MCP connection is available. Point them at `claude/figma-to-html/quickstart.md` for either setup path (hosted OAuth, or enabling Dev Mode MCP Server in the Figma desktop app + `claude mcp add`). Do **not** attempt to proceed from a pasted screenshot — it loses exact colors, spacing, and font data, which defeats the point of "pixel-perfect."

## 2. Establish the target and what "pixel-perfect + responsive" means here

- Resolve `$ARGUMENTS` into a specific frame/node. If it's a Figma URL, extract the `node-id`. If it's vague ("the pricing page") and you're on the local path, confirm the user has it selected in the desktop app. If it's vague and you're on the hosted path, ask for a share link — there's no "current selection" remotely.
- Check whether the design has multiple frames for different breakpoints (Desktop/Tablet/Mobile, etc.). If so, those are the widths that will be verified pixel-perfect; anything between them will be fluid interpolation, not independently checked. Say this to the user up front in one line so the deliverable's scope is clear before work starts, e.g.: "This has Desktop (1440px) and Mobile (375px) frames — I'll verify pixel fidelity at both and build fluid scaling between them." If there's only one frame, say fidelity is verified at that width and responsiveness elsewhere is inferred, not independently checked.
- Confirm (or ask for) the output path. Don't default to guessing a location in an unrelated project folder.

## 3. Hand off to the conversion agent

Invoke the `figma-to-html` agent (via the `Agent` tool) with the resolved target (node/link), which MCP source to use, the output path, and a reminder to follow its own §3 rules — a `.container` (not section padding) for centering full-width sections, and hover/`:focus-visible` states on every button and link even though Figma's static frame won't show one — plus its own QA step (§5 of its definition): measured verification at explicit frames, explicit interpolation elsewhere, and an explicit list of assumptions in its final report.

## 4. Relay the result

Pass back to the user: what was built, where the files landed, which widths are pixel-verified vs. interpolated, and the agent's list of assumptions/approximations. Don't compress this list away — it's the whole point of §2's up-front framing.
