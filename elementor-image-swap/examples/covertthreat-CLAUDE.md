# covertthreat.com — working notes for Claude

## Rules
- **Never post, comment, or change anything on ActiveCollab (AC, login.smartsites.com).** Read only. Comment replies are drafts shown in chat, which the user posts themselves.
- **Log everything:** append each request/action to `LOG.md`, dated. Write each task's solutions as a section in `SOLUTIONS.md`.
- **Change only what was asked.** For example, an image swap changes the image ID, URL and alt, nothing else. Verify with a before/after diff.
- Ask when something is unclear (renames, mappings, page IDs) instead of guessing.
- Never print or echo `.env` values, and never debug with `bash -x` (it prints the credentials).

## Project
- WordPress + Elementor 3.35.9. Layouts live in the database, not in files; this folder has no site code.
- Dev site: https://covertthreat.smartwebsitedesign.com (HTTP Basic Auth plus a wp-admin login). Live: https://covertthreat.com
- AC task #127 "Sub-platform pages coding": https://login.smartsites.com/projects/8171/tasks/498560 (project 8171, task id 498560).
- Credentials are in `.env` (SITE, BASIC_USER/PASS, WP_USER/PASS), filled in by the user. Read it line by line; never `source` it, because the passwords contain shell characters.

## 12 sub-platform pages (slug → page ID on dev)
ai-penetration-testing 990029 · attack-path-simulation 990002 · compliance-mapping 990030 · dark-web-breach-monitor 990031 · digital-forensics 990032 · firewall-audits 990033 · ransomware-simulation 990034 · remediation-planning 990035 · table-top-exercise 990036 · typosquat 990037 · vulnerability-management 990038 · vulnerability-scanning 990039
(Old draft 1228 was renamed to `digital-forensics-old` by the user.)

## Images
- Originals from Design: `images/<page folder>/`. Optimized output always goes in `images/output/<slug>/`:
  - `<slug>-feature-img01.webp` = About section ("How X Helps Strengthen Cybersecurity")
  - `<slug>-feature-img02.webp` = Penetration Testing tab ("PENETRATION TESTING")
- Optimize with ImageMagick (installed: `C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe`):
  `magick mogrify -path <out> -resize "1600x>" -quality 80 -format webp *.jpg *.JPG`
- Alt Text = Title = "<Page Title> Feature Image" (both images); caption and description empty. Source: `images/output/alt-titles.csv`.

## Image swap automation — `tools/swap-feature-images.sh <slug>...`
Route B (no SSH): cookie login (Basic Auth + wp-login.php) → REST nonce (`admin-ajax.php?action=rest-nonce`) → Elementor `elementor_ajax` (`get_document_config` / `save_builder`).
Per page:
1. Back up the full document to `images/output/backups/`.
2. Upload via `/wp/v2/media`, with slug = filename, title/alt from the CSV, attached to the page. Existing uploads are reused.
3. Swap stock photo 9024 → img01 and 9032 → img02 (exactly one of each).
4. Save with the **original page settings** (omitting them resets Hide Title).
5. Re-read and stop if anything other than `settings.image` / `htmlCache` changed. Settings are compared key by key, since Elementor reorders keys.
6. Check the front end.

Pages that are already done are skipped. Windows: curl/node need `C:/` paths (handled with `cygpath`).
Status 2026-10-01: all 12 pages done and verified.

## Open items (task #127)
- The Red Team / Vulnerability Assessment / Application Security tabs have no content or images. Charlie to decide: hide them, or wait for content.
- DNS Monitor: confirm with Charlie whether it's intentionally out of this batch.
- Live: `/vulnerability-scanning/` and `/digital-forensics/` redirect to other pages. Remove the redirects at go-live (recheck first).
- Pushing to live is Charlie's decision after review. Then reopen the reference task "Content Implementation (August ops - 12WP)".
