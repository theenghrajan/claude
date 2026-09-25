# Theme File Standards

Read this file when registering a Custom Post Type, creating template files, or working with WP template hierarchy.

---

## Template Hierarchy — This Project

WordPress loads templates in a specific order. Know which file handles what.

```
Request type              Template file loaded
─────────────────────────────────────────────────────────────────
Static page               template-pages/tpl-{name}.php   ← custom page template (preferred)
                          page.php                         ← fallback for pages without template
Single post (blog)        single.php
Single CPT post           single-{post_type}.php           ← e.g. single-ss_services.php
                          single.php                       ← fallback if specific file missing
CPT archive               archive-{post_type}.php          ← e.g. archive-ss_services.php
                          archive.php                      ← fallback
Blog archive / home       archive.php
404                       404.php
Search results            search.php
```

---

## Template Files — Purpose of Each

### `page.php` — Generic Page Fallback

Used for any WP page that does **not** have a specific template assigned.

Behaviour in this project:
- Reads ACF Flexible Content field `flexible_layout` on the current page
- Loops rows and calls `get_template_part('template-parts/modules/' . $layout)` for each
- Falls back to `the_content()` if no flexible layout rows exist

```php
// page.php pattern
get_header();
if ( have_rows('flexible_layout') ) :
    while ( have_rows('flexible_layout') ) : the_row();
        $layout   = get_row_layout();
        $row_data = get_row( true );
        get_template_part( 'template-parts/modules/' . $layout, null, ['value' => $row_data] );
    endwhile;
else :
    // Fallback — plain WP editor content
    echo '<section class="container my-12"><div>';
    the_content();
    echo '</div></section>';
endif;
get_footer();
```

### `single.php` — Single Blog Post

Handles individual `post` type entries.
Delegates to `template-parts/content/content-single.php` for the actual markup.
Also handles post navigation and comments.

Do not use this for CPT singles — create `single-{cpt}.php` instead.

### `archive.php` — Archive / Listing Pages

Handles post type archives, date archives, category/tag archives.
Delegates to:
- `template-parts/content/content-excerpt.php` — for each post card
- `template-parts/content/content-none.php` — when no posts found

Do not use this for CPT archives — create `archive-{cpt}.php` instead.

### `404.php` — Not Found

Shown when WP cannot match a URL to any content.
Keep minimal — heading + message + link home.

### `search.php` — Search Results

Handles `/?s=query` requests.

### `index.php` — Ultimate Fallback

WP uses this only if no other template matches. Should always exist but never be the primary handler.


## Content Template Parts — `template-parts/content/`

These are sub-templates called from inside loop files. Never call them directly from template pages.

| File | Called From | Purpose |
|---|---|---|
| `content.php` | `archive.php`, `index.php` | Default post card |
| `content-single.php` | `single.php` | Full single post body |
| `content-excerpt.php` | `archive.php` | Post card with excerpt |
| `content-page.php` | _(reserved)_ | Static page body |
| `content-none.php` | `archive.php`, `search.php` | "No posts found" message |

Usage pattern:
```php
while ( have_posts() ) :
    the_post();
    get_template_part( 'template-parts/content/content', 'single' );
endwhile;
```

---

## Layout Template Parts — `template-parts/layout/`

Global layout partials, called from `header.php` and `footer.php`.

| File | Purpose |
|---|---|
| `header-content.php` | Top bar + main nav markup |
| `footer-content.php` | Footer columns, copyright |
| `banner-content.php` | Page hero / inner banner (global) |

Do not duplicate header/footer markup in template pages — always pull from `header.php` / `footer.php`.

---

## Custom Post Types (CPT)

### Registration Location

All CPTs are registered in:
`theme/inc/SmartSites/CustomPostTypeAndTaxonomy.php`

Always add new CPTs to this file — never scatter `register_post_type()` calls in `functions.php`.

### Current CPTs in This Project

| CPT Slug | Label | Public | Archive | Purpose |
|---|---|---|---|---|
| `ss_testimonials` | Testimonials | No | No | Admin-only data source for testimonial modules |

