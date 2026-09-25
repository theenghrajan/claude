# Figma JSON → tailwind.config.js Guide

**SmartSites — ss_theme boilerplate**
Use this guide on every new project to convert a Figma JSON export into a correct `tailwind.config.js`.

# Figma Json path → `_project_data/figma_json/*.json`
User this path to read the figma json file for the design tokens.

---

## 1. Figma JSON Export Structure

The plugin exports a single JSON file with this top-level shape:

```json
{
  "metadata": { ... },
  "designTokens": {
    "colors":   { "color-rgb(...)": "rgb(...)", ... },
    "fonts":    { "font-slug": { "family": "...", "sizes": {...}, "weights": {...} } },
    "spacing":  { "gap-32": "32px", "padding-top-100": "100px", ... },
    "effects":  { "shadow-33-6": { "x": 0, "y": 6, "blur": 33, "spread": 0, "color": "rgba(...)" } }
  },
  "structure": [ ... ]
}
```

Only `designTokens` is used for config generation. The `structure` array is for component reference only.

---

## 2. Decision Rules (apply in order)

### Rule 1 — Spacing
| Figma value | Action |
|---|---|
| Matches a Tailwind default (4px grid: 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 80, 96 …) | **Use the default class.** Do NOT create a custom token. |
| Within ±4px of a default | **Use the closest default.** |
| Not in scale AND gap > 4px | Add `ss-{px}` token (e.g., `100px` → `'ss-100': '6.25rem'`) |

Tailwind v3 spacing quick-ref (px per unit):
```
p-1=4  p-2=8  p-3=12  p-4=16  p-5=20  p-6=24  p-7=28  p-8=32
p-9=36 p-10=40 p-11=44 p-12=48 p-14=56 p-16=64 p-20=80 p-24=96
p-28=112 p-32=128 p-36=144 p-40=160 p-48=192 p-56=224 p-64=256
p-72=288 p-80=320 p-96=384
```

### Rule 2 — Font Size & Line Height
Always use the **exact Figma value**. Never round to a Tailwind default.

| Token | Format | Example |
|---|---|---|
| Font size | `ss-{px}` | `'ss-13': ['0.8125rem', { lineHeight: '1.5' }]` |
| Line height | `ss-{percentage×100}` | `1.15 → 'ss-115': '1.15'` |

Tailwind v3 font-size quick-ref (px):
```
text-xs=12  text-sm=14  text-base=16  text-lg=18  text-xl=20
text-2xl=24 text-3xl=30 text-4xl=36  text-5xl=48  text-6xl=60
```

→ If a Figma font-size matches one of the above, use the default and do not override/extend. Otherwise add `ss-{n}`.

Tailwind v3 line-height quick-ref:
```
leading-none=1  leading-tight=1.25  leading-snug=1.375
leading-normal=1.5  leading-relaxed=1.625  leading-loose=2
```
→ If a Figma line-height matches one of the above, use the default and do not override/extend. Otherwise add `ss-{n}`.

### Rule 3 — Everything Else (colors, shadows, border-radius, z-index)
Same logic as spacing: use Tailwind defaults where they exist; add `ss-{value}` only when needed.

Tailwind v3 border-radius quick-ref:
```
rounded-none=0  rounded-sm=2px  rounded=4px  rounded-md=6px
rounded-lg=8px  rounded-xl=12px  rounded-2xl=16px  rounded-3xl=24px  rounded-full=9999px
```

Tailwind v3 z-index quick-ref: `z-0 z-10 z-20 z-30 z-40 z-50`

---

## 3. Token Category Mapping

### 3.1 Colors

The JSON `designTokens.colors` is a flat key→value map of every unique color used in the design.

**Steps:**
1. Identify the 3–4 dominant brand colors from the color list.
2. Build a `brand` scale (50–900) using those hues.
3. Assign semantic aliases: `primary`, `secondary`, `tertiary`.
4. Add `success` / `error` / `warning` if present in the design.
5. Ignore pure white (`#ffffff`), pure black (`#000000`), and semi-transparent overlays — these are covered by Tailwind defaults + opacity utilities.

