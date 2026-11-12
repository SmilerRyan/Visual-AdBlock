/* Visual Ad Block - content script
 *
 * Finds elements that look like advertisements and paints a flat gray "AD"
 * box over each ad. Nothing is blocked: no request is cancelled, no tracking
 * script is disabled, no element is removed. The ad keeps loading and working
 * exactly as before - you just cannot see it (hover a box and it goes
 * translucent so you can peek behind it).
 *
 * Rules that keep the boxes honest:
 *  - A slot only gets a box while it actually shows something: the element has
 *    to be rendered (not display:none / visibility:hidden / opacity:0) and
 *    contain a visible creative or text. Empty ad shells that many sites keep
 *    in the DOM - YouTube's ad modules between ads, unfilled leaderboards -
 *    stay bare.
 *  - Nothing inside a video player (.html5-video-player / #movie_player) is
 *    ever covered, because that is where the video itself lives.
 *  - Ads that overlap or sit flush against each other are grouped into one box
 *    per cluster, and that box lists every member's DOM path and the reason it
 *    was matched.
 *  - Boxes swallow clicks. Clicking one dismisses that cluster so you can click
 *    through to whatever is underneath; the box comes back as soon as that
 *    content changes or moves. Dismissals are not persisted across reloads.
 *
 * Boxes live in a shadow root on a 0x0 host anchored at the top-left of the
 * document, so page CSS cannot restyle them and they scroll with the page
 * without work per frame. Positions are re-measured on mutations, resizes,
 * scrolls and a slow safety tick.
 */
