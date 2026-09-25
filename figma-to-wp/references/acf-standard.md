# ACF Standard

> **Stack**: WordPress + ACF Pro · Tailwind CSS v3 · Flexible Content layout per section

## Context & Conventions

`NOTE: DO NOT MAKE ANY FIELDS REQUIRED`

---

## Naming Conventions (strict — never deviate)

| Thing | Pattern | Example |
|---|---|---|
| Field group key | `group_ss_reusable_modules` (single shared group) | `group_ss_reusable_modules` |
| Field key prefix | `ss_[module_name]_` | `ss_certification_accre_` |
| Field key | `ss_[module_name]_[field_name]` | `ss_certification_accre_section_heading` |
| Repeater sub-field key | `ss_[module_name]_[repeater]_[field_name]` | `ss_certification_accre_programs_program_name` |
| PHP file name | `ss_[module_name].php` | `ss_certification_accre.php` |
| ACF JSON file name | **Always `group_ss_reusable_modules.json`** — one file for all modules | `group_ss_reusable_modules.json` |
| Flexible content field key/name | `ss_reusable_modules_flexible_content` (single field in the group) | `ss_reusable_modules_flexible_content` |
| Flexible content layout name | `ss_[module_name]` | `ss_certification_accre` |
| Section HTML id | `ss-[module-name]` (kebab) | `ss-certification-accre` |

> **`[module_name]`** is derived from the HTML filename or the `id` attribute on `<section>`, with hyphens converted to underscores and the `ss-` prefix stripped then re-applied with `ss_`.

---

## Field Group JSON Rules

### Structure skeleton

> **IMPORTANT — Single File Rule**: All module layouts live in **one shared file**: `theme/acf-json/group_ss_reusable_modules.json`.
> When adding a new module, **append** a new layout object to the `layouts` array of the existing `ss_reusable_modules_flexible_content` field.
> Never create a separate `group_ss_[module_name].json` file.

```json
{
  "key": "group_ss_reusable_modules",
  "title": "SS Reusable Modules",
  "fields": [
    {
      "key": "ss_reusable_modules_flexible_content",
      "label": "Flexible Content",
      "name": "ss_reusable_modules_flexible_content",
      "type": "flexible_content",
      "button_label": "Add Section",
      "layouts": [
        // ── existing layouts above ──
        {
          "key": "layout_ss_[module_name]",
          "name": "ss_[module_name]",
          "label": "[Human Readable Layout Label]",
          "display": "block",
          "sub_fields": [
            // all section fields go here
          ]
        }
        // ── append new layouts below ──
      ]
    }
  ],
  "location": [
    [
      {
        "param": "page_template",
        "operator": "==",
        "value": "default"
      }
    ]
  ],
  "menu_order": 0,
  "position": "normal",
  "style": "default",
  "label_placement": "top",
  "instruction_placement": "label",
  "active": true,
  "description": "",
  "show_in_rest": false
}
```

### Field type mapping

| HTML pattern / ACF comment | ACF type |
|---|---|
| `(text)` | `text` |
| `(textarea)` | `textarea` — plain multi-line text only (no inline HTML) |
| `(wysiwyg)` | `wysiwyg` |
| `(image)` | `image` — return format: `array` |
| `(url)` | **`link`** — `url` type is banned. Always use `link` with `return_format: "array"` |
| `(link)` | `link` — return format: `array` |
| `(number)` | `number` |
| `(repeater)` | `repeater` with `sub_fields` array |
| `(relationship - CPT X)` | `relationship` with `post_type: ["X"]` |
| `<a>` with label + url comment | **`link`** field (returns `['url']`, `['title']`, `['target']`) — never use `url` type |
| Star icons block | `star_rating` as `number`, `min: 1`, `max: 5`, `default_value: 5` |
| Heading with coloured span | Two fields: `[name]` (text) + `[name]_highlight` (text) for the coloured portion |
| Any icon class (`icon-*`) | `[name]_icon` **`select`** — choices are ALL icomoon class names (label = value = class name). See icon list below. |
| Any hardcoded CTA / button label | `[name]_label` (text) — never hardcode a visible string |

### Make every piece of content dynamic — mandatory

