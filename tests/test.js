/* Headless checks for Visual Ad Block: runs content.js inside jsdom against the
 * test page (with stubbed layout, since jsdom has none).
 *   node .harness/test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'test-page.html'), 'utf8');
const source = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost/test-page.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
const { document } = window;

/* ---------- assertions ---------- */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
}

/* ---------- stubbed layout ---------- */
const rects = new WeakMap();
function setRect(el, left, top, width, height) {
  rects.set(el, { left, top, width, height });
}
function inlineSize(el) {
  const style = el.getAttribute && el.getAttribute('style');
  if (!style) return null;
  const w = /(?:^|;)\s*width\s*:\s*([\d.]+)px/.exec(style);
  const h = /(?:^|;)\s*height\s*:\s*([\d.]+)px/.exec(style);
  if (!w || !h) return null;
  return { width: parseFloat(w[1]), height: parseFloat(h[1]) };
}
window.Element.prototype.getBoundingClientRect = function () {
  let r = rects.get(this);
  if (!r) {
    const size = inlineSize(this);
    r = size
      ? { left: 0, top: 0, width: size.width, height: size.height }
      : { left: 0, top: 0, width: 0, height: 0 };
    rects.set(this, r);
  }
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top
  };
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;

/* ---------- stubbed extension APIs ---------- */
let messageListeners = [];
window.chrome = {
  storage: {
    sync: { get: (defaults, cb) => cb(defaults) },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    lastError: null,
    onMessage: { addListener: (fn) => messageListeners.push(fn) }
  }
};
window.scrollX = 0;
window.scrollY = 0;

/* ---------- the ad slots in the test page, with fake geometry ---------- */
const skyscraper = document.querySelector('ins.adsbygoogle');
const banner = document.getElementById('top-banner');
const inArticle = document.getElementById('div-gpt-ad-1234567890-0');
const nativeAd = document.getElementById('native-ad');
const sidebarAd = document.getElementById('sidebar-ad');
const sidebarAd2 = document.getElementById('div-gpt-ad-sidebar-2');
const stickyAd = document.getElementById('sticky-ad');
const emptySlot = document.getElementById('empty-ad-slot');
const plainBlock = document.querySelector('.plain-block');

setRect(skyscraper, 20, 200, 120, 600);
setRect(banner, 100, 40, 728, 90);
setRect(inArticle, 120, 900, 336, 280);
setRect(nativeAd, 120, 1300, 300, 250);
setRect(sidebarAd, 900, 210, 300, 250);
setRect(sidebarAd2, 900, 460, 300, 250);
setRect(stickyAd, 900, 760, 300, 600);
setRect(emptySlot, 900, 1400, 300, 250);
setRect(plainBlock, 120, 1700, 600, 200);

/* ---------- run the extension ---------- */
window.eval(source);

const host = () => document.getElementById('__visual_ad_block_layer__');
const shadowStyle = () => (host() && host().shadowRoot ? host().shadowRoot.querySelector('style').textContent : '');
const boxes = () => {
  const el = host();
  if (!el || !el.shadowRoot) return [];
  return Array.from(el.shadowRoot.querySelectorAll('.box'));
};
const boxAt = (left, top, width, height) =>
  boxes().find(
    (b) =>
      b.style.left === left + 'px' &&
      b.style.top === top + 'px' &&
      b.style.width === width + 'px' &&
      b.style.height === height + 'px'
  );
