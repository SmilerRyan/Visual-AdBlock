# Visual Ad Block

A Chromium extension that finds ads on a page and paints a flat gray **AD** box over each one.

It is deliberately *not* an ad blocker in the network sense: no request is cancelled, no script is
disabled, no element is removed and no tracker is touched. The ad loads and behaves exactly as it
did before — you just cannot see it. That also means pages that pay out per impression still see the
impression, and pages that break when ads are blocked keep working.

## Install

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `visual-ad-block` folder (the one containing `manifest.json`).
4. Reload any open tabs. A gray `AD` box appears over ads; the toolbar button opens the popup with an
   on/off switch and a count of ads covered on the current page.

Chromium-based browsers all work: Chrome, Edge, Brave, Vivaldi, Opera, Arc.

## Try it

- **Fastest:** open `test-page.html` in the browser, then reload it. If you opened it as a
  `file://` URL, enable **Allow access to file URLs** on the extension's details page first.
- **Or serve it:** `python3 -m http.server 8000` in this folder, then open
  <http://localhost:8000/test-page.html/>. The test has a leaderboard, a left skyscraper, in-article slots, a
  sidebar slot, buttons to add / slide / close ads, and a control block with classes like
  `download` and `header` that must stay visible.

## How it decides what an ad is

`content.js` checks, in order:

1. **Known ad markup** — `ins.adsbygoogle`, `.adsbygoogle`, `[data-ad-slot]`, `[data-ad-client]`,
   `[data-google-query-id]`, `[id^="div-gpt-ad"]`, `google_ads_iframe` / `aswift` frames,
   `[aria-label="Advertisement"]`.
2. **Ad network iframes** — a frame whose `src` is on doubleclick, googlesyndication,
   amazon-adsystem, taboola, outbrain, criteo, pubmatic, … (see `AD_HOSTS`). Frames from YouTube,
   Vimeo, Google Maps/Docs, Spotify, Stripe, Calendly, reCAPTCHA and friends are never covered.
3. **Ad-shaped names** — `id` / `class` / `role` / `aria-label` split on non-alphanumerics and matched
   against whole ad words (`ad`, `ads`, `advert`, `ad-slot`, `ad-container`, `sponsored`, `dfp`,
   `gpt`, `taboola`, …). Because matching is on whole words, `header`, `download`, `read-more` and
   `loading` never match.
4. **Sanity filters** — at least 40×20 px, visible, not a text/button/input element, and not a
   wrapper spanning nearly the whole window. Nested candidates are collapsed so you get one box per
   ad, and a loose wrapper around several real ads loses to the ads it contains.

## How the boxes stay glued to the ads

- Boxes live in a **closed shadow root** on a 0×0 host anchored at the top-left of the document, so
  page CSS cannot restyle them and they scroll with the page without work per frame.
- A `MutationObserver` on the document, a `ResizeObserver` on every covered element, `scroll` /
  `resize` / `load` listeners and a 350 ms safety tick all re-measure the covered elements. When an
  ad moves, the box moves with it (even mid-CSS-animation); when an ad is closed or removed from the
  DOM, its box is dropped.
- If a slot stops looking like an ad (for example the site repurposes it), it gets its box removed
  on the next reconcile pass.
- Boxes are `pointer-events: none`, so they never swallow clicks; the page and the ad links keep
  working exactly as before.

## Settings and tuning

Only one setting is exposed: the on/off switch in the popup (stored in `chrome.storage.sync`). Sizes,
timings and the network lists are constants at the top of `content.js`:

| Constant | Meaning |
| --- | --- |
| `MIN_W`, `MIN_H` | smallest element that gets a box |
| `TICK_MS` | safety re-measure interval |
| `COMMIT_DELAY` | debounce for re-scanning after DOM changes |
| `AD_HOSTS` | ad-network domains used for iframe detection |
| `AD_WORDS`, `AD_SUBSTRINGS` | name tokens treated as ad markers |
A Chromium extension (Manifest V3) that finds advertisements on a page and paints
a flat gray **AD** box over each one.

To change the look of the box, edit `SHADOW_CSS` in `content.js` (notably `.box` background and
`.label` font).
It is deliberately **not** an ad blocker in the network sense. No request is
cancelled, no script is disabled, no element is removed, no tracker is touched.
The ad loads and behaves exactly as it did before - you simply cannot see it.
Consequences of that design:

## Known limits
- Sites that pay per impression still register the impression.
- Sites that break when ads are blocked keep working normally.
- No filter lists to maintain and no network permission needed - the extension
  only requests the `storage` permission.

- Ads drawn inside a cross-origin `<canvas>` or a raw `<video>` with no ad markup/network signature
  cannot be recognised.