**Every visible string, image, icon, label, and link in the HTML must have a corresponding ACF field. Never hardcode any of the following in the PHP template:**

| What it is | How to handle it |
|---|---|
| Heading coloured (orange) span | Add a `[heading_name]_highlight` (text) field. Template outputs `<span class="text-orange">`. |
| Button / CTA label text | Always from a `link` field (`['title']`) or a standalone `text` field. |
| Icon class (`icon-arrow-right`, etc.) | Add a `[name]_icon` **`select`** field. Choices: all icomoon classes (label = value = class name). Set `allow_null: 1`. `return_format: "value"`. Template: `<i class="<?php echo esc_attr($icon); ?>">`. |
| Body text with `<strong>`, `<em>`, or links | Use `wysiwyg` not `textarea`. Output with `echo wp_kses_post($field)` — do not wrap in a `<p>` tag (wysiwyg generates its own block HTML). |
| Plain multi-line body with no inline HTML | Use `textarea`, wrap in a `<p>` in the template. |
| Single-line text (headings, labels, stats) | Use `text`. |
| Any link or URL (CTA, nav, card link, logo href, etc.) | **Always `link`** — `url` type is banned. Returns `['url']`, `['title']`, `['target']`. PHP: `esc_url($link['url'])`, `esc_attr($link['target'])`. |
| Sub-heading / eyebrow / label text | Dedicated `text` field — never hardcoded. |
| Section background or decorative image | `image` field — even watermarks and overlays. |

### Icon select field — canonical choices

**Every icon field uses `select` type** with the choices below as an example ( sourced from `tailwind/custom/fonts.css`). Both label and value are the icon class name. Always set `"allow_null": 1`, `"return_format": "value"`.

```json
{
  "type": "select",
  "choices": {
    "icon-arrow-right":    "icon-arrow-right",
    "icon-arrow-left":     "icon-arrow-left",
    "icon-arrow-up":       "icon-arrow-up",
    "icon-arrow-down":     "icon-arrow-down",
    "icon-arrow-zig-zag":  "icon-arrow-zig-zag",
    "icon-chevron-right":  "icon-chevron-right",
    "icon-chevron-left":   "icon-chevron-left",
    "icon-chevron-up":     "icon-chevron-up",
    "icon-chevron-down":   "icon-chevron-down",
    "icon-award":          "icon-award",
    "icon-benefits":       "icon-benefits",
    "icon-book":           "icon-book",
    "icon-breadcrumb":     "icon-breadcrumb",
    "icon-calculator":     "icon-calculator",
    "icon-calendar":       "icon-calendar",
    "icon-call":           "icon-call",
    "icon-career":         "icon-career",
    "icon-certificate":    "icon-certificate",
    "icon-contact":        "icon-contact",
    "icon-cup":            "icon-cup",
    "icon-delete":         "icon-delete",
    "icon-download":       "icon-download",
    "icon-economic-growth":"icon-economic-growth",
    "icon-facebook":       "icon-facebook",
    "icon-fitness-centre": "icon-fitness-centre",
    "icon-health-support": "icon-health-support",
    "icon-heart-beat":     "icon-heart-beat",
    "icon-helmet":         "icon-helmet",
    "icon-home":           "icon-home",
    "icon-instagram":      "icon-instagram",
    "icon-mail":           "icon-mail",
    "icon-minus":          "icon-minus",
    "icon-pin":            "icon-pin",
    "icon-plus":           "icon-plus",
    "icon-price-list":     "icon-price-list",
    "icon-printer":        "icon-printer",
    "icon-quote":          "icon-quote",
    "icon-road-map":       "icon-road-map",
    "icon-search":         "icon-search",
    "icon-shining-star":   "icon-shining-star",
    "icon-star":           "icon-star",
    "icon-stock-market":   "icon-stock-market",
    "icon-stress-relief":  "icon-stress-relief",
    "icon-support":        "icon-support",
    "icon-twitter":        "icon-twitter",
    "icon-user":           "icon-user",
    "icon-verified":       "icon-verified",
    "icon-youtube":        "icon-youtube"
  },
  "default_value": "icon-arrow-right",
  "allow_null": 1,
  "multiple": 0,
  "ui": 0,
  "return_format": "value",
  "ajax": 0
}
```

