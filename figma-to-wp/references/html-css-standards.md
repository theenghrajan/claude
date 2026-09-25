# HTML Standards & Tailwind Rules

Strict adherence to these rules is mandatory. Code that deviates from these standards will be rejected in review.

## 1. Semantic HTML5 (Mandatory)
Never use `<div>` for major layout elements. Use the most specific tag available.
*   **`<header>`**: For page/section headers.
*   **`<main>`**: For the unique main content of the page.
*   **`<section>`**: For distinct thematic sections.
*   **`<article>`**: For self-contained content (cards, testimonials, blog posts).
*   **`<footer>`**: For page/section footers.
*   **`<nav>`**: For navigation menus.
*   **`<h1>`–`<h6>`**: Use in correct hierarchy. Only ONE `<h1>` per page. NEVER skip levels (e.g., H1 -> H3).
*   **`<p>`**: For paragraphs. NEVER use `<br>` to fake a paragraph.
*   **`<blockquote>`**: For quoted content or testimonials.
*   **`<time>`**: For dates and times (machine-readable).
*   **`<address>`**: For contact information.
*   **`<a>`**: For navigation. Must have an `href`.
*   **`<button>`**: For actions. Must have a `type` attribute (e.g., `type="button"`, `type="submit"`).
*   **`<ol>`/`<ul>`/`<li>`**: For lists. Never fake lists with `<div>` or `<p>`.
*   **`<figure>`/`<figcaption>`**: For images or media with optional captions.
*   **`<details>`/`<summary>`**: For interactive widgets like accordions.
*   **`<mark>`**: For highlighting text.
*   **`<aside>`**: For sidebars or supplementary content.

## 2. Naming Conventions (BEM)
Use **Block-Element-Modifier (BEM)** for custom classes. **Custom classes should only be added if absolutely required.** Always prefer Tailwind utility classes first.
*   **✅ Good**: `.product-card`, `.product-card__title`, `.product-card--featured`.
*   **❌ Bad**: `.Box1`, `.RedButton`, `.mainCont`.

## 3. Tailwind CSS Strategy (Utility-First)
*   **Modular CSS**: 
    *   Use modular CSS from the **custom folder** (`tailwind/custom/`) for **global and repetitive blocks** (e.g., buttons, common layout components).
    *   Use modular CSS for **overwriting styles** from third-party plugins (e.g., Gravity Forms, Slick Slider).
*   **Tailwind Utilities**: Use Tailwind utility classes for **all other styling** directly in the PHP templates.
*   **Content Editor Typography**: Do NOT add utility classes to standard typography tags (`<h1>`–`<h6>`, `<p>`, `<ul>`, etc.) that are rendered via the WordPress content editor. These are styled globally via the theme's typography configuration or `site-content.css`.
    *   **Component-Specific Overrides**: If specific styling changes are required for these elements within a component, they MUST be handled by applying **Tailwind Arbitrary Variants** (e.g., `[&_p]:mb-4`, `[&_h2]:text-primary`) to the **parent wrapper** of the typography tags. This ensures that the styles correctly affect the WordPress content input without adding classes directly to the typography tags.
