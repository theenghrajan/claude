# <project> — working notes for Claude

## Rules
- **Never post, comment, or change anything on ActiveCollab (AC).** Read only. Replies are drafts in chat.
- Log each request/action in `LOG.md`; write each task's solutions in `SOLUTIONS.md`.
- Change only what was asked; verify with a before/after diff.
- Ask when something is unclear (renames, mappings, page IDs).
- Never print `.env` values; never debug with `bash -x`.

## Project
- Dev site: … (Basic Auth: yes/no). Live: …
- AC task: …
- Pages (slug → page ID): …

## Images
- Originals `images/source/<folder>/` → optimized `images/output/<slug>/<slug>-feature-img0N.webp`
- Alt/Title pattern: "<Page Title> Feature Image"
- Swap: `bash <skill>/scripts/swap-images.sh <slug>...` (CSV `images/output/swap.csv`)
