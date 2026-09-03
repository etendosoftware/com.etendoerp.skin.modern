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
| `web/com.etendoerp.skin.modern/js/etendo-skin-nav.js` | Builds the left navigation panel out of `OB.Application.menu`. Loaded after the script above and stands down unless it ran. |
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

Three preferences, all set at system level by the module and overridable per client, organization,
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

### `ETSKIN_Navigation`

`sidebar` (default) or `topbar`.

`sidebar` moves the application menu out of the *Application* dropdown in the navigation bar and
into a permanent panel down the left, the way Etendo's React skin presents it, and hides the
dropdown so the menu is not in two places. `topbar` leaves the stock navigation entirely alone —
the panel is never built and the dropdown is never touched.

Anything else is read as `topbar`, so a typo costs the panel rather than the application.

See [The navigation panel](#the-navigation-panel) for what it does and what it deliberately does
not do.

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
- The two strips are marked differently, following the reference: the selected *window* tab is a
  white sheet with the accent along its bottom edge, while the selected *child* tab is marked only
  by being the lightest of three fills over the band. Neither uses a colour change on the label.

### The navigation panel

Everything the panel needs is already in the browser. `OB.Application.menu` is the complete menu
tree for the session, emitted by core's `application-menu.js.ftl`, and
`OBApplicationMenuTree#itemClick` is already the code that turns one of its nodes into an open
view. Windows, classic windows, process definitions, reports, forms, external links and recents
each open differently, and that function is where core encodes the differences — so the script
renders the tree and delegates every click to one hidden instance of that class rather than
restating any of it. Nothing here is a server round trip, and nothing here is a copy of core logic
that would drift.

- **One canvas of HTML, not a widget tree.** SmartClient positions every canvas absolutely from
  measurements it takes itself, so this menu's 277 nodes would be 277 widgets to lay out and to
  argue with about styling. One `isc.Canvas` of markup costs a single layout pass, is scrolled by
  the browser, and can actually look like the reference. It is also the only part of this module
  whose class names are ours, so it needs no attribute matching and no specificity games.
- **`redrawOnResize: false` is load-bearing.** The open folders, the scroll position and the search
  text live in the DOM. SmartClient redraws a canvas on every resize by default, which would
  rebuild the markup from `contents` and lose all three.
- **The tab set is re-sized on the way in.** It was built for a `VLayout`, where `width: '100%'`
  meant "as wide as the parent". Inside the new `HLayout` width is the length axis, so `'100%'`
  would push it off the right edge by exactly the width of the panel; SmartClient's `'*'` — take
  what is left — is the intent. Height becomes the breadth axis and does stretch, so it goes to
  `'100%'`.
- **Clicks are handled on `document`, in the capture phase.** SmartClient stops a good deal of what
  happens inside its own canvases, and a listener bound to the canvas handle would not survive a
  redraw. The search input additionally stops `mousedown`, which is what stops SmartClient's event
  handler taking focus off it mid-keystroke.
- **Hiding the stock dropdown is the last thing `install` does.** If any earlier step throws, the
  panel is missing but the *Application* menu is still in the navigation bar, so the user still has
  a menu.
- **The panel ships no strings of its own.** A new `AD_MESSAGE` would mean the module has to be
  reinstalled before the text appeared, and an English literal in a Spanish installation is worse
  than an unlabelled icon. So the search box has an icon and no placeholder — core has no "Search"
  label — and the recents heading reuses `OBKMO_RecentViews`.

Filtering is two classes: one on the root, which opens every subtree so a match four levels down is
visible without expanding anything, and one on each group that contains no match, which takes it
out of the flow. Clearing the box drops both and the panel is back to whatever the user had open —
the expanded state is never thrown away.

Collapsed, the panel becomes a 52px rail of the *top level only*. Railing every level would be four
depths of identical glyphs with no titles, which is why the first version of this hid the tree
outright; railing one level is a different thing, because the nine or so sections of an Etendo menu
are few enough to be recognised and the tile for the section containing the open view is marked, so
the rail still answers "where am I". Clicking a tile expands the panel, opens that section and
scrolls it into view; the search box expands the panel and takes focus. The choice is remembered in
`localStorage`, per browser, wrapped in try/catch because a private window throws.

A tile shows a two-letter monogram taken from the section title — first letters of the first two
significant words, stopwords in English and Spanish skipped, a single-word title contributing its
first two letters. Monograms rather than shipped artwork, because **a folder node in
`OB.Application.menu` carries no id**: its keys are exactly `title`, `singleRecord`, `readOnly`,
`editOrDeleteOnly`, `type` and `submenu`. There is nothing stable to key an icon table on except the
translated title, and the menu is data — a client can rename a section or add one. A monogram is
derived from whatever the title happens to be, so it is always present, correct in every language
and works for third-party sections. Collisions are possible (*Procurement Management* and
*Production Management* both give `PM`); each tile carries the full title as its tooltip.

Real artwork drops in without a rework. If `OB.ETSkin.navIcons` exists, the renderer reads
`navIcons[title]` for each top-level node and emits that as an `<img>` in place of the monogram, in
the rail and in the expanded row alike. Populating it needs no core change: this module's own
`ComponentProvider` can register a generated `.js.ftl` resource that reads `AD_MENU` (joined to
`AD_MENU_TRL` for the session's language, which is the same text the menu itself was built from) and
emits `OB.ETSkin.navIcons = {"<title>": "data:image/png;base64,…"}`. Top-level titles are unique
within a menu, so the title is a sound key on the server side too.

Two things it deliberately does not do in this version. It does not scroll the current view into
sight or expand the folders above it on every tab switch: the folder containing the open view is
tinted instead, which points at it without fighting a user who just collapsed that folder. And it
matches the open tab to a menu row by title, because a title is all a tab and a menu node reliably
share.

### The boot screen

`index.jsp` paints a screen before any of this module's JavaScript has run: a white sheet, the word
`LOADING...` in 12px Arial and a 220x16 animated GIF. It is the first thing anyone sees, so it is
restyled here — a desk gradient, the Etendo mark and a slim indeterminate bar, with the stock text
and GIF hidden.

Three things make it unlike the rest of the stylesheet:

- **It is not scoped under `.etskin-on`.** That class is added by `etendo-skin.js`, which is the last
  resource in the bundle; by the time it runs the boot screen is nearly over. So these rules apply
  unconditionally, exactly like the login page.
- **The palette tokens therefore live on `:root`, not on `.etskin-on`.** Custom properties are inert
  until something reads them, so declaring them unconditionally costs a client that has the skin
  turned off nothing at all.
- **Everything is scoped to `#OBLoadingDiv`.** `.OBLoadingPromptModalMask` and
  `.OBLoadingPromptLabel` are not only the boot markup's classes — they are also SmartClient's
  `mainLayoutStyleName` and `loadingTextStyleName` (`ob-application-styles.js`), used for the
  *in-application* loading prompt. Styling the bare classes would repaint that too. The id is also
  what supplies the specificity: `index.jsp` repeats its own copy of these rules in an inline
  `<style>` that comes *after* the kernel's stylesheet `<link>`, so an equal-specificity rule loses.

The mask gets an explicit `z-index`. Stock leaves it at the default stacking level and only lifts
the box inside it, which holds right up to the moment `OB.Layout.draw()` starts creating canvases
with six-figure z-indexes — the half-drawn application then shows through the mask that is supposed
to be covering it.

The markup is untouched: the `LOADING...` string is hardcoded English in `index.jsp`, so replacing
it through `content:` would trade an ugly translated string for an untranslatable one. It is hidden
instead, and the bar carries the meaning.

The same art shows up a second time, inside the application: opening a window, switching to a tab
whose pane has not been built, the calendar and the branding widget all call
`OB.Utilities.createLoadingLayout`, which puts a label next to
`OB.Styles.LoadingPrompt.loadingImage` — the very GIF `index.jsp` used. That is handled in the same
place, by matching the `<img>` on its file name and replacing it with a 1x1 transparent GIF through
`content:`, which empties the element while leaving a box to paint the same bar on. Replacing it
rather than hiding it matters: `visibility: hidden` would take the background with it. Doing it in
JS was the alternative, but that would mean overriding a core function
`com.smf.smartclient.boostedui` already overrides.

There the label is kept — it is `OBUIAPP_LOADING`, so unlike the boot screen's hardcoded string it
is translated, and it is the only thing on that pane a screen reader can read.

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
