# Visual AdBlock

A Chromium extension (Manifest V3) that finds advertisements on a page and paints a flat gray **AD** box over each one. It is deliberately **not** an ad blocker in the network sense: no request is cancelled, no script is disabled, no element is removed and no tracker is touched. The ad loads and behaves exactly as it did before - you simply cannot see it.

Consequences of that design:

- Sites that pay per impression still register the impression.
- Sites that break when ads are blocked keep working normally.
- No filter lists to maintain and no network permission needed - the extension only requests the `storage` permission.

## Features

- Detects AdSense/GPT slots, ad-network iframes (40+ domains) and ad-shaped `id`/`class` names, with whole-word matching so `header`, `download` and `read-more` never trigger it.
- One box per cluster of overlapping/touching ads; nested wrappers collapse to the tightest box.
- Boxes track their ads live: DOM mutations, element resizes, scrolls and a 350 ms safety tick all re-measure, so a moving or resizing ad keeps its box glued on.
- Hover a box to peek behind it (goes translucent); click one to dismiss it until the ad changes size or position.
- Popup shows an on/off switch (synced via `chrome.storage.sync`) and how many ads are covered on the current page.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, ...).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Reload open tabs. Gray **AD** boxes appear over detected ads.

Works in any Chromium browser: Chrome, Edge, Brave, Vivaldi, Opera, Arc.
For `file://` pages (like the bundled test page), enable **Allow access to file URLs** on the extension details page.

## Quick test

Open `test-page.html`, then reload it. It contains realistic ad slots (leaderboard, skyscraper, in-article, sidebar) plus false-positive traps (`download`, `header` blocks that must stay uncovered) and buttons to add / slide / close ads live. Or serve it: `python3 -m http.server 8000`, then open http://localhost:8000/test-page.html/.

## How ad detection works

`content.js` classifies every candidate element in this order:

1. **Known ad markup** - `ins.adsbygoogle`, `[data-ad-slot]`, `[data-ad-client]`, `[data-google-query-id]`, `[id^="div-gpt-ad"]`, `google_ads_iframe` / `aswift` frames, `[aria-label="Advertisement"]`.
2. **Ad network iframes** - the frame src hostname is checked against `AD_HOSTS` (doubleclick, googlesyndication, taboola, outbrain, criteo, pubmatic and about 40 more). Frames from YouTube, Vimeo, Google Maps/Docs, Spotify, Stripe, Calendly, reCAPTCHA and friends are whitelisted in `NON_AD_IFRAME_HOSTS` and never covered.
3. **Ad-shaped names** - `id`, `class`, `role` and `aria-label` are split on non-alphanumerics and matched against whole ad words (`ad`, `ads`, `advert`, `sponsor`, `dfp`, `gpt`, ...). A small substring list catches run-together names such as `adsbygoogle` and `div-gpt-ad`.
4. **Sanity filters** - a candidate must be at least 40x20 px, rendered (checked with `checkVisibility`), must not be a text/control/media element, must not sit inside a video player, must not span nearly the whole window, and must actually show something: empty ad shells that sites keep in the DOM stay bare.

## How the overlay works

- All boxes live inside a shadow root on a 0x0 host div pinned to the top-left of `documentElement` with maximum z-index. Page CSS cannot restyle them, and they scroll with the page with no per-frame work.
- Clicks land on the box itself only, so the page and ad links keep working everywhere else.
- Positions are re-measured on DOM mutations, element resizes, scrolls and a 350 ms safety tick. A dismissal expires the moment its ad changes size or position.

## Tuning

Only one setting is exposed: the on/off switch in the popup (stored in `chrome.storage.sync`). Everything else is a constant at the top of `content.js`:

| Constant | Meaning |
| --- | --- |
| `MIN_W`, `MIN_H` | smallest element that gets a box |
| `TICK_MS` | safety re-measure interval |
| `COMMIT_DELAY` | debounce for re-scanning after DOM changes |
| `MAX_ELEMENTS_FOR_SWEEP` | full-DOM-sweep cap before falling back to quick selectors |
| `AD_HOSTS` | ad-network domains used for iframe detection |
| `AD_WORDS`, `AD_SUBSTRINGS` | name tokens treated as ad markers |

To change the look of the box, edit `SHADOW_CSS` in `content.js`.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `storage` only. Content script runs at `document_idle` in all frames. |
| `content.js` | The whole engine: ad detection, clustering, overlay rendering, positioning, messaging. |
| `popup.html` / `popup.css` / `popup.js` | Toolbar popup: on/off toggle, covered-ad count for the active tab, reload button. |
| `test-page.html` | Local test page with realistic ad slots plus false-positive traps. |
| `test-sites.txt` | Live sites that exercise each detection path. |
| `tests/` | Playwright screenshot/test harness (`npm install`, then `node test.js` inside the folder). |
| `tools/make_icons.py` | Regenerates the PNG icons in `icons/` (Python 3, no dependencies). |

## Known limitations

- Ads drawn inside a cross-origin `<canvas>` or a raw `<video>` with no ad markup or network signature cannot be recognised.
- Native/sponsored posts whose containers use none of the recognised names or networks will be missed; add the token to `AD_WORDS` to catch them.
- Content inside a site own shadow DOM is not scanned (only light DOM is walked).
- `contentDocument` is unreadable for cross-origin frames, so an unfilled cross-origin ad frame may keep its box. Assuming emptiness from the outside would risk hiding real content, so this is a deliberate trade-off.
- Full DOM sweeps are capped at 20,000 elements per root; above that only the quick-selector pass runs, so heuristically-named ads may be missed on extremely large documents.
- Pages the browser forbids extensions on (`chrome://`, the Web Store, other extensions pages) get no boxes, and the popup says "not available on this page".
- Dismissals are intentionally not persisted across reloads.

## Changelog

### 1.0.2
- Documentation overhaul: rewritten, consolidated README (features, file map, detection pipeline, overlay architecture, tuning table, limitations).
- Removed leftover unused `.gallery` styles from `popup.css`.
- Version bumped in manifest and popup footer.

### 1.0.1
- Screenshot gallery removed from the shipped popup.

### 1.0.0
- Initial release.
