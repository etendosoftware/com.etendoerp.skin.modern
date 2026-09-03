# Design and UX critique — Fable 5.1

Received 2026-09-03 against the skin at commit `94bf771`, reviewing four screens of the deployed
application (`http://localhost:8888/etendo_skin`) side by side with the React product at
`https://demo.etendo.cloud`.

Verdict: *"reads as a competently re-skinned 2014 SmartClient app, not the React product; 31% of the
viewport is chrome before the first data pixel."* Worst offenders, in order: the toolbar has no
hierarchy, the form fields are over-decorated, and lavender is used as a field rather than a gutter.

Each finding below is paired with the acceptance criterion the reviewer wrote for it. The thresholds
those criteria name live in `criteria.json`; `check-source.mjs` and `check-dom.mjs` are what decide
whether they hold. `recordings/before-*.json` is what the application measured before any of this
was addressed, and `shots/before-*.png` is what it looked like.

| ID | Finding | Acceptance criterion |
|----|---------|----------------------|
| F1 | Toolbar: 16 monochrome glyphs at 55px pitch, no dividers, no primary, 10/16 disabled in form view, and the real business actions clipped off-screen. | ≤10 glyphs left of the right-anchored group; exactly one filled primary on the left; every process button fully inside the viewport (right edge ≤1420); ≥2 vertical dividers; intra-group pitch ≤36px. |
| F2 | Form fields: boxed inputs with a 2px navy left bar, grey asterisk and `↗` link glyph; column pitch 285px vs 550px. | No input `border-left` > 0; height ≥32px; three columns within ±8px; required marker hue 0–12; `↗` opacity 0 at rest and ≥0.9 on hover; ≤1 decoration per field at rest. |
| F3 | Lavender used as a field: ~55% of the workspace viewport is flat lavender. | Largest contiguous single-colour non-white region < 15% of the content area. |
| F4 | Grid: 148px of chrome before row 1; 92px of left icon columns; centred headers over left-aligned data; header heavier than data. | Header text x within 4px of the first data cell x; header weight ≤600 and lighter than cell text; row height ≥36px; non-data left columns ≤40px; separator 1px at alpha ≤0.08. |
| F5 | Transactional-filter banner: two lines of 13px bold blue, 38px tall. | Banner ≤28px at weight 400 — or absent, with a ≤8px badge on the filter button. |
| F6 | Pane split on a new record: the form gets 292px and the child pane 327px, to say "save it to create child records". | Form pane ≥60% of the available area and child pane ≤96px while unsaved; after save the child pane returns to ≥40% without a user click. |
| F7 | No page title; branding out-ranks content. Wordmark ~26px is the largest text; top bar 64px. | No top-bar text > 16px; bar ≤56px; logo ≤32px; record title ≥18px and the largest text on screen. |
| F8 | Nav icons: all 9 top-level items share one folder glyph; the rail produces two "PM" tiles; active state is blue text expanded but blue fill in the rail. | No two rail tiles share a glyph or letters; ≥7 of 9 items carry a non-folder icon; filled active background in both states; item height ≥40px; a "Search" placeholder. |
| F9 | Form section headers: 16px/700 floating text with a 50px dead gap. | Band ≥40px and non-white; chevron right edge within 32px of the card edge; collapsed-band gap ≤12px. |
| F10 | One-note typography: everything 13–14px medium; 11px UPPERCASE tracked labels; bold spent on grid headers. | ≤5 distinct font sizes across the grid and form screens; no `text-transform:uppercase` on labels longer than 3 characters; no weight 700 outside the login page. |
| F11 | Top-right cluster: a bordered pill containing already-outlined circles (7 shapes); the global `+` duplicates the toolbar's. | No enclosing bordered element; ≤5 buttons; 40×40 ±2px with ≥6px gap. |
| F12 | Yellow active-pane bar: 320px tall on the grid pane, 36px on the form status bar. | Consistent treatment; no yellow element wider than the marker width used everywhere else. |
| F13 | Login: contentless blurred gradient panel; primary `#2563EB` differs from the in-app primary; brand mismatch with the in-app top bar. | Login primary equals the in-app primary token; the panel contains at least one text or logo element; no `filter:blur` and no more than a 2-stop gradient; copyright ≤12px. |

## Explicitly not to be changed

The child-tab pill strip; the window tab strip treatment (white active tab, blue underline, rounded
top on a lavender band); the lavender **token** itself — the area it covers is the problem, not the
swatch; the recent-views chips; the login layout skeleton.

## Where this deviates from the critique

**F12.** The reviewer read the tall yellow bar as an inconsistency and asked for it to be capped at
48px. The React product it is being measured against draws exactly the same marker — a thin yellow
rule down the whole left edge of the active pane — so capping the height would move the skin away
from the reference, not towards it. What is actually inconsistent is the *width*: 4px on the grid
pane and a different treatment on the status bar. The criterion recorded in `criteria.json` is
therefore consistency of width, not a height cap, and `consistentActiveMarkerWidth` is what
`check-dom.mjs` asserts.
