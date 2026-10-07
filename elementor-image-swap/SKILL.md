---
name: elementor-image-swap
description: Work an ActiveCollab (AC) web task end to end for a WordPress + Elementor site — read the task (read only, never post), propose solutions, optimize Design's images to WebP, rename them to page slugs, then upload them with Alt Text/Title and swap them into each page's Elementor image widgets without changing anything else, verify, keep LOG.md/SOLUTIONS.md/CLAUDE.md, and draft (never post) the AC reply. Use when the user gives a login.smartsites.com task link, asks to "replace/swap images on these pages", "upload images with alt text to Elementor pages", "optimize and rename images to slugs", or "draft a reply to comment #N".
---

# AC task → Elementor image swap

Worked example: `examples/covertthreat-*.md` (12 pages, 24 images, 2026-10-01).
Scripts: `scripts/optimize-images.sh`, `scripts/swap-images.sh`. Templates: `templates/`.

## Hard rules (never break)
1. **AC is read only.** Use only get/list/search AcMCP tools. Never post, comment, update or complete anything, and never offer to. Comment replies are **drafts in chat**.
2. **Change only what was asked.** An image swap changes `settings.image` id/url/alt, nothing else. The script proves it with a before/after diff; never bypass that check.
3. **Log everything:** append every request/action to `<project>/LOG.md`; each task's solutions go in `SOLUTIONS.md`; durable facts go in `CLAUDE.md`. Start from `templates/` if missing.
4. **Credentials only in `<project>/.env`**, filled in by the user (`templates/env.example`, no quotes). Parse it line by line; never `source` it, print it, or run `bash -x`.
5. **Ask when unsure:** which file is img01/img02, slug mapping, duplicate slugs or page IDs.

## Phase 1 — Read the task (sub-agent: `ac-task-reader`)
`get_task` + `get_task_comments(limit 0)`. Summarize the status, what's done, what's blocking, and who owes what. Write numbered solutions to `SOLUTIONS.md`. Comments are numbered oldest first (#1 = oldest).

## Phase 2 — Optimize images
Originals: `images/source/<any folder name>/`. Output **always** goes to `images/output/`.
```
bash <skill>/scripts/optimize-images.sh images/source images/output 1600 80
```
Uses `-resize 1600x>` (never upscales) and includes uppercase `.JPG`. ImageMagick missing → `winget install ImageMagick.ImageMagick`.

## Phase 3 — Rename to slugs
- Folder = page slug (the URL path after `.com/`). File = `<slug>-feature-img01.webp`, `-img02.webp`, …
- Agree the mapping with the user (e.g. img01 = About "How X Helps…", img02 = "PENETRATION TESTING" tab). Odd file names or truncated folders → state your choice or ask.

## Phase 4 — Gather swap data (read only)
1. Log in (see the script), then read the user's **reference page** (the one they finished by hand) to learn the pattern: `GET /wp/v2/media/<id>?context=edit` for title/alt/caption, and Elementor `get_document_config` for which widget holds which image.
2. Find each page's ID: `GET /wp/v2/pages?slug=<slug>&status=any`. **More than one result, or an old draft owning the slug** → tell the user (e.g. `/digital-forensics-3/`); let them fix it.
3. Find `old_id`: the media ID currently in each widget (`wp-image-NNNN` on the front end).
4. Write `images/output/swap.csv` (`slug,page_id,file,title,alt,old_id`, no commas in values) and show it for approval.

## Phase 5 — Swap (sub-agent: `elementor-image-swapper`)
```
bash <skill>/scripts/swap-images.sh <first-slug>           # one page, user checks it in the browser
bash <skill>/scripts/swap-images.sh <slug> <slug> ...      # the rest after "go"
```
Per page, the script:
1. Backs up the full Elementor document to `images/output/backups/`.
2. Uploads each file via REST (slug = filename, title/alt, attached to the page). Existing uploads with that slug are reused.
3. Replaces `settings.image` in the widget holding `old_id` (exactly 1 per row).
4. Saves with the **original page settings**. Omitting them resets "Hide Title" and makes the page title visible.
5. Re-reads the page and stops if anything other than `settings.image`/`htmlCache` changed (settings compared per key).
6. Checks the front end.

Pages that are already done are skipped, so re-running is safe.

## Phase 6 — Verify and report
All pages: HTTP 200 (desktop + mobile UA), new `wp-image-<id>` present, old ID absent, alt correct. Media Library: count, unique slugs, no empty alt, no duplicates. Update `LOG.md`/`SOLUTIONS.md`. Draft the AC reply in chat (sub-agent `ac-task-reader`): what was done, the URLs, open questions, and a sign-off. **Do not post.**

## Known pitfalls (all hit on covertthreat)
| Symptom | Cause | Fix |
|---|---|---|
| curl `Failed to open /tmp/...` | Windows curl/node can't read MSYS paths | `cygpath -m` (built in) |
| Script exits silently after the first upload | `read` on output with no newline | `console.log` (built in) |
| Duplicate `…-1.webp` uploads | WP sets the attachment slug from the title | send `slug=<filename>` (built in); delete your own duplicate |
| Page title became visible | `save_builder` sent without settings | send original settings (built in) |
| False "page settings changed" | Elementor reorders keys | per-key compare (built in) |
| `curl (28)` timeout on the site + same-server sites | server down or IP blocked after repeated logins | user checks in a browser / mobile data; retry later |
| Basic Auth + Application Password both fail | both use the `Authorization` header | cookie login + `rest-nonce` (built in) |

## Limits
- Elementor **Image** widgets only (`settings.image`). Background images, galleries and other widgets are not touched; tell the user they need a manual edit.
- Elementor tested on 3.35.9. If `get_document_config`/`save_builder` change, stop and report.
