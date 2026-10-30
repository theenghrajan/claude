---
name: website-tracking-ga4
description: Work a SmartSites ActiveCollab "Website Tracking - GA4" task end to end — read the AC task (read only), check the site, build GTM tags (GA4 page view, form_submission, click_to_call, LeadTracker) in the browser, configure GA4 admin (key events, form_data dimension, unwanted referrals, Google signals, PM IP filter, Enhanced Measurement, alerts), publish GTM on the user's say-so, and draft the AC comment from the template. Use when the user gives a login.smartsites.com task link titled "Website Tracking - GA4", or asks for GA4/GTM/LeadTracker/key-event/referral-exclusion/PM-IP setup on a client site.
---

# Website Tracking - GA4 (SmartSites)

Worked example: `D:\work\seo\Website Tracking - GA4\catalystluxuryresidential.com\10-29-2026-504272-log.md` (WordPress + Divi + Fluent Forms, existing GA4, no phone number, 2026-10-30).
Form/call how-to (methods A/B/C, Fluent Forms listener, Preview + DebugView testing): `D:\work\seo\guides\tracking\set-up-ga4-form-and-call-events.md`.

## Hard rules
1. **AC is read only.** get/list tools only. The comment is a draft file; the user posts it.
2. **One step at a time.** Do the step the user names, update the log and comment, then stop and report. Don't run ahead through the whole checklist.
3. **Ask before:** publishing GTM; accepting any policy/terms dialog (e.g. Google signals "Advertising Features Policy"); activating a GA4 data filter (GA warns it is irreversible); importing JSON into GTM (the user prefers building by hand in the UI).
4. **Change only what was asked.** Don't rename or fix other tags or settings you notice; log them and mention them.
5. **Never guess IDs.** Confirm the G- ID on the GA4 data stream page; confirm the GTM container ID in live `gtm.js`.