const overlapped = (el) => {
  const r = el.getBoundingClientRect();
  return boxes().some(
    (b) =>
      parseInt(b.style.left, 10) < r.left + r.width &&
      parseInt(b.style.left, 10) + parseInt(b.style.width, 10) > r.left &&
      parseInt(b.style.top, 10) < r.top + r.height &&
      parseInt(b.style.top, 10) + parseInt(b.style.height, 10) > r.top
  );
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await wait(200);

  check('overlay layer is injected', !!host());
  check('one box per filled ad area (6)', boxes().length === 6, 'got ' + boxes().length);
  check(
    'box matches the leaderboard geometry',
    !!boxAt(100, 40, 728, 90),
    boxes().map((b) => b.style.cssText).join(' | ')
  );
  check('box matches the skyscraper geometry', !!boxAt(20, 200, 120, 600));
  check('box matches the in-article geometry', !!boxAt(120, 900, 336, 280));

  // Two flush sidebar ads are one area, so they share one box.
  const cluster = boxAt(900, 210, 300, 500);
  check('stacked ads are grouped into one box', !!cluster, boxes().map((b) => b.style.cssText).join(' | '));
  check(
    'the cluster lists every member path',
    cluster && /\(\+1 more\)/.test(cluster.querySelector('.path').textContent),
    cluster && cluster.querySelector('.path').textContent
  );
  check(
    'the cluster lists every reason',
    cluster &&
      /data-ad-client/.test(cluster.querySelector('.reason').textContent) &&
      /div-gpt-ad/.test(cluster.querySelector('.reason').textContent),
    cluster && cluster.querySelector('.reason').textContent
  );

  // Empty slot with an ad-ish class and a real width/height: no creative inside,
  // so no box (this is the YouTube "ad slot that is not showing an ad" case).
  check('empty ad slot stays bare', !overlapped(emptySlot), boxes().length + ' boxes');
  check('plain content block stays visible', !overlapped(plainBlock));

  // Every box is labelled with the DOM path and how it was found.
  const bannerBox = boxAt(100, 40, 728, 90);
  check(
    'box shows "AD" plus the ad path',
    bannerBox &&
      bannerBox.querySelector('.label').textContent === 'AD' &&
      bannerBox.querySelector('.path').textContent.includes('top-banner'),
    bannerBox && bannerBox.querySelector('.path').textContent
  );
  check(
    'box shows how the ad was found',
    bannerBox && bannerBox.querySelector('.reason').textContent.includes('data-ad-slot'),
    bannerBox && bannerBox.querySelector('.reason').textContent
  );
  check(
    'boxes are clickable, not click-through',
    /\.box\s*\{[^}]*pointer-events:\s*auto/.test(shadowStyle())
  );
  check(
    'cover is fully opaque until hovered',
    /\.box\s*\{[^}]*background:\s*#a3a3a3/.test(shadowStyle())
  );
  check(
    'hover makes the cover see-through',
    /\.box:hover\s*\{[^}]*rgba\(163, 163, 163, 0\.2\)/.test(shadowStyle())
  );

  const downloadish = document.createElement('div');
  downloadish.className = 'download-panel header read-more';
  downloadish.textContent = 'not an ad';
  document.querySelector('.article').appendChild(downloadish);
  setRect(downloadish, 120, 2000, 600, 120);
  await wait(200);
  check('names like download/header/read-more are ignored', !overlapped(downloadish));

  // Moving an ad without touching the DOM: the slow safety tick must catch up.
  setRect(inArticle, 400, 1500, 336, 280);
  await wait(700);
  check(
    'box follows an ad that moved',
    !!boxAt(400, 1500, 336, 280),
    boxes().map((b) => b.style.left + ',' + b.style.top).join(' ')
  );

  // An ad slot that goes empty (ad finished) drops its box, keeping its size.
  const creative = inArticle.innerHTML;
  inArticle.innerHTML = '';
  await wait(400);
  check('box disappears when the slot empties', boxes().length === 5, 'got ' + boxes().length);
  inArticle.innerHTML = creative;
  await wait(300);
  check('box returns when the slot fills again', boxes().length === 6, 'got ' + boxes().length);

  // Closing / removing an ad drops its box.
  stickyAd.remove();
  await wait(250);
  check('box disappears with a removed ad', boxes().length === 5, 'got ' + boxes().length);

  // A late-loaded ad gets a box.
  const late = document.createElement('div');
  late.id = 'div-gpt-ad-dynamic-1';
  late.setAttribute('style', 'display:block;width:300px;height:250px');
  late.textContent = 'late ad';
  setRect(late, 120, 2300, 300, 250);
  document.querySelector('.article').insertBefore(late, document.querySelector('.article p'));
  await wait(250);
  check('late-loaded ad gets a box', boxes().length === 6 && !!boxAt(120, 2300, 300, 250));

  // Nested slot inside a wrapper: exactly one box, on the wrapper.
  const wrapper = document.createElement('div');
  wrapper.className = 'ad-container';
  wrapper.setAttribute('style', 'display:block;width:300px;height:320px');
  const inner = document.createElement('ins');
  inner.className = 'adsbygoogle';
  inner.setAttribute('style', 'display:block;width:300px;height:250px');
  wrapper.appendChild(inner);
  document.querySelector('.article').appendChild(wrapper);
  setRect(wrapper, 500, 2600, 300, 320);
  setRect(inner, 500, 2600, 300, 250);
  await wait(300);
  check(
    'nested slot yields a single box on the wrapper',
    boxes().length === 7 && !!boxAt(500, 2600, 300, 320),
    'count ' + boxes().length
  );

  // Iframe classification.
  const youtube = document.createElement('iframe');
  youtube.setAttribute('src', 'https://www.youtube.com/embed/abc123');
  youtube.setAttribute('style', 'display:block;width:640px;height:360px');
  document.querySelector('.article').appendChild(youtube);
  setRect(youtube, 0, 3050, 640, 360);
  await wait(300);
  check('youtube embed is not covered', boxes().length === 7, 'got ' + boxes().length);

  const adFrame = document.createElement('iframe');
  adFrame.setAttribute('src', 'https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-1');
  adFrame.setAttribute('style', 'display:block;width:300px;height:250px');
  document.querySelector('.article').appendChild(adFrame);
  setRect(adFrame, 0, 3450, 300, 250);
  await wait(300);
  check(
    'doubleclick iframe is covered',
    boxes().length === 8 && !!boxAt(0, 3450, 300, 250),
    'got ' + boxes().length
  );

  // Popup stats + toggle round trip.
  const stats = await new Promise((resolve) =>
    messageListeners[0]({ type: 'vab:stats' }, null, resolve)
  );
  check('stats message reports 8 areas', stats && stats.count === 8, JSON.stringify(stats));

  // Clicking a box dismisses only that box; it stays away until its content moves.
  const target = boxAt(100, 40, 728, 90);
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(150);
  check('clicking a box removes it', boxes().length === 7, 'got ' + boxes().length);
  await wait(700);
  check('dismissed box stays away while nothing changes', boxes().length === 7, 'got ' + boxes().length);
  check('the other boxes are untouched', !!boxAt(20, 200, 120, 600));

  // ... and comes back as soon as the ad moves.
  setRect(banner, 100, 60, 728, 90);
  await wait(800);
  check(
    'overlay returns when the ad moves',
    boxes().length === 8 && !!boxAt(100, 60, 728, 90),
    'got ' + boxes().length
  );

  messageListeners[0]({ type: 'vab:set-enabled', enabled: false }, null, () => {});
  await wait(150);
  check('turning it off removes the layer', !host());

  messageListeners[0]({ type: 'vab:set-enabled', enabled: true }, null, () => {});
  await wait(400);
  check('turning it back on restores the boxes', boxes().length === 8, 'got ' + boxes().length);

  /* ---------- report ---------- */
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok || !r.detail ? '' : '  -> ' + r.detail));
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})();