PHP output pattern:
```php
<?php if ( $icon ) : ?>
  <i class="<?php echo esc_attr( $icon ); ?>" aria-hidden="true"></i>
<?php endif; ?>
```

> If the icon font is updated, update both `tailwind/custom/fonts.css` and every icon `select` field's `choices` in `group_ss_reusable_modules.json`.

### General field rules

- Every field key **must** include the full prefix `ss_[module_name]_`.
- Sub-fields inside a repeater **must** include the repeater name: `ss_[module_name]_[repeater_name]_[field_name]`.
- Image fields always use `"return_format": "array"` and include `"preview_size": "medium"`.
- Relationship fields always include `"post_type"`, `"filters": ["search"]`, `"return_format": "object"`.
- wysiwyg fields use `"tabs": "all"`, `"toolbar": "full"`, `"media_upload": true`.
- Icon fields always use `select` type with the canonical choices block above — never `text`.
- **`url` field type is banned.** Every URL or link — CTAs, logo hrefs, card links, nav links — must use `link` type with `"return_format": "array"`. PHP access: `$link['url']`, `$link['title']`, `$link['target']`.
- Do **not** add or modify any `wrapper`, `html tag`, `classes` of existing HTML section. The structure of HTML and class should be `exactly` the same as it is. Only update the structure/classes of HTML when is is asked to update.
- Include `"required": 0` on all fields unless the HTML clearly implies the field is always present and non-optional.
- `"instructions"` should be a short, plain-English hint for the CMS editor (1 sentence max).
- Set `"default_value"` to match the content visible in the HTML block for every text, textarea, wysiwyg, url, and select field.

---

## PHP Template Rules

### File header

```php
<?php
/**
 * Module: [Human Readable Name]
 * Template Part: template-parts/modules/ss_[module_name].php
 * ACF Flexible Content Layout: ss_[module_name]
 *
 * Fields:
 *  - ss_[module_name]_[field] ([type])
 *  — (list all top-level fields)
 */
```

### Field retrieval

Always retrieve flexible content sub-fields with:

```php
$field_value = get_sub_field('ss_[module_name]_[field_name]');
```

For images (return format: array):

```php
$image = get_sub_field('ss_[module_name]_hero_image');
if ($image) : ?>
  <img src="<?php echo esc_url($image['url']); ?>"
       alt="<?php echo esc_attr($image['alt']); ?>"
       width="<?php echo esc_attr($image['width']); ?>"
       height="<?php echo esc_attr($image['height']); ?>">
<?php endif; ?>
```

For repeaters:

```php
if (have_rows('ss_[module_name]_[repeater_name]')) :
  while (have_rows('ss_[module_name]_[repeater_name]')) : the_row();
    $sub_field = get_sub_field('ss_[module_name]_[repeater_name]_[field_name]');
  endwhile;
endif;
```

For relationships:

```php
$posts = get_sub_field('ss_[module_name]_[relationship_field]');
if ($posts) :
  foreach ($posts as $post) :
    setup_postdata($post);
    // access fields
  endforeach;
  wp_reset_postdata();
endif;
```


---

## Output Format

For each section, produce outputs in this exact order:

---

### Output 1 — ACF JSON

**File path**: `\theme\acf-json\group_ss_reusable_modules.json` ← **always this single file**

If the file already exists, output **only the new layout object** to append into the `layouts` array.
If the file does not yet exist, output the full JSON with the group wrapper.

```json
// New layout to append inside "layouts": [ ... ]
{
  "key": "layout_ss_[module_name]",
  "name": "ss_[module_name]",
  "label": "[Human Readable Layout Label]",
  "display": "block",
  "sub_fields": [ ... ]
}
```

---

### Output 2 — PHP Template Part

**File path**: `\theme\template-parts\modules\ss_[module_name].php`

```php
<?php ... full PHP ... ?>
```

---

### Output 3 — Component CSS (only if needed)

**File path**: `\theme\tailwind\components.css` (append to existing file)

```css
/* ss_[module_name] components */
@layer components {
  .ss-[module_name]__[element] { @apply ...; }
}
```

---

## Worked Example — `ss-certification-accre`

Given the HTML section with id `ss-certification-accre` and comments:

```html
<!-- acf: section_heading (text) -->
<!-- acf: section_description (textarea) -->
<!-- acf: hero_image (image) -->
<!-- acf: programs (relationship - CPT is programs) -->
  <!-- CPT: program_image (image) -->
  <!-- CPT: program_track_label (text) -->
  <!-- CPT: program_name (CPT Post Title) -->
  <!-- CPT: program_short_description (textarea) -->
  <!-- CPT: program permalink (link) -->
```

**ACF JSON output** (abbreviated):

```json
{
  "key": "group_ss_certification_accre",
  "title": "Certification & Accreditation",
  "fields": [
    {
      "key": "ss_certification_accre_flexible_content",
      "label": "Flexible Content",
      "name": "ss_certification_accre_flexible_content",
      "type": "flexible_content",
      "layouts": [
        {
          "key": "layout_ss_certification_accre",
          "name": "ss_certification_accre",
          "label": "Certification & Accreditation",
          "sub_fields": [
            {
              "key": "ss_certification_accre_section_heading",
              "label": "Section Heading",
              "name": "ss_certification_accre_section_heading",
              "type": "text",
              "instructions": "Main heading. The orange span text is added automatically by the template.",
              "required": 0
            },
            {
              "key": "ss_certification_accre_section_description",
              "label": "Section Description",
              "name": "ss_certification_accre_section_description",
              "type": "textarea",
              "rows": 3,
              "required": 0
            },
            {
              "key": "ss_certification_accre_hero_image",
              "label": "Hero Image",
              "name": "ss_certification_accre_hero_image",
              "type": "image",
              "return_format": "array",
              "preview_size": "medium",
              "required": 0
            },
            {
              "key": "ss_certification_accre_programs",
              "label": "Programs",
              "name": "ss_certification_accre_programs",
              "type": "relationship",
              "post_type": ["programs"],
              "filters": ["search"],
              "return_format": "object",
              "instructions": "Select up to 3 program posts to display as cards.",
              "required": 0,
              "max": 3
            }
          ]
        }
      ]
    }
  ],
  "location": [[{ "param": "page_template", "operator": "==", "value": "default" }]],
  "active": true
}
```

> Note: CPT fields (program_image, program_name, etc.) live on the Program CPT itself — they are NOT added to this field group. The relationship field pulls those posts; their fields are registered on the CPT's own field group (`group_ss_programs`). Only add CPT sub-fields here if the HTML uses a **repeater** instead of a relationship.

---

## CPT Field Groups — Mandatory Rule

**Every time a `relationship` field references a CPT, you MUST also create a separate ACF field group for that CPT.**

### Rules

- **One file per CPT** — `theme/acf-json/group_ss_[cpt_slug].json` (e.g. `group_ss_programs.json`)
- **Not flexible content** — direct fields on the group, no `flexible_content` wrapper
- **Location** — `post_type == [cpt_slug]` (use the registered CPT slug, e.g. `ss_programs`)
- **Field keys** — prefixed: `ss_[cpt_slug]_[field_name]` (e.g. `ss_programs_program_image`)
- **Field names** — short, no prefix (e.g. `program_image`) so PHP `get_field('program_image', $post->ID)` stays readable
- **PHP access** — use `get_field('field_name', $post->ID)` (NOT `get_sub_field()`) when iterating the relationship array
- Include all fields the PHP template accesses via `get_field($field, $post->ID)` — nothing more, nothing less

### Structure skeleton

```json
{
  "key": "group_ss_[cpt_slug]",
  "title": "[CPT Human Label] Details",
  "fields": [
    {
      "key": "ss_[cpt_slug]_[field_name]",
      "label": "[Field Label]",
      "name": "[field_name]",
      "type": "[text|image|textarea|...]",
      ...
    }
  ],
  "location": [
    [
      {
        "param": "post_type",
        "operator": "==",
        "value": "[cpt_slug]"
      }
    ]
  ],
  "menu_order": 0,
  "position": "normal",
  "style": "default",
  "label_placement": "top",
  "instruction_placement": "label",
  "active": true,
  "description": "Fields for the [CPT] custom post type.",
  "show_in_rest": false
}
```

### Sample existing CPT field groups