**JSON input example:**
```json
"colors": {
  "color-rgb(45, 51, 107)":  "rgb(45, 51, 107)",
  "color-rgb(3, 10, 90)":    "rgb(3, 10, 90)",
  "color-rgb(255, 188, 80)": "rgb(255, 188, 80)"
}
```

**Config output:**
```js
colors: ({ theme }) => {
    const brand = {
        50:  '#f0f1f8',  // lightest tint (derive or ask designer)
        100: '#d9dbed',
        200: '#b3b7db',
        300: '#8d94c9',
        400: '#6670b7',
        500: '#404ca5',  // ← rgb(64, 76, 165) — primary
        600: '#2d336b',  
        700: '#23285a',  // ← rgb(36, 41, 89)
        800: '#030a5a',  // ← rgb(3, 10, 90)
        900: '#00042a',  // darkest
    };
    return {
        brand,
        primary:   { DEFAULT: brand[500] },
        secondary: { DEFAULT: brand[900] },
        tertiary:  { DEFAULT: '#ffbc50' }, // rgb(255, 188, 80) — accent
        success:   { DEFAULT: '#52971E' },
    };
},
```

> If the design has a separate accent/yellow palette, add it as a second named scale (e.g. `accent`) rather than forcing it into the brand scale.

---

### 3.2 Fonts

The JSON `designTokens.fonts` lists each font family with all sizes and weights used in the design.

**Steps:**
1. Identify primary body font and secondary/heading font (usually 2, rarely 3).
2. Map them to `fontFamily.primary` and `fontFamily.secondary`.
3. Always keep `icomoon` for the icon font.
4. Font sizes go to `fontSize` — see Rule 2.

**JSON input example:**
```json
"fonts": {
    "inter":     { "family": "Inter",     "sizes": {"size-16": "16px", "size-36": "36px", "size-64": "64px"} },
    "calibri":   { "family": "Calibri",   "sizes": {"size-18": "18px", "size-24": "24px"} }
}
```

**Config output:**
```js
fontFamily: {
    primary:   ['Inter', 'sans-serif'],
    secondary: ['Calibri', 'sans-serif'],
    icomoon:   ['icomoon'],
},
```

**Font size config output** (exact Figma values only — skip those matching Tailwind defaults):
```js
fontSize: {
    // text-base=16px ✓ default — skip
    // text-lg=18px   ✓ default — skip
    // text-xl=20px   ✓ default — skip
    // text-2xl=24px  ✓ default — skip
    // text-4xl=36px  ✓ default — skip
    // text-5xl=48px  ✓ default — skip
    'ss-26': ['1.625rem', { lineHeight: '1.4' }],  // 26px — not in default scale
    'ss-42': ['2.625rem', { lineHeight: '1.2' }],  // 42px — not in default scale
    'ss-64': ['4rem',     { lineHeight: '1.1' }],  // 64px — not in default scale
},
```

---

### 3.3 Spacing

The JSON `designTokens.spacing` lists every `gap-*` and `padding-{side}-*` value in the design.

**Steps:**
1. Collect all unique px values from the spacing object.
2. For each value, check Tailwind default scale (Rule 1).
3. Add only non-default values as `ss-{px}` tokens.

**JSON input example:**
```json
"spacing": {
    "gap-32": "32px",      "gap-80": "80px",
    "padding-top-100": "100px", "padding-right-80": "80px",
    "gap-54": "54px",      "gap-47": "47px"
}
```

**Unique values extracted:** 32, 47, 54, 80, 100

**Decision table:**
| px | Tailwind default? | Action |
|---|---|---|
| 32  | p-8=32 ✓  | Skip |
| 80  | p-20=80 ✓ | Skip |
| 47  | Closest: p-12=48 (gap=1px) | Skip — use p-12 |
| 54  | Closest: p-14=56 (gap=2px) | Skip — use p-14 |
| 100 | None (closest: p-24=96, gap=4px — borderline) | **Add ss-100** |

**Config output:**
```js
spacing: {
    'ss-100': '6.25rem',  // 100px — section vertical padding
},
```

---

### 3.4 Effects → Box Shadow

The JSON `designTokens.effects` lists all drop shadows.

