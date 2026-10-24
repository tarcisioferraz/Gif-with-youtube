(() => {
  'use strict';
  if (window.__nexusSearchHeartLoaded) return;
  window.__nexusSearchHeartLoaded = true;

  const KEY_RECENTS = 'nexusSearchRecents';
  const KEY_FAVS = 'nexusSearchFavorites';
  const MAX_RECENTS = 15;
  const MAX_FAVS = 100;
  const BTN_ID = 'nexus-sh-btn';
  const PANEL_ID = 'nexus-sh-panel';

  let recents = [];
  let favs = [];
  let tab = 'recents';
  let enabled = true;
  let panel = null;
  let btn = null;

  const store = chrome.storage.local;

  /* ---------- Dados ---------- */
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const isFav = (t) => favs.some((f) => same(f, t));

  function loadData(cb) {
    try {
      store.get({ [KEY_RECENTS]: [], [KEY_FAVS]: [] }, (d) => {
        recents = Array.isArray(d[KEY_RECENTS]) ? d[KEY_RECENTS] : [];
        favs = Array.isArray(d[KEY_FAVS]) ? d[KEY_FAVS] : [];
        if (cb) cb();
      });
    } catch (_) {}
  }
  function saveRecents() { try { store.set({ [KEY_RECENTS]: recents }); } catch (_) {} }
  function saveFavs() { try { store.set({ [KEY_FAVS]: favs }); } catch (_) {} }

  function addRecent(text) {
    const t = clean(text);
    if (!t) return;
    recents = [t, ...recents.filter((r) => !same(r, t))].slice(0, MAX_RECENTS);
    saveRecents();
  }
  function addFav(text) {
    const t = clean(text);
    if (!t || isFav(t)) return false;
    favs = [t, ...favs].slice(0, MAX_FAVS);
    saveFavs();
    return true;
  }
  function removeFav(text) { favs = favs.filter((f) => !same(f, text)); saveFavs(); }
  function removeRecent(text) { recents = recents.filter((r) => !same(r, text)); saveRecents(); }

  /* ---------- Registrar pesquisas (qualquer forma de pesquisar) ---------- */
  function currentQuery() {
    if (location.pathname !== '/results') return '';
    try { return clean(new URL(location.href).searchParams.get('search_query')); } catch (_) { return ''; }
  }
  let lastRecorded = '';
  function recordCurrentSearch() {
    const q = currentQuery();
    if (!q || q === lastRecorded) return;
    lastRecorded = q;
    // Recarrega antes para não sobrescrever alterações feitas em outra aba.
    loadData(() => { addRecent(q); if (panel && !panel.hidden) render(); updateHeartState(); });
  }

  function runSearch(text) {
    const q = clean(text);
    if (!q) return;
    closePanel();
    const target = new URL('/results', location.origin);
    target.searchParams.set('search_query', q);
    location.assign(target.href);
  }

  /* ---------- Ícones ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svg(pathD, opts = {}) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    if (opts.cls) s.setAttribute('class', opts.cls);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathD);
    if (opts.filled) p.setAttribute('fill', 'currentColor');
    else { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.9'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round'); }
    s.appendChild(p);
    return s;
  }
  const HEART = 'M12 20.6l-1.2-1.1C6.1 15.3 3 12.5 3 9a4.8 4.8 0 0 1 4.8-4.8c1.6 0 3.2.8 4.2 2 1-1.2 2.6-2 4.2-2A4.8 4.8 0 0 1 21 9c0 3.5-3.1 6.3-7.8 10.5L12 20.6z';
  const CLOCK = 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3.2 2';
  const CLOSE = 'M6 6l12 12M18 6L6 18';
  const heartIcon = (filled) => svg(HEART, { filled });

  /* ---------- Botão ---------- */
  function makeButton() {
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.title = 'Pesquisas recentes e favoritas';
    b.setAttribute('aria-label', 'Pesquisas recentes e favoritas');
    b.setAttribute('aria-haspopup', 'dialog');
    b.appendChild(heartIcon(false));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panel && !panel.hidden) closePanel(); else openPanel();
    });
    return b;
  }

  function updateHeartState() {
    const b = document.getElementById(BTN_ID);
    if (!b) return;
    const q = currentQuery();
    const filled = !!q && isFav(q);
    b.classList.toggle('nexus-sh-active', filled);
    const old = b.querySelector('svg');
    if (old) old.replaceWith(heartIcon(filled));
  }

  function findAnchor() {
    return (
      document.querySelector('ytd-masthead #center yt-searchbox') ||
      document.querySelector('ytd-masthead #center ytd-searchbox') ||
      document.querySelector('ytd-masthead yt-searchbox') ||
      document.querySelector('ytd-masthead ytd-searchbox')
    );
  }

  function inject() {
    const existing = document.getElementById(BTN_ID);
    if (!enabled) { if (existing) existing.remove(); closePanel(); return; }
    const anchor = findAnchor();
    if (!anchor) return;
    if (existing && existing.previousElementSibling === anchor) { btn = existing; return; }
    if (existing) existing.remove();
    btn = makeButton();
    anchor.insertAdjacentElement('afterend', btn);
    updateHeartState();
  }

  /* ---------- Painel ---------- */
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Pesquisas recentes e favoritas');
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(panel);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function iconBtn(title, icon, onClick, cls) {
    const b = el('button', 'nexus-sh-iconbtn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.appendChild(icon);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function row(text, lead, actions) {
    const r = el('div', 'nexus-sh-row');
    const main = el('button', 'nexus-sh-main');
    main.type = 'button';
    main.title = 'Pesquisar “' + text + '”';
    main.appendChild(lead);
    main.appendChild(el('span', 'nexus-sh-text', text));
    main.addEventListener('click', () => runSearch(text));
    r.appendChild(main);
    actions.forEach((a) => r.appendChild(a));
    return r;
  }

  function render() {
    if (!panel) return;
    panel.textContent = '';

    // Abas
    const tabs = el('div', 'nexus-sh-tabs');
    [['recents', 'Recentes'], ['favs', 'Favoritos']].forEach(([id, label]) => {
      const t = el('button', 'nexus-sh-tab' + (tab === id ? ' nexus-sh-tab-on' : ''), label);
      t.type = 'button';
      t.addEventListener('click', () => { tab = id; render(); });
      tabs.appendChild(t);
    });
    panel.appendChild(tabs);

    const body = el('div', 'nexus-sh-body');

    if (tab === 'recents') {
      if (!recents.length) {
        body.appendChild(el('div', 'nexus-sh-empty', 'Nenhuma pesquisa recente ainda. Pesquise algo e ela aparece aqui.'));
      } else {
        recents.forEach((t) => {
          const fav = isFav(t);
          body.appendChild(row(t, svg(CLOCK, { cls: 'nexus-sh-lead' }), [
            iconBtn(fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos', heartIcon(fav), () => {
              if (fav) removeFav(t); else addFav(t);
              render(); updateHeartState();
            }, fav ? 'nexus-sh-fav-on' : ''),
            iconBtn('Remover dos recentes', svg(CLOSE), () => { removeRecent(t); render(); })
          ]));
        });
      }
      if (recents.length) {
        const clear = el('button', 'nexus-sh-clear', 'Limpar recentes');
        clear.type = 'button';
        clear.addEventListener('click', () => { recents = []; saveRecents(); render(); });
        body.appendChild(clear);
      }
    } else {
      // Campo para adicionar favorito
      const form = el('div', 'nexus-sh-add');
      const input = el('input', 'nexus-sh-input');
      input.type = 'text';
      input.placeholder = 'Adicionar pesquisa favorita';
      input.maxLength = 150;
      input.autocomplete = 'off';
      input.spellcheck = false;
      const add = el('button', 'nexus-sh-addbtn', 'Adicionar');
      add.type = 'button';
      const submit = () => {
        const ok = addFav(input.value);
        if (ok || isFav(clean(input.value))) { render(); updateHeartState(); const i = panel.querySelector('.nexus-sh-input'); if (i) i.focus(); }
      };
      add.addEventListener('click', submit);
      // Impede que atalhos do YouTube capturem as teclas digitadas
      ['keydown', 'keypress', 'keyup'].forEach((ev) => input.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'keydown' && e.key === 'Enter') { e.preventDefault(); submit(); }
      }));
      form.append(input, add);
      body.appendChild(form);

      if (!favs.length) {
        body.appendChild(el('div', 'nexus-sh-empty', 'Nenhum favorito ainda. Digite acima ou toque no coração em uma pesquisa recente.'));
      } else {
        favs.forEach((t) => {
          const lead = heartIcon(true);
          lead.setAttribute('class', 'nexus-sh-lead nexus-sh-lead-fav');
          body.appendChild(row(t, lead, [
            iconBtn('Remover dos favoritos', svg(CLOSE), () => { removeFav(t); render(); updateHeartState(); })
          ]));
        });
      }
    }
    panel.appendChild(body);
  }

  function positionPanel() {
    if (!panel || !btn) return;
    const r = btn.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
    panel.style.top = r.bottom + 8 + 'px';
    panel.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 24) + 'px';
  }

  function openPanel() {
    if (!panel) buildPanel();
    loadData(() => {
      render();
      positionPanel();
      panel.hidden = false;
      btn && btn.setAttribute('aria-expanded', 'true');
    });
  }
  function closePanel() {
    if (panel) panel.hidden = true;
    const b = document.getElementById(BTN_ID);
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', (e) => {
    if (!panel || panel.hidden) return;
    const path = e.composedPath();
    if (path.includes(panel) || path.includes(document.getElementById(BTN_ID))) return;
    closePanel();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden) closePanel(); }, true);
  window.addEventListener('resize', () => { if (panel && !panel.hidden) positionPanel(); });
  window.addEventListener('scroll', () => { if (panel && !panel.hidden) positionPanel(); }, true);

  /* ---------- Sincronização entre abas / configurações ---------- */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[KEY_RECENTS] || changes[KEY_FAVS])) {
        if (changes[KEY_RECENTS]) recents = changes[KEY_RECENTS].newValue || [];
        if (changes[KEY_FAVS]) favs = changes[KEY_FAVS].newValue || [];
        if (panel && !panel.hidden) {
          const typing = panel.querySelector('.nexus-sh-input');
          if (!(typing && document.activeElement === typing)) render();
        }
        updateHeartState();
      }
      if (area === 'sync' && (changes.searchHeart || changes.enabled)) {
        chrome.storage.sync.get({ enabled: true, searchHeart: true }, applyConfig);
      }
    });
  } catch (_) {}

  function applyConfig(cfg) {
    enabled = cfg.enabled !== false && cfg.searchHeart !== false;
    inject();
  }

  /* ---------- Inicialização (YouTube é uma SPA) ---------- */
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; inject(); }, 300);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => { closePanel(); recordCurrentSearch(); updateHeartState(); schedule(); });

  loadData(() => {
    try { chrome.storage.sync.get({ enabled: true, searchHeart: true }, (cfg) => { applyConfig(cfg); recordCurrentSearch(); }); } catch (_) { inject(); }
  });
})();
