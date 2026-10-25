(() => {
  'use strict';
  const KEY = 'nexusFeedBatch';
  let enabled = true, batchSize = 7, visibleCount = 7, scheduled = false, currentRoot = null, button = null;
  const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer';
  const isFeedCard = (el, root) => el instanceof HTMLElement && el.closest('#contents') === root && !el.closest('ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer, #related');
  function getRoot() {
    const candidates = [
      document.querySelector('ytd-browse[page-subtype="home"] #contents'),
      document.querySelector('ytd-search #contents'),
      document.querySelector('ytd-browse[page-subtype="subscriptions"] #contents'),
      document.querySelector('ytd-browse[page-subtype="trending"] #contents'),
      document.querySelector('ytd-two-column-browse-results-renderer #primary #contents'),
      document.querySelector('ytd-section-list-renderer #contents')
    ];
    return candidates.find(el => el && el.isConnected) || null;
  }
  function cardsFor(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(CARD_SELECTOR)).filter(el => isFeedCard(el, root) && !el.matches('#nexus-feed-load-more'));
  }
  function cleanup() {
    if (button) button.remove();
    button = null;
    if (currentRoot) cardsFor(currentRoot).forEach(el => { if (el.hasAttribute('data-nexus-batch-hidden')) { el.style.removeProperty('display'); el.removeAttribute('data-nexus-batch-hidden'); } });
    currentRoot = null;
  }
  function update() {
    scheduled = false;
    if (!enabled) { cleanup(); return; }
    const root = getRoot();
    if (!root) { cleanup(); return; }
    if (currentRoot !== root) { cleanup(); currentRoot = root; visibleCount = batchSize; }
    const cards = cardsFor(root);
    cards.forEach((card, i) => {
      if (i < visibleCount) { if (card.hasAttribute('data-nexus-batch-hidden')) { card.style.removeProperty('display'); card.removeAttribute('data-nexus-batch-hidden'); } }
      else { card.style.setProperty('display', 'none', 'important'); card.setAttribute('data-nexus-batch-hidden', '1'); }
    });
    if (!button) {
      button = document.createElement('button'); button.id = 'nexus-feed-load-more'; button.type = 'button';
      button.addEventListener('click', () => { visibleCount += batchSize; schedule(); });
    }
    const hidden = Math.max(0, cards.length - visibleCount);
    button.textContent = hidden ? `Mostrar mais ${Math.min(batchSize, hidden)} vídeos` : `Mostrar próximos ${batchSize} vídeos`;
    button.hidden = cards.length <= visibleCount && hidden === 0;
    if (button.parentElement !== root) root.appendChild(button);
  }
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(update); }
  function loadConfig() {
    try { chrome.storage.sync.get({ feedBatchEnabled: true, feedBatchSize: 7 }, data => { enabled = data.feedBatchEnabled !== false; batchSize = Math.max(5, Math.min(20, Number(data.feedBatchSize) || 7)); visibleCount = batchSize; schedule(); }); }
    catch (_) { schedule(); }
  }
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area !== 'sync') return; if (changes.feedBatchEnabled) enabled = changes.feedBatchEnabled.newValue !== false; if (changes.feedBatchSize) { batchSize = Math.max(5, Math.min(20, Number(changes.feedBatchSize.newValue) || 7)); visibleCount = batchSize; } schedule(); }); } catch (_) {}
  const observer = new MutationObserver(schedule);
  function start() { loadConfig(); observer.observe(document.documentElement, { childList: true, subtree: true }); window.addEventListener('yt-navigate-finish', () => { cleanup(); visibleCount = batchSize; schedule(); }); window.addEventListener('popstate', schedule); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
