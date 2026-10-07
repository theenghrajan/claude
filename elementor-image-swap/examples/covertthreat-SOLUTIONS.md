# Solutions — covertthreat.com

One section per task. Newest at the bottom.

---

## Task #127 — Sub-platform pages coding (2026-10-01)

**Link:** https://login.smartsites.com/projects/8171/tasks/498560
**Dev site:** https://covertthreat.smartwebsitedesign.com
**Branch preview:** https://127-sub-platform-pages-codin.covertthreat.smartwebsitedesign.com
**Design images (Drive):** https://drive.google.com/drive/folders/1QOfxZIf-AGLmzvYUh8_uVJEacmhLO94D
**Figma:** https://www.figma.com/design/13INBYg3sYAOxiNY9tJu52/-124_-Content-Implementation--August-ops---12WP-?node-id=21723-204

### Status
- Done: FED built all 12 pages on dev (2026-09-25). Design exported unique images (2026-09-28). AI agent swapped the 24 images on the branch preview and verified them (2026-09-30).
- Blocking: the swaps were never made on the real dev site. Charlie asked FED to add the images; due 2026-10-01.

### Pages (slugs)
ai-penetration-testing, attack-path-simulation, compliance-mapping, dark-web-breach-monitor, digital-forensics, firewall-audits, ransomware-simulation, remediation-planning, table-top-exercise, typosquat, vulnerability-management, vulnerability-scanning

### Solutions
1. **Swap the 24 images on the dev site.** Each page's Drive subfolder has 2 files:
   - `How <Page> Helps Strengthen Cybersecurity.jpg` → About section photo
   - `PENETRATION TESTING.jpg` → Penetration Testing tab photo

   Steps: wp-admin → Pages → Edit with Elementor → click the image → Media Library → Upload → Insert → Update. Leave the Red Team / Vulnerability Assessment / Application Security tabs alone.
2. **Shrink the images before uploading.** Some exports are 12–14 MB and would hurt page speed. Resize to about 1600px wide, WebP or JPG at quality 80, which should bring each under 300 KB:
   ```
   magick mogrify -path out -resize 1600x -quality 80 -format webp *.jpg
   ```
   Or use ShortPixel or Imagify.

   ✅ **Done 2026-10-01:** all 24 converted to `images/output/<slug>/<slug>-feature-img01|02.webp` (01 = About, 02 = Penetration Testing tab), 76–228 KB each (226 MB → 3.1 MB). Upload these instead of the originals.
3. **Empty tabs** (Red Team, Vulnerability Assessment, Application Security) have no content or images. Ask Charlie to pick one:
   - (a) Hide them for now and add them back later. Recommended.
   - (b) Wait for content, then for Design's images.
4. **Unanswered questions from 2026-09-18** to raise with Charlie:
   - Is DNS Monitor (13th Platform page in the plan) intentionally left out of this batch?
   - On live, `/vulnerability-scanning/` redirects to a blog post and `/digital-forensics/` redirects to `/services-solutions/incident-response-forensics/`. Remove both redirects when the new pages go live.
5. **After that:** post the 12 URLs for Charlie to review. Once Charlie approves, push to live, then reopen the reference task "Content Implementation (August ops - 12WP)".

---

## Automating image upload + Alt Text/Title for the 12 pages (2026-10-01)

**Answer:** yes, it can be automated. It's one script that loops over `images/output/<slug>/`.

### What it does per page
1. Uploads `<slug>-feature-img01.webp` and `-img02.webp` to the Media Library, with Title and Alt Text set.
2. Replaces the old shared stock-photo ID and URL in that page's `_elementor_data`: img01 goes in the About widget, img02 in the Penetration Testing tab. Nothing else on the page changes.
3. Regenerates the Elementor CSS and checks that the page returns 200 with the new image.

### Option A — WP-CLI over SSH (recommended)
- Requires SSH access to the dev host with `wp` available.
- `wp media import <file> --title="…" --alt="…" --porcelain` uploads the file and returns the new attachment ID.
- `wp post meta get/update <page_id> _elementor_data` swaps the old ID and URL in the page data.
- `wp elementor flush-css` regenerates the CSS.
- Not affected by the site's HTTP Basic Auth.

### Option B — REST API from this PC
- Requires the HTTP Basic Auth credentials plus a WP Application Password. **Problem:** both use the same `Authorization` header, so one of them must be bypassed, e.g. by whitelisting this IP in `.htaccess`.
- `/wp/v2/media` handles the upload and `alt_text`.
- `_elementor_data` is not exposed through REST, so this also needs a small mu-plugin, or the Elementor swap is done by hand.

### Inputs needed
- Access: SSH/WP-CLI (A), or Basic Auth credentials + Application Password + IP whitelist (B).
- The Alt Text/Title pattern used on `/ai-penetration-testing/`. The dev site returns 401, so it couldn't be read. Supply it in either form:
  - the rule, e.g. Title = page H1, Alt = descriptive sentence
  - a CSV `slug,img,title,alt` with 24 rows
- Confirmation that every page still uses the same shared stock-photo ID, so the swap target is the same on all 12.
- A database backup or snapshot before the run, since this edits `_elementor_data`.

### Process
1. Dry run: print the planned changes per page without writing anything.
2. Run on 1 page and have it checked visually.
3. Run on the remaining 11.
4. Verify all 12 pages: HTTP 200, desktop and mobile, correct alt text.
5. Note the result in task #127.

### ✅ Result (2026-10-01)
All 12 pages swapped on the dev site with `tools/swap-feature-images.sh <slug>...`: img01 → About, img02 → Penetration Testing tab, Title = Alt = "<Page Title> Feature Image". Only the images changed (verified by before/after diff per page). Backups are in `images/output/backups/`.
**Re-use:** put new images in `images/output/<slug>/`, add rows to `alt-titles.csv`, fill `.env`, then run the script. It skips pages that are already done.
