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

- **Fastest:** open `demo/index.html` in the browser, then reload it. If you opened it as a
  `file://` URL, enable **Allow access to file URLs** on the extension's details page first.
- **Or serve it:** `python3 -m http.server 8000` in this folder, then open
  <http://localhost:8000/demo/>. The demo has a leaderboard, a left skyscraper, in-article slots, a
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

To change the look of the box, edit `SHADOW_CSS` in `content.js` (notably `.box` background and
`.label` font).

## Known limits

- Ads drawn inside a cross-origin `<canvas>` or a raw `<video>` with no ad markup/network signature
  cannot be recognised.
- Native/sponsored posts whose containers use none of the recognised names or networks will be
  missed; add the token to `AD_WORDS` to catch them.
- Content inside a site's own shadow DOM is not scanned (the extension only walks light DOM).
- Pages the browser forbids extensions on (`chrome://`, the Web Store, other extensions' pages) get
  no boxes, and the popup will say "not available on this page".

## Files

```
manifest.json      MV3 manifest (storage permission + <all_urls> content script, all frames)
content.js         detection, overlay layer, mutation/resize tracking, popup messaging
popup.html/css/js  on/off switch, "ads covered on this page" count, reload button
icons/             16/32/48/128 px icons
demo/index.html    test page with real ad markup and add/slide/close simulations
tools/make_icons.py  regenerates the icons (python3, no dependencies)
```
