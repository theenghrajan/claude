# Forms: detect the plugin, pick the method, wire the trigger

The GA4 side never changes: tag `SS - GA4 Event (Form Submission)`, event `form_submission`, params `form_name` (and `form_id` if the listener provides one), fired by trigger `SS - Form Submission`. **Only the trigger and listener change per form plugin.**

Listener scripts: "Anil Notes for Tracking - GA4" doc https://docs.google.com/document/d/1RgYdzidICicV3PXqn7yRA7zD5ZoV6X4jvteBq77ffM8 (one tab per plugin; read it with `docs_get(include_tabs=true)` and copy the tab's script exactly).

## 1. Detect (every form page, not just /contact/)
List the pages that have forms (sitemap / `wp-json/wp/v2/pages`, then grep each page for `<form` and `<iframe`). On each form page, run this in Chrome (`javascript_tool`):

```js
(() => {
  const sig = {
    'Fluent Forms': 'form.frm-fluent-form', 'Contact Form 7': '.wpcf7 form', 'Gravity Forms': '.gform_wrapper form',
    'Elementor Pro': 'form.elementor-form', 'MetForm': '.metform-form-content, .mf-form-wrapper', 'Divi': '.et_pb_contact_form',
    'Forminator': 'form.forminator-custom-form', 'WPForms': 'form.wpforms-form', 'Ninja Forms': '.nf-form-cont',
    'Formidable': 'form.frm-show-form', 'Avada/Fusion': 'form.fusion-form',
    'HubSpot': '.hs-form, form[id^="hsForm_"], iframe[src*="hsforms"]',
    'Iframe form (Typeform/Jotform/Google/other)': 'iframe[src*="typeform"], iframe[src*="jotform"], iframe[src*="google.com/forms"]'
  };
  return { found: Object.entries(sig).filter(([, s]) => document.querySelector(s)).map(([k]) => k),
           forms: [...document.forms].map(f => ({ id: f.id, cls: f.className, action: f.action })) };
})()
```

Also check what happens after a successful submit: is there a redirect to a thank-you URL, or an in-page message? Look at the plugin's form settings in WP admin if you have access; otherwise ask the user to do one test submit. Note it in the log.

## 2. Pick the method (manual §6.1)
| Situation | Method | Trigger `SS - Form Submission` |
|---|---|---|
| Redirects to a thank-you URL | **A** | Page View, Page URL contains `thank-you` (the real path) |
| Plain HTML post, no AJAX, no redirect | **B** | Form Submission, Wait for Tags + Check Validation ON, optional Form ID filter |
| AJAX / JS plugin (most WP plugins, HubSpot) | **C** | Custom Event = the listener's event (table below) + listener tag |
| Plugin not in the table / no listener works | **C-fallback** | Element Visibility on the success-message selector, "Observe DOM changes" ON, once per page. Make sure the selector **cannot** match the error message |
| Iframe from another domain (Typeform, Jotform, Google Forms...) | none from GTM | Can't track inside the iframe. Use the provider's redirect to a thank-you page (method A) or its own GA integration; tell the user and the PM |

## 3. Plugin table (method C)
| Plugin | Doc tab / source | Listener hooks | Custom Event for the trigger | Notes |
|---|---|---|---|---|
| Fluent Forms | `seo/guides/tracking/set-up-ga4-form-and-call-events.md` (Platform notes) | `jQuery(document.body)` `fluentform_submission_success` | `fluentform_submission_success` | Pushes `formId` (`DLV - formId`) |
| Contact Form 7 | "CF7 Listener" | DOM event `wpcf7mailsent` | `cf7submission` | Fires only when the mail was sent |
| Gravity Forms | "Gravity Form Listener" | several variants: PHP `gform_confirmation` (needs theme/hosting access) or JS | `FormSubmission` (PHP) / `form_submit_success` (JS) | Use the variant the tab marks for GTM; the PHP one needs a code change, so ask first |
| Elementor Pro forms | "Elementor Forms" | XHR on `admin-ajax.php`, action `elementor_pro_forms_send_form` | `elementor_form_submit` | Alternative from the same tab: Element Visibility `.elementor-widget-form[data-id] form.elementor-form .elementor-message-success` |
| Elementor + MetForm add-on | "Elementor W/ MetFrom adon" | `metform_response_success` | `elementor_form_submit` | |
| MetForm | "Metform Listener" | success text visible in `.mf-response-msg p` | `metform_success` | Check that `SUCCESS_TEXT` matches the site's message |
| Divi contact form | "Divi Form Listener" | jQuery `ajaxSuccess` on `et_pb_contactform` POST | `divi_form_success` | Skips responses with `.et_pb_contact_error_text` |
| Forminator | "Forminator Form Listener" | `forminator:form:submit:success` | `forminator_form_submit` | Pushes `form_id` |
| WPForms | "WPForms" | AJAX confirmation container / submit-success variant | `wpforms_submit_success` or `wpform_submit` | Several variants; use the one that matches the form's confirmation type |
| Ninja Forms | "LT for Ninja Form" | `nfFormSubmitResponse` | `ninjaFormSubmission` | That tab also loads LeadTracker |
| Avada / Fusion | "Fusion Form Listener" | `fusion-form-ajax-submit-done` | `form_submit` | |
| HubSpot (embed v4) | "HS Form Listener (v4)" | `hs-form-event:on-submission:success` / `message` | `form_submission` | Same tab has the HubSpot LeadTracker loader; iframe embeds can't be read |
| Custom landing page | "Custom LP DL" | input + submit | `form_submit_success` | |
| Unknown plugin | research (below) | — | your own `<plugin>_submit_success` | Add a row here and a tab note in the log |

Name the listener tag `SS - Listener (<Plugin> Submission)`, fired on `SS - DOM Ready` (or All Pages if the listener script waits for the DOM itself). Name the trigger `SS - Form Submission` whichever method is used, so the GA4 tag never changes. If the site has **two plugins**, make one trigger per plugin (`SS - Form Submission (CF7)`, ...) and attach all of them to the same GA4 tag.

## 4. Unknown plugin: find the success hook (what was done for Fluent Forms)
1. Find the plugin's front-end JS in the page (`<script src=".../plugins/<plugin>/...js">`) and grep it for `success`, `trigger(`, `triggerHandler(`, `dispatchEvent`, `CustomEvent`. Note on which element the event fires (document/body bubbles; a `triggerHandler` on the form does **not**).
2. If there is no event: watch the Network tab during a test submit and hook the XHR/fetch response (pattern: the "Elementor Forms" or "Divi" tabs).
3. Last resort: Element Visibility on the success message (method C-fallback).
4. Write the result into this table and into the seo guide's Platform notes.

## 5. LeadTracker and the form
- Standard LeadTracker hooks the form's `submit`. It works for native and AJAX forms (if the plugin already called preventDefault, LeadTracker only sends the data and does not resubmit).
- If the plugin submits on a **button click without a real `submit` event** (e.g. Formidable `.frm_button_submit`, some Forminator setups), use the doc's "LeadTracker with class name" variant: `$('<submit button selector>').click(function () { LeadTracker($).sendData($(this).closest('form')); })`.
- Iframe forms: LeadTracker can't see them either.

## 6. Test per plugin
Submit once valid and once with a required field empty. The custom event (or page view / visibility event) must appear **once**, only on success, and `SS - GA4 Event (Form Submission)` must fire. DebugView shows `form_submission`.
