# Etendo Modern Skin

A configurable skin for the Etendo Classic (OB3 / SmartClient) UI. It restyles the application
shell — toolbar, grids, tabs, form fields, navbar, workspace, message bars — and the login page,
without replacing the stock skin and without forking any core stylesheet.

The palette is chosen by configuration, not by editing CSS.

## How it is put together

| Piece | What it does |
| --- | --- |
| `src/com/etendoerp/skin/modern/SkinComponentProvider.java` | Registers the stylesheet and the script with the kernel resource pipeline. |
| `web/com.etendoerp.skin.modern/css/etendo-skin.css` | The whole application skin, authored against CSS custom properties. |
| `web/com.etendoerp.skin.modern/js/etendo-skin.js` | Resolves the palette per session and writes the custom properties onto `<html>`. Also overrides the SmartClient sizes that live in JS rather than CSS. |
| `web/com.etendoerp.skin.modern/css/etendo-skin-login.css` | The login page, loaded by a `<link>` in `Login.html`. |
| `web/com.etendoerp.skin.modern/fonts/` | Inter, self hosted. Two woff2 subsets, declared by both stylesheets. |

Every rule in the application stylesheet is scoped under `.etskin-on`, a class the script adds to
the root element. Nothing is styled until the script decides the skin is on, so disabling the
preference leaves the stock appearance untouched.

### Why the palette is resolved in the browser

The generated CSS bundle is cached under a key built from the application name and the skin
version only — there is no client, organization, role or user in it (see
`StyleSheetResourceComponent#getAppNameKey`). Baking a palette into the CSS would therefore freeze
the bundle with whatever the *first* requesting user happened to have configured, and serve it to
everyone else. So the CSS ships palette-agnostic, and `etendo-skin.js` reads `OB.Properties` — which
the kernel populates from the preferences applicable to the current session — and sets the
`--sk-*` custom properties at runtime.

## Configuration

Two preferences, both set at system level by the module and overridable per client, organization,
role or user through *General Setup → Application → Preference*.

### `ETSKIN_Enabled`

`Y` (default) or `N`. Opt-out, not opt-in. Set it to `N` for a client, role or user to give them
the stock appearance back.

The skin also stands down on its own when `SKINLEG_LegacySkin` is `Y`, because `index.jsp` swaps
the entire bundle in that case.

### `ETSKIN_Theme`

A JSON object. Every key is optional.

```json
{ "preset": "indigo" }
```

```json
{ "preset": "slate", "primary": "#0f766e", "radius": "4px", "density": "compact" }
```

| Key | Values | Notes |
| --- | --- | --- |
| `preset` | `etendoNext`, `indigo`, `etendo`, `slate`, `emerald` | The base token set. Defaults to `etendoNext`. |
| `primary` | any hex colour | Selection, links, focus rings, the active child tab. |
| `accent` | any hex colour | Toolbar action buttons, required-field markers. |
| `marker` | any hex colour | The bar down the edge of the focused view. |
| `danger` | any hex colour | Errors. |
| `surface`, `canvas`, `canvasTint`, `text` | any hex colour | The four neutrals. `canvas` is the top of the desk gradient, `canvasTint` the bottom. |
| `radius` | any CSS length | Corner radius for fields, buttons and cells. |
| `density` | `compact`, `comfortable`, `spacious` | Row height, field height and tab bar height. |
| `font` | any CSS font stack | Defaults to Inter, which the module ships, with a system fallback. |

Keys not given fall back to the preset, and an unknown preset falls back to `indigo`. A malformed
value leaves the whole theme at its defaults rather than half-applying.

Contrast is derived, never configured: `--sk-on-primary`, `--sk-on-accent` and `--sk-on-danger` are
computed from the relative luminance of the colour they sit on, so a light `primary` flips its
label to black without the administrator having to know that.

`etendoNext` is the default and the reference look: it restates the palette of Etendo's React skin
(`demo.etendo.cloud`) in Classic's vocabulary — a periwinkle desk fading to near white, the windows
as white sheets laid on it, a near-black action pill, blue for selection, and the familiar yellow
kept for the focus marker.