### CPT Registration Pattern

```php
function ss_register_cpt_{name}() {
    $labels = [
        'name'          => __( '{Plural}',   'ss_theme' ),
        'singular_name' => __( '{Singular}', 'ss_theme' ),
        'add_new_item'  => __( 'Add New {Singular}', 'ss_theme' ),
        'edit_item'     => __( 'Edit {Singular}',    'ss_theme' ),
        'not_found'     => __( 'No {plural} found',  'ss_theme' ),
        'menu_name'     => __( '{Plural}',   'ss_theme' ),
    ];

    register_post_type( 'ss_{name}', [
        'labels'          => $labels,
        'public'          => false,   // no front-end URL unless needed
        'show_ui'         => true,    // visible in WP Admin
        'show_in_menu'    => true,
        'show_in_rest'    => false,   // disable Gutenberg unless needed
        'menu_icon'       => 'dashicons-{icon}',
        'supports'        => [ 'title', 'editor' ],
        'has_archive'     => false,   // set true if archive page needed
        'rewrite'         => false,   // set slug if public
        'capability_type' => 'post',
    ] );
}
add_action( 'init', 'ss_register_cpt_{name}' );
```

### Public vs Admin-Only CPTs

| Setting | Use when |
|---|---|
| `'public' => false` | Data source only (testimonials, team members, FAQs used inside modules) |
| `'public' => true` | CPT needs its own front-end URLs (blog, services, case studies) |

---

## Template Files for CPTs

### Single CPT Template — `single-{post_type}.php`

Create when a CPT post needs its own front-end detail page.

Filename: `single-ss_{name}.php` — e.g., `single-ss_services.php`

```php
<?php
/**
 * Single template for ss_services CPT
 *
 * @package ss_theme
 */

get_header();
?>
<section class="max-w-content mx-auto px-6 py-16">
    <?php while ( have_posts() ) : the_post(); ?>
        <h1 class="text-h2-lg font-bold text-primary mb-6"><?php the_title(); ?></h1>
        <div class="prose"><?php the_content(); ?></div>
    <?php endwhile; ?>
</section>
<?php get_footer();
```

### Archive CPT Template — `archive-{post_type}.php`

Create when a CPT needs a listing/archive page.
Only needed if `'has_archive' => true` in `register_post_type()`.

Filename: `archive-ss_{name}.php` — e.g., `archive-ss_services.php`

```php
<?php
/**
 * Archive template for ss_services CPT
 *
 * @package ss_theme
 */

get_header();
?>
<section class="max-w-content mx-auto px-6 py-16">
    <h1 class="text-h2-lg font-bold text-primary mb-8"><?php post_type_archive_title(); ?></h1>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <?php while ( have_posts() ) : the_post(); ?>
            <article>
                <h2 class="text-h2-sm font-semibold text-primary">
                    <a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
                </h2>
                <div><?php the_excerpt(); ?></div>
            </article>
        <?php endwhile; ?>
    </div>
    <?php ss_theme_the_posts_navigation(); ?>
</section>
<?php get_footer();
```

---

## When to Use Which Template

| Scenario | Template to use |
| Static page with defined sections | `template-pages/tpl-{name}.php` |
| Page managed via ACF flexible layout | `page.php` (automatic) |
| Single blog post | `single.php` (already exists) |
| Single CPT post with public URL | `single-ss_{name}.php` (create new) |
| CPT listing/archive page | `archive-ss_{name}.php` (create new) |
| CPT used as data source only (no front-end) | No template needed — `public => false` |

---


## Dos

- ✅ Register all CPTs in `inc/SmartSites/CustomPostTypeAndTaxonomy.php`
- ✅ Prefix all CPT slugs with `ss_` — `ss_testimonials`, `ss_services`
- ✅ Use `'public' => false` for CPTs that only supply data to modules
- ✅ Create `single-{cpt}.php` and `archive-{cpt}.php` for public CPTs
- ✅ Always flush rewrite rules after registering a new CPT
- ✅ Use `get_template_part()` inside template files — never raw `include()`
- ✅ Always call `get_header()` and `get_footer()` in every template file
- ✅ Use `the_title()`, `the_content()`, `the_permalink()` inside the loop — never access `$post` directly
- ✅ Match `Template Name:` comment text exactly to what WP Admin will display

