# JavaScript Development Guide

All frontend logic in the **ss_theme** is organized into a modular `ss` object pattern. While we use **Vanilla JavaScript** where possible, the boilerplate currently utilizes **jQuery** (aliased as `$`) for DOM manipulation and third-party plugin integration.

## 1. jQuery & The `ss` Object
All project-specific logic MUST be encapsulated within the `ss` global object. This keeps the global namespace clean and ensures logic is initialized only after the DOM is ready.

### Standard Pattern:
```javascript
var ss;
(function ($) {
    ss = {
        init: function () {
            this.nav();
            this.form();
            this.misc();
            this.slider();
            this.gallery();
        },
        nav: function () { /* Navigation, sticky header, mobile toggle, smooth scroll */ },
        form: function () { /* Custom form controls (e.g., quantity inputs) */ },
        misc: function () { /* Accordions, toggle blocks, MatchHeight */ },
        slider: function () { /* Slick initialization */ },
        gallery: function () { /* Fancybox lightbox initialization */ }
    };
    $(function () { ss.init(); });
})(jQuery);
```

### Module Reference

| Method | Responsibility |
|---|---|
| `nav()` | Sticky header, mobile toggle (`.navbar-toggler`), dropdown carets (`.caret`), smooth scroll (`.js-has-smooth-scroll`), banner padding (`.banner`) |
| `form()` | Quantity input controls — adds increment/decrement buttons to `.input-text.qty` elements |
| `misc()` | Accordions (`.accordion`), toggle blocks (`.toggleBtn`), MatchHeight (`data-fix="height"`) |
| `slider()` | All Slick Slider initializations via the class-based system |
| `gallery()` | Fancybox lightbox initialization (`.fancybox`) |

## 2. Navigation & Sticky Header
*   **Sticky Logic**: The `nav()` method automatically adds the `.stickyHeader` class to `.site-header` when the user scrolls more than 60px.
*   **Mobile Toggle**: Use the `.navbar-toggler` class for the mobile menu. It toggles `.collapsed` on the button and `.show` on the `.navbar-collapse`.
*   **Smooth Scroll**: Any link (`<a>`) with the class `.js-has-smooth-scroll` will automatically trigger a smooth-scroll animation to its anchor target.

## 3. Slick Slider Implementation
The theme includes a powerful, class-based Slick initialization system. **Do not initialize Slick manually** unless a custom configuration is required.

### Column-Based Classes:
Add these classes to your slider wrapper to set the number of visible slides:
*   `.slider-col-1` through `.slider-col-7`: Automatically handles responsive breakpoints (stacking on mobile, reducing on tablet).

### Behavioral Modifiers:
Combine the column classes with these modifiers for extra functionality:
*   `.slickInfinite`: Enables infinite looping.
*   `.slickCenterMode`: Enables Slick's center mode.
*   `.slickAutoplayInfinite`: Enables autoplay with infinite loop.
*   `.slickSameHeight`: Automatically matches the height of all slides in the track.

## 4. Third-Party Utilities
*   **MatchHeight**: Use the attribute `data-fix="height"` on elements you want to have equal height.
*   **Fancybox**: Use the class `.fancybox` on links to images or galleries. Initialized automatically in `gallery()`.
*   **Accordions**: Use the full three-level structure below. `.itemActive` is toggled on the active `.accordion-item`.
    ```html
    <div class="accordion">
        <div class="accordion-item">
            <button type="button" class="accordionBtn">Question</button>
            <div class="accordionBody">Answer content</div>
        </div>
    </div>
    ```
*   **Toggle Blocks**: Use `.toggleBtn` to show/hide a sibling `.toggleBlock`. Only one block is open at a time.
    ```html
    <button type="button" class="toggleBtn">Show More</button>
    <div class="toggleBlock">Hidden content</div>
    ```

## 5. Best Practices
*   **Conditional Checks**: Always use Vanilla JS checks like `if (document.querySelector(selector))` to prevent script errors if an element is missing. Use `try-catch` blocks for error-prone operations. Avoid `if ($(selector).length)` for new code.
*   **Bundle with esbuild**: Your source code in `javascript/script.js` is bundled into `theme/js/script.min.js`. Never edit the `.min.js` file directly.
*   **Vanilla JS**: For simple tasks (adding classes, basic fetch), prefer Vanilla JS over jQuery to improve performance.