The `etendo` preset restates the stock Classic colours as tokens instead. It is the low-risk
rollout step — modern geometry, typography and icons, familiar colours.

### The login page

Deliberately not themed, though its fixed tokens are kept in step with the `etendoNext` preset by
hand, so the two pages agree. The login page runs before authentication, so there is no client, role or
user to resolve a preference against; its tokens are the module defaults. Making it configurable
would mean keying it on something available pre-login — the host name, or a system-level preference
read in `Login.java` — which is a non-goal for this version.

## Core changes

One line, in `src/org/openbravo/erpCommon/security/Login.html`, immediately after the page's inline
`<style>` block:

```html
<link rel="stylesheet" type="text/css" href="../web/com.etendoerp.skin.modern/css/etendo-skin-login.css"></link>
```

It has to be a template edit because `Login.html` is generated by XmlEngine and is not part of the
kernel resource pipeline. Everything else — the entire application skin — is registered through
`ComponentProvider` and touches no core file.

## Typography

Inter is bundled rather than pulled from a CDN: an ERP is routinely installed behind a firewall,
and a webfont that fails to load is a skin that silently renders in the platform UI font. Inter 20
is a variable font, so the four weights this skin uses cost one file per subset, not four:
`latin` at 48 kB and `latin-ext` at 85 kB, the second gated behind `unicode-range` so it only
downloads for a page that needs the accented ranges.

Both stylesheets reference the files as `url(./../fonts/...)`. That form is deliberate. The
application stylesheet is served from inside the kernel's concatenated bundle, whose own URL is a
servlet and not this directory, so a relative path would resolve against the servlet; the kernel
rewrites the `./` prefix to the module web directory of the file that contained it
(`StyleSheetResourceComponent`, "repair urls"). The same string is also correct for the login
stylesheet, which is linked straight from its `css` directory.

## Layout notes

SmartClient positions every pane absolutely, with inline `left`/`top`/`width`/`height` it has
already measured. Nothing here can add a margin or a border to a pane without moving something the
framework is counting on, so the sheet-on-a-desk look is built out of things that cost no layout:

- The desk gradient is painted once, on `.OBTabSetMain`, and every pane between it and the content
  is transparent. Painting it per pane instead gives a flat slab of the strong end of the gradient
  wherever a pane happens to start.
- The sheet is not inset. It gets rounded top corners and the canvas shows through around the tab
  strip, which reads the same at a glance.
- The React skin's chips do not transfer to the workspace list: SmartClient sizes those rows to the
  column rather than to their text, so a filled pill becomes a full-width lozenge with the drag
  handle and the add button sitting outside it.
- They do transfer to the child tab strip, which is the one place a pill is affordable: those tab
  buttons are sized to their own title. Even there the pill is a `::before` inset inside the
  button, because the button itself carries an inline `width` and `height` SmartClient measured -
  a margin would move it and a border would grow it.

## Conventions the stylesheet follows

- **Attribute selectors over class lists.** SmartClient class names carry combinatorial state
  suffixes (`OBGridCell`, `OBGridCellSelected`, `OBGridCellOverSelectedDisabled`, …). Prefix and
  substring matching (`td[class^="OBGridCell"][class*="Selected"]`) covers the whole family and, at
  specificity 0-2-1 against the stock 0-1-0, wins regardless of concatenation order.
- **Explicit lists where a match would hide something.** The toolbar icons are the exception: they
  are masked SVG, and masking hides the stock image, so a prefix match would blank out any icon
  this module does not define — including icons added by other modules. They are listed by name, so
  an unknown icon keeps its stock PNG.
- **No parentheses inside `url()`.** The CSS pipeline rewrites `url(` one line at a time and stops
  at the first `)`, so the inline SVG data URIs contain none.
- **Conservative ES5 in the script.** It is concatenated into the global bundle and minified with
  Crockford's JSMin; one syntax error takes the application down.