## Don'ts

- ❌ Never put `register_post_type()` in `functions.php` — use `CustomPostTypeAndTaxonomy.php`
- ❌ Never create a CPT without the `ss_` prefix
- ❌ Never set `'has_archive' => true` without also creating `archive-ss_{name}.php`
- ❌ Never set `'show_in_rest' => true` unless the CPT needs Gutenberg or REST API access
- ❌ Never use `page.php` for pages that have a specific `tpl-*.php` — assign the template
- ❌ Never hardcode post IDs or post type slugs inside template files
- ❌ Never modify `single.php` or `archive.php` for CPT-specific layouts — create a dedicated file
- ❌ Never skip `get_header()` / `get_footer()` — scripts and styles won't load
- ❌ Never query posts manually with `new WP_Query` inside `page.php` — the main query is already set


---

# Theme Settings — Global Options Pages

Read this file when working on the Theme Settings admin menu or any global header/footer/map fields which hold the values of the section or elements that will be used across multiple pages.

---

## Admin Menu Structure

**Theme Settings** (top-level menu)
- **Header** — logo, top bar text
- **Footer** — footer logo, phone, address, maps, bottom bar
- **Other** — map embed code

Registered via ACF Options Pages. Located in `theme/functions.php`.

---

## Sample Field Groups & Field Names

### Header Options Page

| Field | ACF Name | Type |
|---|---|---|
| Logo | `ss_logo` | Image |
| Top Bar Left Text | `ss_topbar_left_text` | Text |
| Top Bar Right Link | `ss_topbar_right_link` | Link |

### Footer Options Page

| Field | ACF Name | Type |
|---|---|---|
| Footer Logo | `ss_footer_logo` | Image |
| Footer Phone | `ss_footer_phone` | Link |
| Address | `ss_address` | Link |
| Google Maps Link | `ss_maps_link` | Link |
| Bottom Bar Page Link | `ss_bottombar_page_link` | Link |
| Copyright Text | `ss_copyright_text` | Text |

### Other Options Page

| Field | ACF Name | Type |
|---|---|---|
| Map Embed Code | `ss_map_embed` | Textarea |

---

## Reading Global Fields in Templates

```php
// In header.php
$logo      = get_field( 'ss_logo', 'option' );
$logo_url  = is_array( $logo ) ? $logo['url'] : wp_get_attachment_image_url( (int) $logo, 'full' );
$topbar_left  = get_field( 'ss_topbar_left_text', 'option' );
$topbar_right = get_field( 'ss_topbar_right_link', 'option' );

// In footer.php
$footer_logo  = get_field( 'ss_footer_logo', 'option' );
$footer_phone = get_field( 'ss_footer_phone', 'option' );
$address      = get_field( 'ss_address', 'option' );
$copyright    = get_field( 'ss_copyright_text', 'option' );

// In map module
$embed = get_field( 'ss_map_embed', 'option' );
```

---

## ACF JSON for Options Pages

Options page field groups are saved to `theme/acf-json/` like all others.
Location rule must be: `options page == {options_page_slug}`.

---

## Dos

- ✅ Always use `'option'` as the second argument to `get_field()` for Theme Settings fields
- ✅ Always sanitize output even for options page fields
- ✅ Always save options page field groups to `acf-json/`
- ✅ Always use `ss_` prefix for all field names

## Don'ts

- ❌ Never hardcode phone numbers, logo paths, or addresses in `header.php` or `footer.php`
- ❌ Never read options page fields from inside a module that is used per-page — pass via `$args` instead
- ❌ Never register options pages with `add_menu_page()` directly — use ACF `acf_add_options_page()`