## Files (task folder `D:\work\seo\Website Tracking - GA4\<domain>\`)
- `MM-DD-YYYY-<taskId>-log.md`: append everything, including IDs, UI paths, screenshot links and open issues.
- `MM-DD-YYYY-<taskId>-comment.txt`: start from `..\comment-template.txt`. Header `<PM name>`, then `As per comment #N,` (N = ordinal from `get_task_comment_numbers`, oldest = 1). End with `Thanks!` only. Fill items as done; `Screenshot: [pending]` until uploaded.
- Add or update the row in `D:\work\seo\SESSIONS.md` (date, domain, #N (taskId), summary, session id, log link).
- Reusable findings go into `D:\work\seo\guides\` (index in its README); don't repeat them in the log.

## Step 0 — Read and check
1. `get_task`, `get_task_comments(limit 0)`, `get_task_comment_numbers`. Note the PM, the site URL (confirm it; the AC project name can differ from the domain), GTM/GA4 IDs already mentioned, and the requested conversions.
2. Site: `curl` the pages (sitemap / `wp-json/wp/v2/pages`). Look for: GTM-/G-/AW- IDs, CMS/theme, form plugin (`<form` classes), `tel:` links and phone text. Recheck phones in the **rendered** DOM in Chrome (`a[href^="tel:"]`, a regex on `innerText`).
3. GTM contents via API: `gtm_list_tags/triggers/variables` with `accounts/<acc>/containers/<id>` (read only; there is no write API).
4. Live container: `curl "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"` and grep `"version"`, the G- ID and the event names.

## Browser (claude-in-chrome)
- Use the browser the user names (`list_connected_browsers`, then `select_browser`). web@smartsites.com is `authuser=2` on "RAJAN-SS Inspiron 3593". If you hit a "Verify it's you" page, ask the user to sign in; never type passwords.
- Keep the tab group open between steps (the user asked).
- URLs: GTM `https://tagmanager.google.com/?authuser=2#/container/accounts/<acc>/containers/<cid>/workspaces/<ws>`; GA4 `https://analytics.google.com/analytics/web/?authuser=2#/a<acc>p<prop>/admin/...` (`events/hub`, `customdefinitions/hub`, `streams/table/<streamId>`, then left nav Data collection / Data filters).
- GTM UI quirks:
  - After Save, the next click on **New** is often swallowed; click it again.
  - Escape inside a tag panel opens "Unsaved Changes"; choose Stay Here. Close autocomplete by clicking blank space instead.
  - The GA4 Event tag's Event Name field can clear itself after Measurement ID is typed; re-check before Save.
  - Code editor: type the script without leading indentation (it auto-indents).
  - The workspace page can show "Workspace Changes: 0" while loading; reload before trusting it.
  - Submit panel: turn off "Suggested version summary" before typing a name (its description is usually fine to keep).
- GA4 UI quirks: native `<select>` dropdowns (IP match type) need keyboard input (Home/arrows + Enter). After a layout shift, take a screenshot before clicking.
- Verify every save with the `gtm_list_*` API or a zoomed screenshot.

## Step 1 — GTM container (FED)
- Never add a second container if one is installed. A new one goes under account **SmartSites v1.0** (web@ss).
- Import the BED template GTM-PFVL7Z84 "! Template for Exclude Internal Traffic in GA4" (Merge into the workspace). Rename the example Google tag to `SS - GA4 Page View` with the property's G- ID. On WordPress, rename tag "...Save Internal Traffic Type (Optional, only for wordpress sites)" to drop the "(Optional...)" part. Check the Page View tag's configuration parameters include the traffic type, otherwise the template's exclusions don't reach GA4.

## Step 2 — Form + call events (manual §6)
Follow the guide. Names: triggers `SS - Form Submission`, `SS - Click To Call` (Just Links, Click URL contains `tel:`); tags `SS - GA4 Event (Form Submission)` (event `form_submission`, `form_name`, `form_id`), `SS - GA4 Event (Click To Call)` (event `click_to_call`, `click_url = {{Click URL}}`). Enable built-ins Click URL and Click Text. Form listeners per plugin: "Anil Notes for Tracking - GA4" doc https://docs.google.com/document/d/1RgYdzidICicV3PXqn7yRA7zD5ZoV6X4jvteBq77ffM8 (tabs: Gravity, HubSpot, Metform, Divi, Forminator, Elementor, Fusion, CF7, WPForms, Ninja; Fluent Forms is in the guide).

## Step 3 — LeadTracker
Custom HTML tag `SS - LeadTracker`, All Pages, using the script from the doc above (tab "LeadTracker"; "LT with CR" if numbers are swapped). **Replace the `sendTo` G- ID with this site's ID**; every example in the doc has another site's ID. It hooks `form` submit; with AJAX forms that preventDefault it only sends data (safe). Its GA4 event is `ss_lt_form_submission` with param `form_data`, which requires a global `gtag`; check `typeof gtag` in Preview.

## Step 4 — GA4 admin
| Item | Path | Notes |
|---|---|---|
| Key events | Admin → Events → Create event → **Create with code**, name, Mark as key event ON | Default value: **Don't set**; Once per event |
| form_data dimension | Admin → Custom definitions → Create custom dimension | Event scope, parameter `form_data` |
| 3.2 Unwanted referrals | Data streams → stream → Configure tag settings → Show more → List unwanted referrals | "Referral domain contains": own domain, `login.smartsites.com`, dev site (`<name>.smartwebsitedesign.com`; probe candidate names with curl, 401 = exists). Say in the log if the dev host was guessed |
| 3.4 Demographics | Data collection → Google signals → Turn on | Policy dialog: **user confirms** |
| 3.5 PM IP | Configure tag settings → Define internal traffic → Create (IP address **equals**), then Data filters → Internal Traffic → Active | IP sheet "IP Addresses of PMs": https://docs.google.com/spreadsheets/d/1fgo8RASD5RpM8P6tAf3sBkE8fxdQ8v_LMZ5Nbrfa4h8 (`sheets_find` the PM's name; the sheet is dated, mention it). Activating: **user confirms** |
| 4 Enhanced Measurement | Data stream page | Usually already on; "verified ... already turned on" |
| 6 Alerts | GA4 alerts | Default "Daily Visits - 0 traffic" only, SS email |
| 3.3 Bot traffic | — | N/A (GA4 filters bots automatically) |

## Step 5 — Test, publish, verify
1. The user tests in Preview + DebugView (guide §3). No phone link on the site: inject a test `tel:` link via the console, and say in the comment that the site has no number.
2. Publish **only when told**: Submit → name `SS: <what was added>` → Publish. Check the change list first (Added/Modified/Deleted).
3. Verify live: `gtm.js` shows the new version, G- ID and event names. Log the version number, time and contents.

## Comment wording (PM-facing, no tech detail)
- State what was done and where to look, with one screenshot link per point. Caveats go in the log and chat, except ones the PM must act on (e.g. "no phone number on the site; tell us if the client wants one").
- Screenshots: the user captures with Awesome Screenshot into Drive folder `19jEabmGlZzx8iIhKYXKJSHO73y3ahqKr`. Use `drive_list_files` (newest first), `drive_share` (anyone/reader), then add the link and log it.