(() => {
  'use strict';

  if (window.__visualAdBlockLoaded) return;
  window.__visualAdBlockLoaded = true;

  const HOST_ID = '__visual_ad_block_layer__';
  const MIN_W = 40;
  const MIN_H = 20;
  const TICK_MS = 350;
  const COMMIT_DELAY = 120;
  const FULL_SWEEP_EVERY = 3;
  const MAX_ELEMENTS_FOR_SWEEP = 20000;
  const CLUSTER_GAP = 8;
  const CLUSTER_GROWTH = 3;
  const MAX_CAPTION_REASONS = 4;

  /* ------------------------------------------------------------------ *
   * 1. What looks like an ad, and why
   * ------------------------------------------------------------------ */

  // Networks that only ever serve ads.
  const AD_HOSTS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    '2mdn.net',
    'amazon-adsystem.com',
    'adnxs.com',
    'adsrvr.org',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'criteo.net',
    'pubmatic.com',
    'rubiconproject.com',
    'openx.net',
    'casalemedia.com',
    'adform.net',
    'smartadserver.com',
    'adroll.com',
    'mgid.com',
    'revcontent.com',
    'zedo.com',
    'sharethrough.com',
    'teads.tv',
    'spotxchange.com',
    'yieldmo.com',
    'indexww.com',
    'sovrn.com',
    'lijit.com',
    '3lift.com',
    'bidswitch.net',
    'adsafeprotected.com',
    'moatads.com',
    'serving-sys.com',
    'flashtalking.com',
    'media.net',
    'gumgum.com',
    'aniview.com',
    'primis.tech',
    'connatix.com',
    'exoclick.com',
    'propellerads.com',
    'popads.net',
    'adcash.com',
    'onetag.com',
    'seedtag.com',
    'adpushup.com'
  ];

  // Embedded things that are definitely not ads - never cover these frames.
  const NON_AD_IFRAME_HOSTS = [
    'youtube.com',
    'youtube-nocookie.com',
    'vimeo.com',
    'dailymotion.com',
    'openstreetmap.org',
    'codepen.io',
    'jsfiddle.net',
    'spotify.com',
    'soundcloud.com',
    'twitter.com',
    'x.com',
    'instagram.com',
    'facebook.com',
    'streamable.com',
    'twitch.tv',
    'calendly.com',
    'typeform.com',
    'stripe.com',
    'paypal.com',
    'disqus.com',
    'recaptcha.net',
    'gstatic.com',
    'docs.google.com',
    'drive.google.com',
    'maps.google.com',
    'calendar.google.com',
    'accounts.google.com',
    'notion.so',
    'airtable.com',
    'figma.com',
    'miro.com',
    'canva.com'
  ];

  const AD_PATH_HINTS = ['/pagead/', '/adframe', '/adserver', '/ad_banner', 'adurl=', 'ad_type='];

  const AD_ATTRS = [
    'data-ad-slot',
    'data-ad-client',
    'data-ad-format',
    'data-ad-unit',
    'data-adunit',
    'data-ad-region',
    'data-google-query-id',
    'data-adtest',
    'data-ad'
  ];

  // Whole words inside id / class / role / aria-label, after splitting on
  // anything that is not a letter or digit. So "ad-slot" -> ad + slot, and
  // harmless words like "header", "read" or "download" never match "ad".
  const AD_WORDS = new Set([
    'ad',
    'ads',
    'adv',
    'advert',
    'adverts',
    'advertisement',
    'advertising',
    'advertiser',
    'adbox',
    'adslot',
    'adunit',
    'adwrap',
    'adwrapper',
    'adcontainer',
    'adholder',
    'adzone',
    'adbanner',
    'adspace',
    'adlabel',
    'adlayer',
    'adframe',
    'adiframe',
    'adserver',
    'adsense',
    'adchoices',
    'adsterra',
    'sponsor',
    'sponsored',
    'sponsorship',
    'taboola',
    'outbrain',
    'doubleclick',
    'dfp',
    'gpt',
    'prebid',
    'adsystem'
  ]);

  // Strong hints that also work inside CamelCase / run-together identifiers.
  const AD_SUBSTRINGS = [
    'adsbygoogle',
    'advert',
    'adsense',
    'doubleclick',
    'taboola',
    'outbrain',
    'sponsor',
    'adserver',
    'adframe',
    'div-gpt-ad',
    'google_ads'
  ];

  // Never covered on their own: text atoms, controls, media, page scaffolding.
  const SKIP_TAGS = new Set([
    'HTML',
    'BODY',
    'HEAD',
    'META',
    'LINK',
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TITLE',
    'SPAN',
    'A',
    'EM',
    'STRONG',
    'B',
    'I',
    'U',
    'S',
    'SMALL',
    'LABEL',
    'P',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'BUTTON',
    'VIDEO',
    'CANVAS',
    'svg',
    'path'
  ]);

  // Player chrome (YouTube and friends) paints video ads straight onto the
  // video surface; covering anything in there would cover the video itself.
  const PLAYER_SELECTOR = '.html5-video-player, #movie_player, .html5-video-container';

  function matchesHost(host, list) {
    for (const entry of list) {
      if (host === entry || host.endsWith('.' + entry)) return true;
    }
    return false;
  }

  function identOf(el) {
    const cls = typeof el.className === 'string' ? el.className : '';
    return (
      el.id +
      ' ' +
      cls +
      ' ' +
      (el.getAttribute('role') || '') +
      ' ' +
      (el.getAttribute('aria-label') || '')
    ).toLowerCase();
  }

  function iframeReason(el) {
    const src = (
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-lazy-src') ||
      el.getAttribute('data-original') ||
      ''
    ).trim();

    if (src && src !== 'about:blank') {
      let url = null;
      try {
        url = new URL(src, location.href);
      } catch (e) {
        url = null;
      }
      if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
        const host = url.hostname.toLowerCase();
        const path = (url.pathname + url.search).toLowerCase();
        if (matchesHost(host, AD_HOSTS)) return 'iframe from ' + host;
        const hint = AD_PATH_HINTS.find((h) => path.includes(h));
        if (hint) return 'iframe URL contains "' + hint + '"';
        if (matchesHost(host, NON_AD_IFRAME_HOSTS)) return null;
        // Any other *.google.com frame is a map / docs / recaptcha embed, not an ad.
        if (host === 'google.com' || host.endsWith('.google.com')) return null;
      }
    }

    const ident = identOf(el);
    if (/google_ads_iframe|aswift|ad_iframe|ads_iframe|ad_frame|adframe|^ad$|advertisement/.test(ident)) {
      return 'frame named like an ad slot';
    }
    return null;
  }

  function classify(el) {
    const tag = el.tagName;
    if (!tag) return null;
    if (SKIP_TAGS.has(tag)) return null;
    if (el.id === HOST_ID) return null;
    if (el.isContentEditable) return null;

    if (el.classList && el.classList.contains('adsbygoogle')) {
      return { reason: 'AdSense slot (.adsbygoogle)' };
    }
    for (const attr of AD_ATTRS) {
      if (el.hasAttribute(attr)) return { reason: 'has attribute ' + attr };
    }

    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (label === 'advertisement' || label === 'advertisements' || label === 'ads') {
      return { reason: 'aria-label="' + el.getAttribute('aria-label') + '"' };
    }

    const titleAttr = (el.getAttribute('title') || '').trim().toLowerCase();
    if (titleAttr === 'advertisement' || titleAttr === 'ad' || titleAttr === 'ads') {
      return { reason: 'title="' + el.getAttribute('title') + '"' };
    }

    if ((el.id || '').toLowerCase() === 'ad_iframe' || (el.getAttribute('name') || '').toLowerCase() === 'ad_iframe') {
      return { reason: 'frame id/name is ad_iframe' };
    }

    if (tag === 'IFRAME') {
      const reason = iframeReason(el);
      if (reason) return { reason: reason };
    }

    const ident = identOf(el);
    if (!ident.trim()) return null;

    const hint = AD_SUBSTRINGS.find((h) => ident.includes(h));
    if (hint) return { reason: 'name contains "' + hint + '"' };

    for (const token of ident.split(/[^a-z0-9]+/)) {
      if (token && AD_WORDS.has(token)) return { reason: 'name token "' + token + '"' };
    }
    return null;
  }

  function describePath(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      if (node === document.body || node === document.documentElement) break;
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
      } else {
        const cls = (typeof node.className === 'string' ? node.className : '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    const path = parts.join(' > ') || el.tagName.toLowerCase();
    return path.length > 90 ? path.slice(0, 87) + '...' : path;
  }

  /* ------------------------------------------------------------------ *
   * 2. Is it actually showing an ad right now?
   * ------------------------------------------------------------------ */

  function isRendered(el) {
    if (typeof el.checkVisibility === 'function') {
      try {
        const visible = el.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          contentVisibilityAuto: true,
          checkOpacity: true,
          checkVisibilityCSS: true
        });
        if (!visible) return false;
      } catch (e) {
        /* older signatures - fall through */
      }
    }
    return true;
  }

  // Empty ad shells (an unfilled <ins>, YouTube's ad modules between ads, a
  // collapsed slot that keeps its CSS height) must not get a box.
  function hasVisibleSurface(el) {
    if (el.tagName === 'IFRAME') {
      const src = (el.getAttribute('src') || '').trim();
      if (src && src !== 'about:blank') return true;
      try {
        const doc = el.contentDocument;
        return !!(doc && doc.body && doc.body.children.length);
      } catch (e) {
        return true;
      }
    }

    if ((el.textContent || '').trim().length > 0) return true;

    let checked = 0;
    for (const child of el.querySelectorAll('*')) {
      if (checked++ > 150) break;
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
      const r = child.getBoundingClientRect();
      if (r.width >= 8 && r.height >= 8 && isRendered(child)) return true;
    }
    return false;
  }

  function isCoverable(el) {
    if (!el.isConnected) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.closest(PLAYER_SELECTOR)) return false;

    const r = el.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H) return false;
    // A wrapper that spans nearly the whole window is page furniture, not an ad.
    if (r.width > innerWidth * 1.4 && r.height > innerHeight * 1.4) return false;
    if (!isRendered(el)) return false;
    return hasVisibleSurface(el);
  }

  /* ------------------------------------------------------------------ *
   * 3. Grouping: one box per cluster of overlapping / touching ads
   * ------------------------------------------------------------------ */

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function unionRect(a, b) {
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return {
      left,
      top,
      width: Math.max(a.left + a.width, b.left + b.width) - left,
      height: Math.max(a.top + a.height, b.top + b.height) - top
    };
  }

  function sharesArea(a, b) {
    const ax2 = a.left + a.width;
    const ay2 = a.top + a.height;
    const bx2 = b.left + b.width;
    const by2 = b.top + b.height;
    const overlapX = Math.min(ax2, bx2) - Math.max(a.left, b.left);
    const overlapY = Math.min(ay2, by2) - Math.max(a.top, b.top);
    const intersection = Math.max(0, overlapX) * Math.max(0, overlapY);
    const smaller = Math.min(a.width * a.height, b.width * b.height);
    if (intersection > 0 && smaller > 0 && intersection >= 0.4 * smaller) return true;

    // Stacked or side-by-side units with a hairline gap are the same area too.
    if (overlapX >= 0.6 * Math.min(a.width, b.width) && Math.max(a.top, b.top) - Math.min(ay2, by2) <= CLUSTER_GAP) {
      return true;
    }
    if (overlapY >= 0.6 * Math.min(a.height, b.height) && Math.max(a.left, b.left) - Math.min(ax2, bx2) <= CLUSTER_GAP) {
      return true;
    }
    return false;
  }

  function buildClusters(desired) {
    const entries = [];
    for (const [el, info] of desired) {
      const r = rectOf(el);
      if (r.width <= 0 || r.height <= 0) continue;
      entries.push({ el, info, rect: r });
    }
    // Biggest first, so a container becomes the seed of its own cluster.
    entries.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);

    const clusters = [];
    for (const entry of entries) {
      let target = null;
      for (const cluster of clusters) {
        if (!sharesArea(cluster.rect, entry.rect)) continue;
        const merged = unionRect(cluster.rect, entry.rect);
        const bigger = Math.max(
          cluster.rect.width * cluster.rect.height,
          entry.rect.width * entry.rect.height
        );
        if (bigger > 0 && merged.width * merged.height > CLUSTER_GROWTH * bigger) continue;
        target = cluster;
        break;
      }
      if (target) {
        target.members.set(entry.el, entry.info);
        target.rect = unionRect(target.rect, entry.rect);
      } else {
        clusters.push({
          primary: entry.el,
          rect: entry.rect,
          members: new Map([[entry.el, entry.info]])
        });
      }
    }
    return clusters;
  }

  /* ------------------------------------------------------------------ *
   * 4. The overlay layer
   * ------------------------------------------------------------------ */

  const STATE = {
    enabled: true,
    host: null,
    layer: null,
    clusters: new Map(), // primary element -> item
    owners: new Map(), // member element -> item
    ticker: null,
    ro: null,
    running: false
  };

  // Elements the user clicked away, with the box they had at that moment.
  // A dismissal only lasts until that ad's content moves or changes.
  const dismissed = new Map(); // element -> rect key

  const SHADOW_CSS = `
    :host { all: initial; }
    .layer {
      position: absolute;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
    }
    .box {
      position: absolute;
      display: block;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      background: #a3a3a3;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.10);
      border-radius: 2px;
      overflow: hidden;
      pointer-events: auto;
      cursor: pointer;
      -webkit-user-select: none;
      user-select: none;
      -webkit-user-drag: none;
      contain: layout style paint;
      transition: background-color 120ms ease;
    }
    /* Peek behind the cover by hovering it: fully opaque until then. */
    .box:hover { background: rgba(163, 163, 163, 0.2); }
    .box:hover .stack { opacity: 0.5; }
    .stack {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 4px 6px;
      overflow: hidden;
      text-align: center;
      transition: opacity 120ms ease;
    }
    .label {
      margin: 0;
      padding: 0;
      font-family: "Helvetica Neue", Arial, system-ui, sans-serif;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.01em;
      color: #141414;
      -webkit-font-smoothing: antialiased;
    }
    .caption {
      max-width: 100%;
      margin: 0;
      padding: 0;
      color: #232323;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.85;
    }
    .reason {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      opacity: 0.72;
    }
    .caption[hidden] { display: none; }
  `;

  function buildLayer() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText =
      'all:initial;position:absolute;left:0;top:0;width:0;height:0;' +
      'pointer-events:none;overflow:visible;z-index:2147483646;';

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    root.append(style, layer);

    document.documentElement.appendChild(host);
    STATE.host = host;
    STATE.layer = layer;
  }

  function swallow(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function captionFor(item) {
    const members = [...item.members.entries()].sort(
      (a, b) => rectArea(b[0]) - rectArea(a[0])
    );
    if (!members.length) return { path: '', reason: '' };
    const first = members[0][1];
    const path =
      members.length > 1 ? first.path + '  (+' + (members.length - 1) + ' more)' : first.path;
    const reasons = [];
    for (const [, info] of members) {
      if (!reasons.includes(info.reason)) reasons.push(info.reason);
    }
    const shown = reasons.slice(0, MAX_CAPTION_REASONS);
    const extra = reasons.length - shown.length;
    return { path, reason: shown.join(' · ') + (extra > 0 ? ' · +' + extra : '') };
  }

  function rectArea(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  function renderCaption(item) {
    const text = captionFor(item);
    if (item.sig === text.path + '|' + text.reason) return;
    item.sig = text.path + '|' + text.reason;
    item.path.textContent = text.path;
    item.reason.textContent = text.reason;

    const lines = [...item.members.values()].map((info) => info.path + '\n    ' + info.reason);
    item.box.title =
      'Advertisement\n' + lines.join('\n') + '\nClick to hide this box (it returns when the ad changes).';
    item.box.setAttribute(
      'aria-label',
      'Advertisement covered: ' + text.path + '. ' + text.reason
    );
  }

  function addItem(cluster) {
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'button');
    box.tabIndex = 0;

    const stack = document.createElement('div');
    stack.className = 'stack';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'AD';

    const path = document.createElement('div');
    path.className = 'caption path';
    const reason = document.createElement('div');
    reason.className = 'caption reason';

    stack.append(label, path, reason);
    box.appendChild(stack);

    const item = {
      primary: cluster.primary,
      box,
      label,
      path,
      reason,
      members: new Map(cluster.members),
      key: '',
      sig: ''
    };

    box.addEventListener('click', (event) => {
      swallow(event);
      dismiss(item);
    });
    for (const type of [
      'pointerdown',
      'mousedown',
      'mouseup',
      'pointerup',
      'dblclick',
      'auxclick',
      'contextmenu'
    ]) {
      box.addEventListener(type, swallow);
    }

    STATE.layer.appendChild(box);
    STATE.clusters.set(cluster.primary, item);
    for (const el of item.members.keys()) {
      STATE.owners.set(el, item);
      if (STATE.ro) {
        try {
          STATE.ro.observe(el);
        } catch (e) {
          /* ignore */
        }
      }
    }

    renderCaption(item);
    place(item);
  }

  function removeItem(item) {
    item.box.remove();
    STATE.clusters.delete(item.primary);
    for (const el of item.members.keys()) {
      if (STATE.owners.get(el) === item) STATE.owners.delete(el);
      if (STATE.ro) {
        try {
          STATE.ro.unobserve(el);
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  function removeItemsFor(el) {
    for (const item of [...STATE.clusters.values()]) {
      if (item.members.has(el)) removeItem(item);
    }
  }

  function dismiss(item) {
    for (const el of item.members.keys()) {
      dismissed.set(el, keyOfRect(el.getBoundingClientRect()));
    }
    removeItem(item);
  }

  function clearAll() {
    for (const item of [...STATE.clusters.values()]) removeItem(item);
    STATE.owners.clear();
  }

  function keyOfRect(r) {
    return (
      Math.round(r.left) +
      ',' +
      Math.round(r.top) +
      ',' +
      Math.round(r.width) +
      ',' +
      Math.round(r.height)
    );
  }

  /* ------------------------------------------------------------------ *
   * 5. Positioning - keeps every box glued to its ads
   * ------------------------------------------------------------------ */

  function unionOf(item) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    let any = false;
    for (const el of item.members.keys()) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      any = true;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    if (!any) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  function place(item) {
    const r = unionOf(item);
    if (!r) {
      if (item.key !== 'hidden') {
        item.box.style.display = 'none';
        item.key = 'hidden';
      }
      return;
    }

    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w < MIN_W || h < MIN_H) {
      if (item.key !== 'hidden') {
        item.box.style.display = 'none';
        item.key = 'hidden';
      }
      return;
    }

    const left = Math.round(r.left + window.scrollX);
    const top = Math.round(r.top + window.scrollY);
    const key = left + ',' + top + ',' + w + ',' + h;
    if (item.key === key) return;
    item.key = key;

    const style = item.box.style;
    style.display = 'block';
    style.left = left + 'px';
    style.top = top + 'px';
    style.width = w + 'px';
    style.height = h + 'px';

    const labelSize = Math.max(10, Math.min(w * 0.3, h * 0.36, 180));
    item.label.style.fontSize = labelSize.toFixed(1) + 'px';

    const showCaption = w >= 150 && h >= 70;
    item.path.hidden = !showCaption;
    item.reason.hidden = !showCaption;
    const captionSize = Math.max(8, Math.min(11, Math.round(w * 0.03)));
    item.path.style.fontSize = captionSize + 'px';
    item.reason.style.fontSize = captionSize + 'px';
  }

  // A dismissal expires as soon as its ad changes size or position.
  function pruneDismissed() {
    let changed = false;
    for (const [el, key] of [...dismissed.entries()]) {
      if (!el.isConnected) {
        dismissed.delete(el);
        continue;
      }
      if (keyOfRect(el.getBoundingClientRect()) !== key) {
        dismissed.delete(el);
        changed = true;
      }
    }
    return changed;
  }

  let syncQueued = false;
  function sync() {
    if (!STATE.running) return;
    if (STATE.host && !STATE.host.isConnected) {
      document.documentElement.appendChild(STATE.host); // page swapped the root element
    }
    let dropped = false;
    for (const item of [...STATE.clusters.values()]) {
      let alive = false;
      for (const el of item.members.keys()) {
        if (el.isConnected) {
          alive = true;
          break;
        }
      }
      if (!alive) {
        removeItem(item);
        dropped = true;
        continue;
      }
      place(item);
    }
    if (pruneDismissed()) dropped = true;
    if (dropped) scheduleCommit(0);
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      sync();
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Finding ads: scans, diffs and the reconcile step
   * ------------------------------------------------------------------ */

  const QUICK_SELECTORS = [
    'ins.adsbygoogle',
    '.adsbygoogle',
    'iframe[id*="google_ads_iframe"]',
    'iframe[id^="aswift"]',
    'iframe[name^="aswift"]',
    '[id^="div-gpt-ad"]',
    '[id^="google_ads"]',
    '[id*="taboola"]',
    '[id*="outbrain"]',
    '[data-ad-slot]',
    '[data-ad-client]',
    '[aria-label="Advertisement" i]',
    '[aria-label="advertisement" i]',
    '[title="Advertisement" i]',
    '[title="Ad" i]',
    'iframe[id="ad_iframe"]',
    'iframe[name="ad_iframe"]'
  ];

  let pending = new Map(); // element -> info
  let commitTimer = null;
  let sinceFullSweep = 0;

  function consider(el) {
    if (pending.has(el)) return;
    const info = classify(el);
    if (!info) return;
    if (!isCoverable(el)) return;
    pending.set(el, { path: describePath(el), reason: info.reason });
  }

  function sweep(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.nodeType === 1) consider(root);
    let nodes;
    try {
      nodes = root.querySelectorAll('*');
    } catch (e) {
      return;
    }
    if (nodes.length > MAX_ELEMENTS_FOR_SWEEP) return; // something went very wrong, bail out
    for (const node of nodes) consider(node);
  }

  function readQuickSelectors() {
    for (const selector of QUICK_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (e) {
        continue;
      }
      for (const node of nodes) consider(node);
    }
  }

  function reconcile(clusters) {
    const wanted = new Map(clusters.map((cluster) => [cluster.primary, cluster]));

    for (const [primary, item] of [...STATE.clusters.entries()]) {
      const cluster = wanted.get(primary);
      if (!cluster) {
        removeItem(item);
        continue;
      }
      item.members = new Map(cluster.members);
      for (const el of item.members.keys()) {
        STATE.owners.set(el, item);
        if (STATE.ro) {
          try {
            STATE.ro.observe(el);
          } catch (e) {
            /* ignore */
          }
        }
      }
      renderCaption(item);
    }

    for (const [primary, cluster] of wanted) {
      if (!STATE.clusters.has(primary)) addItem(cluster);
    }
  }

  function commit() {
    commitTimer = null;
    if (!STATE.running) return;

    pruneDismissed();
    readQuickSelectors();

    // Periodic whole-document sweep: catches ads revealed by a class or style
    // change on a parent instead of by an insertion (and empty slots that just
    // got filled).
    sinceFullSweep++;
    if (sinceFullSweep >= FULL_SWEEP_EVERY) {
      sinceFullSweep = 0;
      sweep(document.documentElement);
    }

    const found = new Map(pending);
    pending = new Map();

    // Re-check what we already cover, so a slot that emptied out or stopped
    // being an ad is released.
    for (const item of STATE.clusters.values()) {
      for (const el of item.members.keys()) {
        if (!el.isConnected) continue;
        const info = classify(el);
        if (info && isCoverable(el)) {
          found.set(el, { path: describePath(el), reason: info.reason });
        }
      }
    }

    const desired = new Map();
    for (const [el, info] of found) {
      if (!el.isConnected || !el.tagName || SKIP_TAGS.has(el.tagName)) continue;
      if (dismissed.has(el)) continue;
      if (!isCoverable(el)) continue;
      desired.set(el, info);
    }

    // An outer wrapper that merely contains a much smaller ad gives a sloppy,
    // oversized box - drop it and cover the tighter element instead.
    for (const el of [...desired.keys()]) {
      if (!desired.has(el)) continue;
      for (const other of desired.keys()) {
        if (other === el || !el.contains(other)) continue;
        const outer = rectArea(el);
        const inner = rectArea(other);
        if (outer > 0 && inner > 0 && inner < 0.5 * outer) {
          desired.delete(el);
          break;
        }
      }
    }

    reconcile(buildClusters(desired));
    sync();
  }

  function scheduleCommit(delay) {
    if (!STATE.running) return;
    if (commitTimer !== null) return;
    commitTimer = setTimeout(commit, typeof delay === 'number' ? delay : COMMIT_DELAY);
  }

  /* ------------------------------------------------------------------ *
   * 7. Watching the page
   * ------------------------------------------------------------------ */

  let observer = null;
  let resizeObserver = null;

  function undismissAround(node) {
    if (!dismissed.size) return false;
    const target = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!target) return false;
    let changed = false;
    let el = target;
    let hops = 0;
    while (el && hops < 4) {
      if (dismissed.delete(el)) changed = true;
      el = el.parentElement;
      hops++;
    }
    for (const key of [...dismissed.keys()]) {
      if (key.contains(target) && dismissed.delete(key)) changed = true;
    }
    return changed;
  }

  function onMutations(records) {
    let dirty = false;
    for (const record of records) {
      const node = record.target;
      if (node && node.nodeType === 1 && node.id === HOST_ID) continue;

      if (record.type === 'childList') {
        for (const added of record.addedNodes) {
          if (added.nodeType === 1) {
            if (added.id === HOST_ID) continue;
            sweep(added);
          }
          dirty = true;
        }
        if (record.removedNodes.length) dirty = true;
      } else if (record.type === 'attributes') {
        if (node && node.nodeType === 1) consider(node);
        dirty = true;
      }
      if (undismissAround(node)) dirty = true;
    }
    if (dirty) {
      queueSync();
      scheduleCommit();
    }
  }

  function startWatching() {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'id', 'src', 'hidden', 'data-ad-slot', 'data-ad-status']
    });

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const item = STATE.owners.get(entry.target);
        if (item) place(item);
      }
    });
    STATE.ro = resizeObserver;

    window.addEventListener('scroll', queueSync, { passive: true, capture: true });
    window.addEventListener('resize', queueSync, { passive: true });
    window.addEventListener('load', queueSync, { passive: true });

    STATE.ticker = setInterval(sync, TICK_MS);
    STATE.running = true;
  }

  function stopWatching() {
    STATE.running = false;
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    if (STATE.ticker !== null) {
      clearInterval(STATE.ticker);
      STATE.ticker = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
      STATE.ro = null;
    }
    window.removeEventListener('scroll', queueSync, { capture: true });
    window.removeEventListener('resize', queueSync);
    window.removeEventListener('load', queueSync);
    clearAll();
    if (STATE.host) {
      STATE.host.remove();
      STATE.host = null;
      STATE.layer = null;
    }
    pending = new Map();
  }

  /* ------------------------------------------------------------------ *
   * 8. On / off
   * ------------------------------------------------------------------ */

  function enable() {
    if (STATE.running) return;
    if (!STATE.host) buildLayer();
    startWatching();
    sinceFullSweep = 0;
    sweep(document.documentElement);
    scheduleCommit(0);
    queueSync();
  }

  function disable() {
    if (STATE.running) stopWatching();
  }

  function setEnabled(value) {
    STATE.enabled = !!value;
    if (STATE.enabled) enable();
    else disable();
  }

  /* ------------------------------------------------------------------ *
   * 9. Boot
   * ------------------------------------------------------------------ */

  function readPref(callback) {
    try {
      chrome.storage.sync.get({ enabled: true }, (prefs) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          callback(true);
          return;
        }
        callback(prefs && prefs.enabled !== false);
      });
    } catch (e) {
      callback(true);
    }
  }

  function boot() {
    readPref((enabled) => {
      STATE.enabled = enabled;
      if (enabled) enable();
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.enabled) return;
      setEnabled(changes.enabled.newValue !== false);
    });
  } catch (e) {
    /* extension context gone; ignore */
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return;
      if (message.type === 'vab:stats') {
        sendResponse({ enabled: STATE.enabled, count: STATE.clusters.size });
      } else if (message.type === 'vab:set-enabled') {
        setEnabled(message.enabled !== false);
        sendResponse({ ok: true, enabled: STATE.enabled, count: STATE.clusters.size });
      }
    });
  } catch (e) {
    /* ignore */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