**Steps:**
1. Convert each shadow to a CSS `box-shadow` string.
2. Check if it approximates a Tailwind default (Rule 3).
3. Add only non-default values as `ss-{descriptor}` tokens.

Tailwind shadow quick-ref:
```
shadow-sm  = 0 1px 2px rgba(0,0,0,.05)
shadow     = 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)
shadow-md  = 0 4px 6px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.06)
shadow-lg  = 0 10px 15px rgba(0,0,0,.1), 0 4px 6px rgba(0,0,0,.05)
shadow-xl  = 0 20px 25px rgba(0,0,0,.1), 0 10px 10px rgba(0,0,0,.04)
shadow-2xl = 0 25px 50px rgba(0,0,0,.25)
```

**JSON input example:**
```json
"effects": {
    "shadow-33-6": {
        "x": 0, "y": 6, "blur": 33, "spread": 0,
        "color": "rgba(18, 22, 61, 0.30)"
    }
}
```

**Config output:**
```js
boxShadow: {
    'ss-card': '0 6px 33px 0 rgba(18, 22, 61, 0.30)',  // card shadow — no Tailwind default matches
},
```

---

### 3.5 Border Radius

Not directly in the Figma JSON export — read from the Figma design file or project brief.

**Config output:**
```js
borderRadius: {
    // Add only values beyond rounded-3xl (24px) or values not on the default scale
    'ss-32': '2rem',   // 32px pill
    'ss-80': '5rem',   // 80px full-round buttons
},
```

---

### 3.6 Z-Index

Not in the Figma JSON — defined by the layer stack in the design or per project needs.
Always include these two baseline tokens for ss_theme projects:

```js
zIndex: {
    'ss-1':     '1',     // above z-0, below z-10 — minor stacking
    'ss-60':    '60',    // fixed header sits above z-50
    'ss-10000': '10000', // mobile nav drawer
},
```

Add more only if specific overlays (modals, tooltips) require explicit values.

---

## 4. Blank Config Scaffold

Copy this into a new project's `tailwind/tailwind.config.js` and fill in each section from the Figma JSON.

```js
const plugin = require('tailwindcss/plugin');

const includePreflight = 'editor' === process.env._TW_TARGET ? false : true;

/**
 * DESIGN TOKEN CONVENTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Tokens exported from Figma JSON and mapped below.
 * Rules: see _project_data/figma-to-tailwind.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
    presets: [
        require('./tailwind-typography.config.js'),
    ],
    content: [
        './theme/**/*.php',
    ],
    theme: {
        container: {
            center: true,
            padding: '1rem',
        },
        extend: {

            // ── COLORS ────────────────────────────────────────────────────────
            // Source: designTokens.colors in Figma JSON
            colors: ({ theme }) => {
                const brand = {
                    50:  '',   // lightest tint
                    100: '',
                    200: '',
                    300: '',
                    400: '',
                    500: '', // ← primary
                    600: '',   
                    700: '',
                    800: '',
                    900: '',   // darkest / secondary
                };
                return {
                    brand,
                    primary:   { DEFAULT: brand[600] },
                    secondary: { DEFAULT: brand[900] },
                    tertiary:  { DEFAULT: '' },
                    success:   { DEFAULT: '#52971E' },
                };
            },

            // ── SPACING ───────────────────────────────────────────────────────
            // Source: designTokens.spacing in Figma JSON
            // Only values NOT in Tailwind default scale (see Rule 1)
            spacing: {
                // 'ss-100': '6.25rem',
            },

            // ── FONT SIZE ─────────────────────────────────────────────────────
            // Source: designTokens.fonts[*].sizes in Figma JSON
            // Always exact Figma value. Format: ss-{px}
            fontSize: {
                // 'ss-13': ['0.8125rem', { lineHeight: '1.5' }],
            },

            // ── LINE HEIGHT ───────────────────────────────────────────────────
            // Source: Figma text styles / line-height values
            // Format: ss-{percentage×100}  e.g. 1.15 → ss-115
            lineHeight: {
                // 'ss-115': '1.15',
            },

            // ── BORDER RADIUS ─────────────────────────────────────────────────
            // Source: Figma design / project brief (not in JSON export)
            borderRadius: {
                // 'ss-32': '2rem',
            },

            // ── BOX SHADOW ────────────────────────────────────────────────────
            // Source: designTokens.effects in Figma JSON
            boxShadow: {
                // 'ss-card': '0 6px 33px 0 rgba(18, 22, 61, 0.30)',
            },

            // ── Z-INDEX ───────────────────────────────────────────────────────
            zIndex: {
                'ss-1':     '1',
                'ss-60':    '60',
                'ss-10000': '10000',
            },

            // ── FONT FAMILY ───────────────────────────────────────────────────
            // Source: designTokens.fonts[*].family in Figma JSON
            fontFamily: {
                primary:   ['', 'sans-serif'],   // body / default font
                secondary: ['', 'sans-serif'],   // heading / accent font
                icomoon:   ['icomoon'],
            },

            // ── SCREENS ───────────────────────────────────────────────────────
            screens: {
                sm:   '576px',
                md:   '768px',
                lg:   '992px',
                xl:   '1200px',
                '2xl': '1310px',
            },
        },
    },
    corePlugins: {
        preflight: includePreflight,
    },
    plugins: [
        require('@_tw/typography'),
        require('@_tw/themejson'),
        plugin(function ({ addUtilities }) {
            addUtilities({
                '.stretched-link': {
                    '&::after': {
                        content: '""',
                        position: 'absolute',
                        inset: '0',
                        zIndex: 'xs',
                    },
                },
                '.title-white :is(h1,h2,h3,h4,h5,h6)': {
                    color: '#ffffff',
                },
                '.counter-wrap': {
                    'counter-reset': 'counter-count 0',
                },
                '.counter-count:before': {
                    content: 'counter(counter-count, decimal-leading-zero)',
                    'counter-increment': 'counter-count',
                },
                '.counter-count-alt:before': {
                    content: 'counter(counter-count)"."',
                    'counter-increment': 'counter-count',
                },
            });
        }),
    ],
};
```

