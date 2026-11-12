/* Real-Chromium check for Visual Ad Block.
 *
 * Loads the extension into Chromium, opens the test page, verifies the overlay
 * against the live layout and refreshes the screenshots used by the popup.
 *
 *   cd visual-ad-block/tests && npm install && node shots.js
 *   node shots.js --youtube     # also smoke-test a real YouTube watch page
 *
 * Chromium needs system libraries this container may not ship. If the launch
 * fails with missing .so files, run `python3 fetch_libs.py` first and keep the
 * printed LD_LIBRARY_PATH (the script picks up /tmp/alibs automatically).
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const WITH_YOUTUBE = process.argv.includes('--youtube');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE_FN = () => {
  const host = document.getElementById('__visual_ad_block_layer__');
  if (!host || !host.shadowRoot) return { host: false, boxes: [], aligned: {} };
  const boxes = Array.from(host.shadowRoot.querySelectorAll('.box')).map((b) => {
    const r = b.getBoundingClientRect();
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      path: (b.querySelector('.path') || {}).textContent || '',
      reason: (b.querySelector('.reason') || {}).textContent || '',
      label: (b.querySelector('.label') || {}).textContent || '',
      pointerEvents: getComputedStyle(b).pointerEvents,
      background: getComputedStyle(b).backgroundColor
    };
  });
  const ads = {
    banner: document.getElementById('top-banner'),
    inArticle: document.getElementById('div-gpt-ad-1234567890-0'),
    native: document.getElementById('native-ad'),
    sidebar: document.getElementById('sidebar-ad'),
    sidebar2: document.getElementById('div-gpt-ad-sidebar-2'),
    sticky: document.getElementById('sticky-ad'),
    skyscraper: document.querySelector('ins.adsbygoogle')
  };
  const aligned = {};
  for (const [name, el] of Object.entries(ads)) {
    if (!el) {
      aligned[name] = 'missing';
      continue;
    }
    const r = el.getBoundingClientRect();
    const hit = boxes.find(
      (b) =>
        b.rect[0] <= r.left + 2 &&
        b.rect[1] <= r.top + 2 &&
        b.rect[0] + b.rect[2] >= r.right - 2 &&
        b.rect[1] + b.rect[3] >= r.bottom - 2
    );
    aligned[name] = hit ? 'aligned' : 'MISALIGNED';
  }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const overlap = (b, r) =>
    b.rect[0] < r.right && b.rect[0] + b.rect[2] > r.left && b.rect[1] < r.bottom && b.rect[1] + b.rect[3] > r.top;
  const plain = rectOf(document.querySelector('.plain-block'));
  const empty = rectOf(document.getElementById('empty-ad-slot'));
  return {
    host: true,
    boxes,
    aligned,
    plainCovered: boxes.some((b) => overlap(b, plain)),
    emptyCovered: boxes.some((b) => overlap(b, empty))
  };
};

const state = (page) => page.evaluate(STATE_FN);

const hitAt = (page, x, y) =>
  page.evaluate(
    ([hx, hy]) => {
      const el = document.elementFromPoint(hx, hy);
      return el ? el.id || el.tagName : 'none';
    },
    [x, y]
  );

(async () => {
  await new Promise((resolve) => server.listen(8123, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:8123/test-page.html';

  const baseEnv = { ...process.env };
  const localLibs = '/tmp/alibs/root/usr/lib/x86_64-linux-gnu';
  if (fs.existsSync(localLibs)) {
    baseEnv.LD_LIBRARY_PATH = [localLibs, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');
  }

  const launch = (withExtension) =>
    chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      env: baseEnv,
      viewport: { width: 1400, height: 900 },
      args: withExtension
        ? [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-first-run']
        : ['--no-first-run']
    });

  const ctx = await launch(true);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(url, { waitUntil: 'load' });
  await sleep(1000);

  const first = await state(page);
  console.log('initial boxes:', first.boxes.length);
  console.log(first.boxes.map((b) => b.label + ' | ' + b.path + ' | ' + b.reason).join('\n'));

  await page.screenshot({ path: path.join(OUT, 'cover-on-viewport.png') });
  await page.screenshot({ path: path.join(OUT, 'cover-on-full.png'), fullPage: true });

  const pointOf = (sel) =>
    page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    }, sel);

  const bannerPoint = await pointOf('#top-banner');
  const clickedElement = await hitAt(page, bannerPoint[0], bannerPoint[1]);

  // Hovering a cover lets the ad show through (fully opaque otherwise).
  const skyPoint = await pointOf('ins.adsbygoogle');
  await page.mouse.move(skyPoint[0], skyPoint[1]);
  await sleep(350);
  const hoverBackgrounds = await page.evaluate(() => {
    const host = document.getElementById('__visual_ad_block_layer__');
    return Array.from(host.shadowRoot.querySelectorAll('.box')).map(
      (b) => getComputedStyle(b).backgroundColor
    );
  });
  await page.screenshot({ path: path.join(OUT, 'cover-on-hover.png') });

  // Click a cover: it disappears and the click goes through from then on.
  await page.mouse.click(bannerPoint[0], bannerPoint[1]);
  await sleep(500);
  const afterClick = await state(page);
  const clickedAfterDismiss = await hitAt(page, bannerPoint[0], bannerPoint[1]);
  await page.screenshot({ path: path.join(OUT, 'cover-after-click.png') });

  // ... and it returns as soon as that ad moves.
  await page.evaluate(() => {
    document.getElementById('top-banner').style.marginLeft = '40px';
  });
  await sleep(800);
  const afterMove = await state(page);

  // Reload clears dismissals.
  await page.reload({ waitUntil: 'load' });
  await sleep(1000);
  const afterReload = await state(page);

  await page.click('button[data-action="add"]');
  await sleep(450);
  const afterAdd = await state(page);

  await page.click('button[data-action="empty"]');
  await sleep(600);
  const afterEmpty = await state(page);
  await page.screenshot({ path: path.join(OUT, 'cover-after-empty-slot.png') });

  await page.click('button[data-action="slide"]');
  await sleep(700);
  const during = await page.evaluate(() => {
    const el = document.getElementById('div-gpt-ad-1234567890-0');
    const host = document.getElementById('__visual_ad_block_layer__');
    const boxes = Array.from(host.shadowRoot.querySelectorAll('.box'));
    const r = el.getBoundingClientRect();
    const b = boxes.find((x) => Math.abs(x.getBoundingClientRect().height - r.height) < 2);
    return { adLeft: Math.round(r.left), boxLeft: b ? Math.round(b.getBoundingClientRect().left) : null };
  });
  await sleep(1400);

  // Popup thumbnails: a small crop of the in-article ad, with and without the cover.
  await page.reload({ waitUntil: 'load' });
  await sleep(900);
  const clip = await page.evaluate(() => {
    const el = document.getElementById('div-gpt-ad-1234567890-0');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - 36),
      y: Math.max(0, r.top - 36),
      width: r.width + 72,
      height: r.height + 72
    };
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'popup-after.png'), clip });

  let youtube = { skipped: true };
  if (WITH_YOUTUBE) {
    const yt = await ctx.newPage();
    try {
      await yt.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ', {
        waitUntil: 'domcontentloaded',
        timeout: 40000
      });
      await sleep(4000);
      youtube = await yt.evaluate(() => {
        const host = document.getElementById('__visual_ad_block_layer__');
        const boxes = host && host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll('.box')) : [];
        const rects = boxes.map((b) => {
          const r = b.getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        });
        const overlaps = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          return rects.some(
            (b) => b[0] < r.right && b[0] + b[2] > r.left && b[1] < r.bottom && b[1] + b[3] > r.top
          );
        };
        return {
          skipped: false,
          boxCount: rects.length,
          coversVideo: overlaps(document.querySelector('video')),
          coversPlayer: overlaps(document.querySelector('#movie_player, .html5-video-player'))
        };
      });
      await yt.screenshot({ path: path.join(OUT, 'youtube-player.png') });
    } catch (err) {
      youtube = { skipped: false, error: String(err).slice(0, 160) };
    }
    await yt.close();
  }

  // Baseline: same page, no extension.
  const plainCtx = await launch(false);
  const plainPage = await plainCtx.newPage();
  await plainPage.goto(url, { waitUntil: 'load' });
  await sleep(700);
  await plainPage.screenshot({ path: path.join(OUT, 'cover-off-viewport.png') });
  const plainClip = await plainPage.evaluate(() => {
    const el = document.getElementById('div-gpt-ad-1234567890-0');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - 36),
      y: Math.max(0, r.top - 36),
      width: r.width + 72,
      height: r.height + 72
    };
  });
  await sleep(300);
  await plainPage.screenshot({ path: path.join(OUT, 'popup-before.png'), clip: plainClip });
  await plainCtx.close();

  const report = {
    extensionLayerPresent: first.host,
    boxCount: first.boxes.length,
    aligned: first.aligned,
    plainBlockCovered: first.plainCovered,
    emptySlotCovered: first.emptyCovered,
    captionExample: first.boxes[0] ? first.boxes[0].path + ' / ' + first.boxes[0].reason : null,
    opaqueWhenIdle: first.boxes.every((b) => /rgb\(163, 163, 163\)/.test(b.background)),
    hoverBackgrounds,
    pointerEvents: first.boxes[0] ? first.boxes[0].pointerEvents : null,
    clickedElement,
    boxesAfterClick: afterClick.boxes.length,
    clickedElementAfterDismiss: clickedAfterDismiss,
    boxesAfterMove: afterMove.boxes.length,
    boxesAfterReload: afterReload.boxes.length,
    boxesAfterAdd: afterAdd.boxes.length,
    boxesAfterEmptyingSlot: afterEmpty.boxes.length,
    slideTracked: during.boxLeft !== null && Math.abs(during.boxLeft - during.adLeft) <= 3,
    youtube,
    errors
  };
  console.log('\nREPORT\n' + JSON.stringify(report, null, 1));

  await ctx.close();
  server.close();

  const ok =
    report.extensionLayerPresent &&
    report.boxCount === 6 &&
    Object.values(report.aligned).every((v) => v === 'aligned') &&
    report.plainBlockCovered === false &&
    report.emptySlotCovered === false &&
    report.opaqueWhenIdle &&
    report.hoverBackgrounds.some((c) => /0\.2\)/.test(c)) &&
    report.pointerEvents === 'auto' &&
    report.clickedElement === '__visual_ad_block_layer__' &&
    report.clickedElementAfterDismiss !== '__visual_ad_block_layer__' &&
    report.boxesAfterClick === 5 &&
    report.boxesAfterMove === 6 &&
    report.boxesAfterReload === 6 &&
    report.boxesAfterAdd === 7 &&
    report.boxesAfterEmptyingSlot === 6 &&
    report.slideTracked &&
    (report.youtube.skipped || report.youtube.error || (!report.youtube.coversVideo && !report.youtube.coversPlayer));
  console.log(ok ? '\nBROWSER CHECK: PASS' : '\nBROWSER CHECK: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('harness error:', err);
  server.close();
  process.exit(1);
});