- Native/sponsored posts whose containers use none of the recognised names or networks will be
  missed; add the token to `AD_WORDS` to catch them.
- Content inside a site's own shadow DOM is not scanned (the extension only walks light DOM).
- Pages the browser forbids extensions on (`chrome://`, the Web Store, other extensions' pages) get
  no boxes, and the popup will say "not available on this page".
Hovering a box makes it translucent so you can peek at the ad underneath.
Clicking a box dismisses it until that ad changes or moves.

## Files

```
manifest.json      MV3 manifest (storage permission + <all_urls> content script, all frames)
content.js         detection, overlay layer, mutation/resize tracking, popup messaging
popup.html/css/js  on/off switch, "ads covered on this page" count, reload button
icons/             16/32/48/128 px icons
test-page.html    test page with real ad markup and add/slide/close simulations
tools/make_icons.py  regenerates the icons (python3, no dependencies)
```
| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `storage` only. Content script runs at `document_idle` in all frames. |
| `content.js` | The whole engine: ad detection, clustering, overlay rendering, positioning, messaging. |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup: on/off toggle, covered-ad count for the active tab, reload button. |
| `test-page.html` | Local test page with realistic ad slots plus false-positive traps (`download`, `header` blocks that must stay uncovered). |
| `test-sites.txt` | Live sites that exercise each detection path. |
| `tests/` | Playwright test harness (`npm install`, then `node test.js` inside the folder). |
| `tools/make_icons.py` | Regenerates the PNG icons in `icons/`. |

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, ...).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Reload open tabs. Gray **AD** boxes appear over detected ads.

Works in any Chromium browser: Chrome, Edge, Brave, Vivaldi, Opera, Arc.
For `file://` pages (like the bundled test page), enable
**Allow access to file URLs** on the extension's details page.

## How ad detection works

`content.js` classifies every candidate element in this order:

1. **Known ad markup** - `ins.adsbygoogle`, `[data-ad-slot]`,
   `[data-ad-client]`, `[data-google-query-id]`, `[id^="div-gpt-ad"]`,
   `google_ads_iframe` / `aswift` frames, `[aria-label="Advertisement"]`.
2. **Ad network iframes** - the frame's `src` hostname is checked against
   `AD_HOSTS` (doubleclick, googlesyndication, taboola, outbrain, criteo,
   pubmatic, and about 40 more). Frames from YouTube, Vimeo, Google Maps/Docs,
   Spotify, Stripe, Calendly, reCAPTCHA and friends are whitelisted in
   `NON_AD_IFRAME_HOSTS` and never covered.
3. **Ad-shaped names** - `id`, `class`, `role` and `aria-label` are split on
   non-alphanumerics and matched against whole ad words (`ad`, `ads`,
   `advert`, `sponsor`, `dfp`, `gpt`, ...). Because matching is whole-word,
   `header`, `download`, `read-more` and `loading` never trigger a false
   positive. A small substring list catches run-together names such as
   `adsbygoogle` and `div-gpt-ad`.
4. **Sanity filters** - a candidate must be at least 40x20 px, rendered
   (checked with `checkVisibility` including opacity and visibility), must not
   be a text/control/media element, must not sit inside a video player
   (`.html5-video-player`, `#movie_player`), and must not span nearly the
   whole window. It must also actually show something: empty ad shells that
   sites keep in the DOM stay bare.

## How the overlay works

- All boxes live inside a shadow root on a 0x0 host div pinned to the top-left
  of `documentElement` with maximum z-index. Page CSS cannot restyle them, and
  they scroll with the page with no per-frame work.
- Overlapping or touching ads merge into one box per **cluster**, with a growth
  cap so unrelated ads never chain into one giant box. Each box captions the
  DOM path of its largest member and every reason it was matched.
- Positions are re-measured on DOM mutations, element resizes, scrolls, and a
  350 ms safety tick. A dismissal expires the moment its ad changes size or
  position.

## Known limitations

- **Cross-origin iframes**: `contentDocument` is unreadable for cross-origin
  frames, so an unfilled cross-origin ad frame may keep its box. Assuming
  emptiness from the outside would risk hiding real content, so this is a
  deliberate trade-off.
- **Large pages**: full DOM sweeps are capped at 20,000 elements per root;
  above that only the quick-selector pass runs, so heuristically-named ads may
  be missed on extremely large documents.
- Dismissals are intentionally not persisted across reloads.

## Changelog

### 1.0.1
- Documentation overhaul: detailed README (file map, detection pipeline,
  overlay architecture, limitations).
- Expanded inline comments on tuning constants and the cross-origin fallback.
- Screenshot gallery removed from the shipped popup; package no longer
  includes `screenshots/` or `.git`.

### 1.0.0
- Initial release.
