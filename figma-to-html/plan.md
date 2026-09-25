# Figma → HTML agent: how it works, from scratch

This explains the *why* behind every piece, so you can adapt or debug the setup later. For the condensed "just do it" version, see `quickstart.md`.

## 1. The problem

Rebuilding a Figma design in HTML by hand means eyeballing colors, guessing spacing, and redrawing icons from a screenshot. That's slow and never pixel-accurate. We want Claude to read the *actual* design data — real hex values, real spacing tokens, real layer structure — not a picture of it.

## 2. Why the Figma Dev Mode MCP Server — and which one

MCP (Model Context Protocol) is how Claude calls out to external tools/data sources during a conversation. There are actually **two** ways to get Figma's real design data into Claude, and this project should support both:

**A. Local Dev Mode MCP Server** — built into the Figma desktop app's Dev Mode. Runs on your machine (`http://127.0.0.1:3845/mcp`), operates on whatever you currently have *selected* in the desktop app.

**B. Hosted Figma MCP connector** (`https://mcp.figma.com`) — Figma's own remote server, reached via OAuth from your Claude/claude.ai account (in Claude Code this shows up as tools prefixed `mcp__claude_ai_Figma__…`). No desktop app needs to be open; instead of "current selection" you pass an explicit Figma URL containing a `node-id`.

Both expose the same kind of ground-truth data for a node:

- exact structure (layer tree, auto-layout rules)
- exact tokens (colors, spacing, type, bound variables)
- a rough code draft
- a rendered image of the selection, for visual QA

This is strictly better than pasting a screenshot into chat: a screenshot loses exact values and Claude has to guess; either MCP server hands over ground truth.

**Prefer B (hosted) when it's available and already authenticated** — it removes the "Figma Desktop must be open" constraint entirely, which is the biggest practical limitation of this whole workflow. Fall back to A only when B isn't installed for the account, or when you specifically want to work off a live, in-progress selection in the desktop app rather than a saved node link.

## 3. One-time setup

### 3a. Hosted connector (recommended — no desktop app required)

1. In Claude Code, check whether Figma tools are already connected (look for `mcp__claude_ai_Figma__*` tool names, e.g. via a tool search). If you only see `mcp__claude_ai_Figma__authenticate` / `…__complete_authentication`, the connector is installed but not yet logged in.
2. Call the `authenticate` tool. It returns an authorization URL — open it and approve access with the Figma account that owns (or has access to) the file you want to convert.
3. After approving in the browser, you're redirected to a `localhost` callback URL. Copy that full URL (address bar) and pass it to `complete_authentication`.
4. The real tools (`get_code`, `get_metadata`, `get_variable_defs`, `get_image`, etc., namespaced under `mcp__claude_ai_Figma__`) become available for the rest of the session.
5. You don't select anything in a desktop app for this path — instead, get the frame/component's share URL from Figma (Share → Copy link, or right-click a node → Copy link), which contains a `node-id`.

This is per-account, not per-project — once authenticated, it stays connected across sessions until the token expires or is revoked.

### 3b. Local Desktop Dev Mode MCP Server (fallback)

1. **Use the Figma desktop app**, not the browser — the Dev Mode MCP server is a desktop app feature.
2. Open the file, switch to **Dev Mode** (top-right toggle).
3. Enable the server: **Figma menu → Preferences → Enable Dev Mode MCP Server** (wording may shift slightly between Figma versions — look for "MCP" under Preferences or the Dev Mode panel). Figma will show a local URL, typically `http://127.0.0.1:3845/mcp` (or `/sse` for older versions).
4. Register it with Claude Code (already done for this repo in `.mcp.json` as a server named `figma`; for a new project run):
   ```
   claude mcp add --transport http figma http://127.0.0.1:3845/mcp
   ```
   (If your Figma version only offers SSE, use `--transport sse` and the `/sse` URL instead.)
5. In Claude Code, run `/mcp` and confirm "figma" shows as connected. Its tools will appear namespaced, e.g. `mcp__figma__get_code`, `mcp__figma__get_image`, `mcp__figma__get_metadata`, `mcp__figma__get_variable_defs` (the exact prefix depends on the name you registered it under — `figma` above). Note: a server entry existing in `.mcp.json` does **not** mean it's connected — if Figma Desktop isn't running with the server enabled, no `mcp__figma__*` tools will show up at all.
6. Back in Figma, **select the frame or component** you want converted. The MCP server generally operates on your current selection (some setups also accept a Figma URL containing a `node-id` directly).

You only need to redo steps 3–5 if you restart Figma/Claude Code or the connection drops. Step 6 (selecting the right frame) happens every time you convert something new.

## 4. The conversion pipeline

This is what the `figma-to-html` subagent (`.claude/agents/figma-to-html.md`) actually does, in order:

