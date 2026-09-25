# Final QA Checklist

Run through this checklist **only when the user has explicitly asked you to finalize or submit the work**.

---

## 1. Code Standards
- [ ] Is all HTML semantic — correct tags used, no `<div>` where a semantic tag exists?
- [ ] Is the heading hierarchy sequential with only ONE `<h1>` per page?
- [ ] Are custom classes following the BEM naming convention?
- [ ] Is only Vanilla JS (ES6+) used for new logic? (jQuery permitted only via vendor plugins: Slick, MatchHeight, FancyBox)
- [ ] Do all `<button>` elements have a `type` attribute (`type="button"` or `type="submit"`)?
- [ ] Do all `<a>` elements have an `href`?
- [ ] Are there ZERO inline styles or inline script tags?

## 2. Design & Styling
- [ ] Are all colors, fonts, and spacing using Tailwind defaults or `ss-{px}` tokens from `tailwind.config.js`? (No arbitrary hex, px, or bracket values anywhere?)
- [ ] Are there ZERO arbitrary values (hex, px) in CSS/HTML?
- [ ] Is the layout Mobile First?
- [ ] Are all Tailwind breakpoints (`md:`, `lg:`) correctly applied?
- [ ] Do all external links have `target="_blank"` with `rel="noopener noreferrer"`?

## 3. Forms & Accessibility
- [ ] Does every form input have a unique `id` and a matching `<label for="...">`?
- [ ] Are placeholders used only as hints — never as label substitutes?
- [ ] Are touch targets at least 44×44px on mobile?

## 4. Images & Assets
- [ ] Are all photos in WebP format and icons in SVG or Icomoon?
- [ ] Do all `<img>` tags have `alt`, `width`, and `height` attributes?
- [ ] Is `loading="lazy"` applied to all below-the-fold images?
- [ ] Are all static image filenames lowercase and hyphen-separated (e.g., `hero-banner.webp`)?

## 5. WordPress Integration
- [ ] Are all templates wrapped in `get_header()` and `get_footer()`?
- [ ] Are all assets correctly enqueued using `SS_THEME_VERSION`?
- [ ] Are reusable components included via `get_template_part()`?
- [ ] Do all ACF field names match exactly what is confirmed in the project brief or existing templates?

## 6. Build & Validation
- [ ] Did you run `npm run prod` — production build passes without errors?
- [ ] Did you run `npm run lint` and `composer run php:lint` — zero linting errors?
- [ ] Are there ZERO errors or warnings in the browser console?
- [ ] Has the layout been tested at mobile, tablet, and desktop breakpoints?

## 7. Project Finalization
- [ ] Does the final implementation visually match the Figma design and Project Brief?
- [ ] Has all commented-out dead code been removed?
- [ ] Are there no placeholder or skeleton code sections remaining?

## 8. AI Behavior Verification
- [ ] Were only the files listed in the pre-task confirmation modified?
- [ ] Was the task scope strictly followed — no adjacent sections, unsolicited features, or refactoring added?
- [ ] Were no new npm packages, Composer packages, or vendor libraries added?
- [ ] Were no design tokens added or modified without explicit instruction?
- [ ] Was all copy sourced from the project brief — no text was invented?