| CPT slug | JSON file | Fields |
|---|---|---|
| `ss_programs` | `group_ss_programs.json` | `program_image` (image), `program_track_label` (text), `program_short_description` (textarea) |
| `ss_testimonials` | `group_ss_testimonials.json` | `reviewer_name` (text), `reviewer_location` (text), `testimonial_text` (textarea), `star_rating` (number, min 1, max 5, default 5) |

---

## Common Mistakes to Avoid

| ❌ Wrong | ✅ Correct |
|---|---|
| Field key without module prefix: `"key": "section_heading"` | `"key": "ss_certification_accre_section_heading"` |
| Using `get_field()` inside flexible content | Always use `get_sub_field()` |
| Putting layout/spacing classes on child elements via PHP var | Keep inline on element; extract to component CSS only if 5+ classes repeat 3+ times |
| Adding wysiwyg for a simple one-liner | Use `text` for single lines, `textarea` for plain multi-line, `wysiwyg` when inline HTML (`<strong>`, `<em>`, links) is needed |
| Wrapping wysiwyg output in a `<p>` tag | `echo wp_kses_post($field)` directly — wysiwyg already generates block-level HTML |
| Creating component CSS for unique one-off elements | Component CSS only for repeated patterns (3+ identical instances) |
| Missing `wp_reset_postdata()` after relationship loop | Always reset after `foreach` on relationship posts |
| Using a relationship field without a CPT field group | Always create `group_ss_[cpt_slug].json` assigned to the CPT post type alongside any relationship field |
| Putting CPT fields inside `group_ss_reusable_modules.json` | CPT fields go in their own `group_ss_[cpt_slug].json` file with `post_type` location rule |
| Using `get_sub_field()` to access CPT fields in a relationship loop | Use `get_field('field_name', $post->ID)` for CPT fields |
| Hardcoding the orange `<span>` text | Add a `[heading]_highlight` (text) field; the template outputs `<span class="text-orange">` |
| Hardcoding any CTA label, button text, or link text | Always a `text` field or `link['title']` — no visible string is ever hardcoded |
| Using `url` type for any link or href | `url` type is banned — always use `link` with `return_format: "array"`. PHP: `$link['url']`, `$link['target']` |
| Using a `text` field for an icon class | Always a `select` field with the full icomoon choices block; `allow_null: 1`, `return_format: "value"` |
| Hardcoding an icon class (`icon-arrow-right`, etc.) | Always a `select` field — editor picks from the dropdown, never types a class string |

---

## Checklist Before Submitting Output

- [ ] Every field key starts with `ss_[module_name]_`
- [ ] All image fields use `"return_format": "array"`
- [ ] All fields are inside the flexible content layout's `sub_fields`
- [ ] PHP uses `get_sub_field()` throughout
- [ ] Repeater loops use `have_rows()` / `the_row()` / `get_sub_field()`
- [ ] Component CSS created only where 3+ identical 5+ class strings repeat
- [ ] PHP file header lists all top-level fields
- [ ] No Tailwind classes placed on children via PHP variables
- [ ] CPT fields are NOT duplicated into the section field group when using relationship type
- [ ] `wp_reset_postdata()` present after every relationship foreach
- [ ] No `url` type fields anywhere — all links use `link` type with `return_format: "array"`
- [ ] PHP for `link` fields accesses `$link['url']` and `$link['target']`, not the field value directly
- [ ] For every `relationship` field used, a matching `group_ss_[cpt_slug].json` exists in `theme/acf-json/` with `post_type` location rule
- [ ] CPT field group uses direct fields (no flexible content wrapper)
- [ ] CPT fields accessed in PHP via `get_field('field_name', $post->ID)` — not `get_sub_field()`
- [ ] **Every visible string has an ACF field** — no hardcoded text, labels, icons, or heading spans in the PHP template
- [ ] Heading orange/highlight portions use a `_highlight` text field
- [ ] All CTA labels come from a `link['title']` or `text` field
- [ ] All icon classes come from a `text` field (never `<i class="icon-arrow-right">` literal)
- [ ] Body content with `<strong>` / `<em>` / inline links uses `wysiwyg` not `textarea`
- [ ] `wysiwyg` fields output with `echo wp_kses_post($field)` — not wrapped in a `<p>` tag
- [ ] All `default_value` entries match the content shown in the HTML block