1. **`get_metadata`** on the selection — a cheap, compact tree of layer names/types/bounding boxes. Read this first so the agent understands the structure before spending context on full code, especially for a whole page.
2. **`get_variable_defs`** — the real bound design tokens (colors, spacing, radii, type scale, font family/weight). These become CSS custom properties (`--color-primary`, `--space-4`, …) instead of magic numbers scattered through the CSS.
3. **`get_code`** — Figma's own generated code for the selection. This is a *draft*, usually React-flavored with inline or Tailwind-ish styling. It's useful for exact structure and values, but it is never handed back as-is.
4. **`get_image`** — a rendered screenshot of the same selection, kept as the ground-truth reference for the QA pass at the end.
5. **Asset export** — any image fills, icons, or vector shapes get exported (via the image tool) into an `assets/` folder, referenced by relative path — never left pointing at Figma's own hosted URLs.

Then the agent **rebuilds**, it doesn't transcribe:

- Semantic HTML5 (`header`/`nav`/`main`/`section`/`footer`/`button`, one `h1`, sensible heading order, `alt` text on images).
- One external stylesheet using the CSS variables from step 2, organized by section/component.
- Layout from the design's auto-layout semantics (flex/grid + gap) rather than fixed pixel positions, so it actually responds at different widths.
- Full-width sections get only vertical padding; their content is wrapped in a `.container` (`max-width: 1312px` by default — or the design's actual measured content width if different — `margin: 0 auto`, `padding: 0 16px`) so it's genuinely centered rather than propped open by a large fixed side padding that just stretches on wider viewports.
- Every button and link gets a hover state (and a matching `:focus-visible`) even though Figma's static frame never shows one — inferred, not guessed blind: subtle fill/brightness or background-swap for buttons, underline/opacity/icon-nudge for text and arrow links. Watch for `<img>`-referenced icons with a hardcoded stroke/fill color (not `currentColor`) — a hover background swap can make them invisible unless given their own `filter`.
- If the Figma file has separate Desktop/Tablet/Mobile frames, those become breakpoints of one responsive page, not three separate outputs.

Finally, a **QA pass**: compare the rendered result against the `get_image` screenshot for color/spacing/type fidelity, and the agent explicitly lists anything it had to assume (missing hover state, substituted font, ambiguous alt text) instead of silently glossing over it.

## 5. "Pixel-perfect" and "responsive" — what's actually guaranteed

These two goals pull in different directions, and a plan that doesn't say so is making a promise it can't keep. Being explicit about scope:

- **Pixel-perfect applies at each explicit frame Figma gives us.** If the file has Desktop/Tablet/Mobile frames (or you only give us one frame), those exact widths are where fidelity is verified — not "close by eye," but checked against real numbers: position/size/spacing pulled from `get_metadata`, colors/type/radii from `get_variable_defs`, and a rendered comparison against `get_image` for that same width. If a value in the built CSS doesn't match the token/metadata value, that's a bug to fix, not a rounding error to accept.
- **Responsiveness is fluid interpolation *between* verified breakpoints**, built from the design's own auto-layout semantics (flex/grid, `gap`, `flex-wrap`) plus fluid sizing (`clamp()`, relative units) where Figma only gave us one frame. Widths between two explicit breakpoints are *not* independently pixel-verified against Figma — there's no Figma frame at, say, 850px to check against — they're a reasonable interpolation, and that should be stated plainly rather than implied to be equally exact.
- If the user needs a specific in-between width to also be pixel-exact, that's only possible if Figma has a frame at that width to check against — ask for one rather than guessing.

This is the difference between "looks right" and "verified right": the QA step in the pipeline (§4, step 5 below) must do a real comparison, not a glance.

## 6. Known limitations

- The local Dev Mode MCP path (§3b) requires Figma Desktop running with Dev Mode MCP enabled — a local, interactive workflow, not something you can trigger from a headless script or CI. The hosted connector (§3a) doesn't have this constraint, but does require the file to be accessible to whichever Figma account was used to authenticate.
- `get_code`'s output is a starting point only — expect the agent to restructure it, not reuse it.
- Prototyping/animation logic in Figma isn't captured — only the static visual design.
- Licensed fonts used in the design may not be legally usable on the web; the agent should flag this and suggest a fallback rather than silently substituting.
- "Pixel-perfect" is scoped to explicit Figma frames, not every possible viewport width — see §5.

## 7. Files in this folder

- `figma-to-html-agent.md` — a portable copy of the subagent definition. The *live* copy Claude Code actually reads in this repo is `../../.claude/agents/figma-to-html.md`; copy this file's content into `.claude/agents/figma-to-html.md` in any other project to enable the agent there.
- `figma-to-html-prompt.md` — a standalone prompt (same pipeline, no subagent registration required) you can paste into any Claude chat that has Figma MCP tools connected, following the pattern of the templates in `ai/*.md`.
- `figma-to-html-skill.md` — a portable copy of the `/figma-to-html` skill. The *live* copy is `../../.claude/skills/figma-to-html/SKILL.md`. Unlike the agent (which Claude may invoke proactively when it recognizes a Figma link), the skill is what backs the explicit `/figma-to-html` command, and it also handles first-time setup detection (which MCP path is connected, and walking through auth if neither is).
- `quickstart.md` — condensed steps to go from zero to a converted page.