---

## 5. Step-by-Step Checklist

Use this on every new project after receiving the Figma JSON file.

- [ ] Open `designTokens.colors` — identify brand palette, build 50–900 scale, set `primary` / `secondary` / `tertiary`
- [ ] Open `designTokens.fonts` — map `family` values to `fontFamily.primary` / `fontFamily.secondary`
- [ ] Open `designTokens.fonts[*].sizes` — list all unique px values, cross-check against Tailwind font-size defaults, add only non-default values as `ss-{px}` in `fontSize`
- [ ] Scan all `fontSize` entries — note line-height values used alongside each; add non-default values as `ss-{n}` in `lineHeight`
- [ ] Open `designTokens.spacing` — extract all unique px values, apply Rule 1, add only non-default values as `ss-{px}` in `spacing`
- [ ] Open `designTokens.effects` — convert each shadow object to a `box-shadow` CSS string, check against Tailwind defaults, add non-default values as `ss-{descriptor}` in `boxShadow`
- [ ] Review Figma design or brief for any border-radius values beyond `rounded-3xl` (24px) — add as `ss-{px}` in `borderRadius`
- [ ] Confirm the two required z-index tokens (`ss-1`, `ss-60`, `ss-10000`) are present; add extras only if the design requires explicit stacking
- [ ] Run `npm run dev` — verify no build errors
- [ ] Spot-check: open the compiled `theme/style.css` and search for `ss-` to confirm all custom tokens compiled correctly

---

## 6. Naming Quick-Reference

| Token type | Format | Example |
|---|---|---|
| Spacing | `ss-{px}` | `ss-100` → `p-ss-100`, `mt-ss-100` |
| Font size | `ss-{px}` | `ss-17` → `text-ss-17` |
| Line height | `ss-{n×100}` | `ss-115` → `leading-ss-115` |
| Border radius | `ss-{px}` | `ss-32` → `rounded-ss-32` |
| Box shadow | `ss-{descriptor}` | `ss-card` → `shadow-ss-card` |
| Z-index | `ss-{n}` | `ss-60` → `z-ss-60` |
| Color (brand) | `brand-{50–900}` | `brand-600` → `bg-brand-600` |
| Color (semantic) | `primary`, `secondary`, `tertiary` | `text-primary`, `bg-secondary` |
