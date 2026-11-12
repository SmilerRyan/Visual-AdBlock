/* Visual Ad Block - popup */
'use strict';

const toggle = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const countLabel = document.getElementById('count-label');
const reloadBtn = document.getElementById('reload');

let tabId = null;

function sendToTab(message) {
  if (tabId === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response || null);
    });
  });
}

function renderStats(stats) {
  if (!stats) {
    countEl.textContent = '–';
    countLabel.textContent = 'not available on this page';
    return;
  }
  const n = stats.count || 0;
  countEl.textContent = String(n);
  countLabel.textContent = n === 1 ? 'ad covered on this page' : 'ads covered on this page';
}

function renderEnabled(enabled) {
  toggle.checked = enabled;
  statusEl.textContent = enabled ? 'Covering ads' : 'Turned off';
}

async function refresh() {
  const stats = await sendToTab({ type: 'vab:stats' });
  renderStats(stats);
}

async function init() {
  const prefs = await chrome.storage.sync.get({ enabled: true });
  renderEnabled(prefs.enabled !== false);

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== 'number') {
    renderStats(null);
    return;
  }
  tabId = tab.id;

  // Frames each keep their own count, so ask again shortly after a toggle.
  refresh();
  setTimeout(refresh, 400);
}

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  renderEnabled(enabled);
  await chrome.storage.sync.set({ enabled });
  const stats = await sendToTab({ type: 'vab:set-enabled', enabled });
  renderStats(stats);
});

reloadBtn.addEventListener('click', () => {
  if (tabId === null) return;
  chrome.tabs.reload(tabId);
  window.close();
});

init();