*   **Design Tokens**: ALWAYS use the custom scale from `tailwind.config.js`.
    *   **Token Sufficiency**: If the existing tokens in the configuration are sufficient to match the design values, **DO NOT** create or extend tokens. Only add `ss-{px}` tokens to `tailwind.config.js` when the required value is not covered by Tailwind defaults (see Rule 1 in `FIGMA_TO_TAILWIND.md`).
    *   **Colors**: Use semantic aliases `primary`, `secondary`, `tertiary`, and `success` (for status/confirmation states). A full `brand` scale (`brand-50` through `brand-900`) is also available.
        *   **Semantic Extension**: If the design requires additional semantic colors, extend the naming consistently (e.g., `quaternary`, `quinary`, etc.).
        *   **Scale Extension**: If wider ranges are required for brand shades (e.g., more than the default 50–900 range), extend the scale consistently (e.g., `brand-1000`, `brand-1100`, etc.).
    *   **Spacing**: Use Tailwind default utilities (e.g., `p-8`, `mt-16`, `gap-6`) when they match the design (4px grid: 4, 8, 12, 16 … 96px). For non-default values, use `ss-{px}` tokens defined in the config (e.g., `p-ss-100`, `mt-ss-60`). Only add new tokens to `tailwind.config.js` with explicit instruction.
    *   **Typography (Size)**: Use Tailwind defaults (`text-base`, `text-lg`, `text-xl`, etc.) when they match the design. For non-default font sizes, use `ss-{px}` tokens from the config (e.g., `text-ss-26` for 26px, `text-ss-42` for 42px).
    *   **Typography (Family)**: Use `font-primary` and `font-secondary`.
    *   **Border Radius**: Use Tailwind defaults (`rounded-sm`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full`). For values beyond the default scale, use `rounded-ss-{px}` tokens from the config (e.g., `rounded-ss-32` for 32px).
    *   **Line Height**: Use Tailwind defaults for common line heights (`leading-tight`, `leading-snug`, `leading-normal`, `leading-relaxed`). For non-default values, use `leading-ss-{n×100}` tokens from the config (e.g., `leading-ss-115` for 1.15).
    *   **Box Shadow**: Use Tailwind defaults where they approximate the design (`shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`). For custom shadows, use `shadow-ss-{descriptor}` tokens from the config (e.g., `shadow-ss-card`). Never use arbitrary shadow values.
    *   **Z-Index**: Use Tailwind defaults (`z-0`, `z-10`, `z-20`, `z-30`, `z-40`, `z-50`). For custom stacking, use `z-ss-{n}` tokens from the config: `z-ss-1` (minor stacking), `z-ss-60` (fixed header), `z-ss-10000` (mobile nav drawer).
    *   **Height/Width**: Use Tailwind default height and width utilities. Avoid fixed `w-*` or `h-*` on section elements — use padding or `min-/max-` variants instead (see DO_NOT.md Rule 3).
*   **Built-in Custom Utilities**: The config registers the following utility classes — use them directly without adding new CSS:
    *   **`.stretched-link`**: Makes an entire parent element clickable by stretching the link's `::after` pseudo-element to cover it. Requires `position: relative` on the parent.
    *   **`.title-white`**: Forces all heading tags (`h1`–`h6`) inside the wrapper to render in white. Use on section wrappers over dark backgrounds.
    *   **`.counter-wrap`**: Resets a CSS counter on the element. Pair with `.counter-count` or `.counter-count-alt` on children to auto-number items.
    *   **`.counter-count`**: Displays a zero-padded auto-incremented number (e.g., `01`, `02`) via `::before`.
    *   **`.counter-count-alt`**: Same as `.counter-count` but appends a period (e.g., `1.`, `2.`).
*   **No Arbitrary Values**: Avoid `text-[#123456]` or `mt-[37px]`. Map them to the nearest Tailwind token or add them to the config.
*   **Responsive First**: Use responsive prefixes with the tokens defined in `tailwind.config.js`. Five named breakpoints are defined, plus the default (unprefixed) mobile base:

    | Prefix | Min-Width | Use For |
    |---|---|---|
    | (default) | 0px | Mobile base styles |
    | `sm:` | 576px | Small devices |
    | `md:` | 768px | Tablets |
    | `lg:` | 992px | Desktop |
    | `xl:` | 1200px | Wide desktop |
    | `2xl:` | 1310px | Extra-wide / large monitors |

## 4. Image Standards
*   **Format**: Use **SVG** for icons/logos and **WebP** for photos.
*   **Attributes**: `alt`, `width`, and `height` are MANDATORY.
*   **Optimization**: Use `loading="lazy"` for all images below the fold.
*   **File Naming**: All static image filenames MUST be **lowercase and hyphen-separated** (e.g., `hero-banner.webp`). Never use spaces, underscores, or uppercase letters.
*   **Location**: 
    *   **Static Background Images**: Must live in `theme/images/`.
    *   **Dynamic Media**: Managed via the WordPress Media Library (`wp-content/uploads/`).
    *   **Icons**: 
    *   **Font Icons**: Generally created and managed via **Icomoon** in `theme/fonts/`.
    *   **SVG Icons**: SVGs are placed in `theme/images/` or embedded directly if required for specific color/animation needs.

## 5. Accessibility & UX
*   **Links vs Buttons**: Use `<a>` for navigation (URL changes) and `<button>` for actions (JS triggers, form submission).
*   **Form Labels**: NEVER use placeholders as a replacement for `<label>`. Every form input MUST have a unique `id` and a matching `<label for="...">`.
*   **Link Formatting**:
    *   **Phone**: Must use the `tel:` format (e.g., `href="tel:1234567890"`).
    *   **Email**: Must use the `mailto:` format.
    *   **External**: Use `target="_blank"` with `rel="noopener noreferrer"`.
*   **Hierarchy**: Only ONE `<h1>` per page. Do not skip heading levels (e.g., H1 -> H3 is forbidden).
*   **Touch Targets**: Buttons/links must be at least 44x44px for mobile.

## 6. Standard Component Markup

### Section Structure — Always Follow This

Every section uses one of two container types depending on the Figma artboard width. **You MUST confirm with the user which container to use for each section before building it.**

#### Constrained Width — `container` (content within 1280px)
Use when the section content is centered and constrained to the max-width.
```html
<section class="">
    <div class="container">
        <!-- Content here -->
    </div>
</section>
```

#### Full Width — `.container-fluid` (content stretched to 1440px artboard)
Use when the section content spans the full width of the page with no max-width constraint.
```html
<section class="">
    <div class="container-fluid">
        <!-- Content here -->
    </div>
</section>
```

> **Note**: `.container-fluid` must be defined in `tailwind/custom/utilities.css` before use. If it does not exist, flag it to the user before proceeding.

#### How to Decide
| Figma Artboard | Content Width | Use |
|----------------|---------------|-----|
| Content within 1280px | Constrained, centered | `container` |
| Content stretches to 1440px | Full width | `.container-fluid` |

#### Confirm Before Building Every Section
Before coding any section, ask:
```
Is "[Section Name]" constrained (container) or full-width (container-fluid)?
```
Never assume — always confirm with the user.

*   **`container`** is pre-configured with `center: true` and `padding: 1rem` in `tailwind.config.js`.
*   Never put content directly inside `<section>` without a container div.
*   **`.site-wrapper`** is NOT a content container — it is the full-page shell wrapping header, main, and footer. Never use it inside sections.

---

*   **Slider/Carousel Structure (Slick)**: All carousels must follow the standard Slick structure. 
    *   **HTML Structure**: Use a simple nested `div` pattern:
        ```html
        <div class="your-slider-class">
            <div class="slide-item">Your Slide Content 1</div>
            <div class="slide-item">Your Slide Content 2</div>
        </div>
        ```
    *   **Class Initialization**: Add predefined classes to `your-slider-class` to trigger logic from `script.js`:
        *   **`slider-col-1`**, **`slider-col-2`**, **`slider-col-3`**, etc.: Sets the number of columns.
        *   **`.slickCenterMode`**: Enables Slick Center Mode for centered items.
        *   **`.slickInfinite`**: Enables an infinite loop for the slider.
        *   **`.slickAutoplayInfinite`**: Enables autoplay with infinite loop.
        *   **`.slickSameHeight`**: Automatically matches the height of all slides in the track. Requires each slide to use `.slide-item` as its direct child class for this to work.
    *   **Modifying Styles**: Use `slider.css` for any visual changes to arrows, dots, or slide spacing.

*   **Standard Form Group Pattern**: For custom form fields (non-Gravity Forms), all fields MUST be wrapped in a `.form-group` div to handle vertical spacing.
    ```html
    <div class="form-group">
        <label for="full-name">Full Name</label>
        <input type="text" id="full-name" name="full-name" required>
    </div>
    ```
    *   **Gravity Forms**: `.form-group` is **NOT required** for Gravity Forms as it manages its own field structure (`.gfield`).
    *   **Styling**: `forms.css` provides the basic styling for Gravity Forms, Search Forms, and Comment Forms.
    *   **Underline Variant**: For input fields that require a border only on the bottom, wrap the parent container (e.g. the `gform_wrapper`) with the `.form-underline` class.
    ```html
    <div class="form-underline">
        <!-- Gravity form shortcode -->
    </div>
    ```
    *   **Structure**: `forms.css` manages internal styling and Tailwind `@apply` rules for consistency across all form types.

## 7. Code Style & Readability
*   **Indentation**: Use **4-space indentation** for all PHP and HTML files.
*   **One Tag Per Line**: Maintain clear, readable structures. Avoid "Div-itis" (unnecessary nested wrappers).
*   **Section Commenting**: Use comments to mark the start and end of major sections.
    ```html
    <!-- Start Hero Section -->
    <section class="py-20">...</section>
    <!-- End Hero Section -->
    ```
*   **No Inline Styles/Scripts**: Use Tailwind or the modular CSS files in `tailwind/custom/`. Never use `style="..."` or `<script>...</script>` in templates.
