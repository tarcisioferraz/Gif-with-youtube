// Nexus YouTube+ — atalho "Games" (controle) abaixo de "Esportes", com menu de vários jogos.
(() => {
  'use strict';
  if (window.__nexusGamesLoaded) return;
  window.__nexusGamesLoaded = true;

  // [emoji, nome exibido, termo pesquisado]
  const GAMES = [
    ['⛏️', 'Minecraft', 'minecraft'],
    ['🧱', 'Roblox', 'roblox'],
    ['🔥', 'Free Fire', 'free fire'],
    ['🪂', 'Fortnite', 'fortnite'],
    ['🚗', 'GTA', 'gta 5'],
    ['⚽', 'EA FC', 'ea fc'],
    ['🎯', 'Valorant', 'valorant'],
    ['⚔️', 'League of Legends', 'league of legends'],
    ['💣', 'Counter-Strike 2', 'counter strike 2'],
    ['🪖', 'Call of Duty', 'call of duty'],
    ['⭐', 'Brawl Stars', 'brawl stars'],
    ['👑', 'Clash Royale', 'clash royale'],
    ['🚀', 'Among Us', 'among us'],
    ['⚡', 'Pokémon', 'pokemon'],
    ['🍄', 'Mario', 'super mario'],
    ['🗡️', 'Zelda', 'zelda'],
    ['👻', 'Jogos de terror', 'jogos de terror']
  ];

  const NS = 'http://www.w3.org/2000/svg';
  let menu = null;
  let hideTimer = null;

  function controllerIcon() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ytgif-games-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML =
      '<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)">' +
      '<rect x="2.4" y="6.8" width="19.2" height="10.6" rx="5.3" stroke="#f4f4f4" stroke-width="2"/>' +
      '<path d="M8 10.2v4.2M5.9 12.3h4.2" stroke="#f4f4f4" stroke-width="1.9"/>' +
      '<circle cx="15.2" cy="11.3" r="1" fill="#f4f4f4" stroke="#f4f4f4" stroke-width=".6"/>' +
      '<circle cx="18" cy="13.4" r="1" fill="#f4f4f4" stroke="#f4f4f4" stroke-width=".6"/></g>';
    return svg;
  }

  /* ---------- Menu ---------- */
  function buildMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'ytgif-games-menu';
    menu.hidden = true;
    GAMES.forEach(([icon, label, query]) => {
      const a = document.createElement('a');
      a.href = '/results?search_query=' + encodeURIComponent(query);
      a.dataset.query = query;
      const span = document.createElement('span');
      span.textContent = icon;
      a.append(span, document.createTextNode(label));
      a.addEventListener('click', (e) => {
        e.preventDefault();
        // Mesmo comportamento do menu de Esportes: pesquisa o termo e deixa o campo de busca vazio.
        try { sessionStorage.setItem('ytgif-clear-search-after-sports', '1'); } catch (_) {}
        const target = new URL('/results', location.origin);
        target.searchParams.set('search_query', query);
        location.assign(target.href);
      });
      menu.appendChild(a);
    });
    menu.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    menu.addEventListener('mouseleave', hideSoon);
    document.body.appendChild(menu);
    return menu;
  }

  function showMenu(anchor) {
    const m = buildMenu();
    clearTimeout(hideTimer);
    const sports = document.getElementById('ytgif-sports-menu');
    if (sports) sports.hidden = true;
    m.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const h = m.offsetHeight || 400;
    m.style.left = Math.min(rect.right + 8, window.innerWidth - 210) + 'px';
    m.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - h - 8)) + 'px';
  }
  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (menu) menu.hidden = true; }, 180);
  }

  function connect(entry) {
    const link = entry.querySelector('a[href]');
    if (!link || link.dataset.ytgifGamesMenu) return;
    link.dataset.ytgifGamesMenu = '1';
    link.href = '#';
    link.addEventListener('click', (e) => { e.preventDefault(); showMenu(link); });
    entry.addEventListener('mouseenter', () => showMenu(link));
    entry.addEventListener('mouseleave', hideSoon);
    link.addEventListener('focus', () => showMenu(link));
  }

  /* ---------- Entradas na barra lateral (clonam o item de Esportes) ---------- */
  function swapIcon(entry) {
    const old = entry.querySelector('svg.ytgif-sports-trophy');
    if (old) old.replaceWith(controllerIcon());
  }

  function injectFull() {
    const sports = document.querySelector('ytd-guide-entry-renderer.ytgif-sports-entry');
    if (!sports || !sports.parentElement || sports.parentElement.querySelector('.ytgif-games-entry')) return;
    const games = sports.cloneNode(true);
    games.classList.remove('ytgif-sports-entry');
    games.classList.add('ytgif-games-entry');
    const link = games.querySelector('a[href]');
    if (!link) return;
    link.removeAttribute('data-ytgif-sports-menu');
    link.href = '#';
    link.setAttribute('aria-label', 'Games');
    link.setAttribute('title', 'Games');
    const title = games.querySelector('#title, yt-formatted-string');
    if (title) title.textContent = 'Games';
    swapIcon(games);
    connect(games);
    sports.insertAdjacentElement('afterend', games);
  }

  function injectMini() {
    const sports = document.querySelector('ytd-mini-guide-entry-renderer.ytgif-mini-sports-entry');
    if (!sports || !sports.parentElement || sports.parentElement.querySelector('.ytgif-mini-games-entry')) return;
    const games = sports.cloneNode(true);
    games.classList.remove('ytgif-mini-sports-entry');
    games.classList.add('ytgif-mini-games-entry');
    const link = games.querySelector('a[href]');
    if (!link) return;
    link.removeAttribute('data-ytgif-sports-menu');
    link.href = '#';
    link.setAttribute('aria-label', 'Games');
    link.setAttribute('title', 'Games');
    const title = games.querySelector('.title');
    if (title) title.textContent = 'Games';
    const tip = games.querySelector('tp-yt-paper-tooltip #tooltip');
    if (tip) tip.textContent = 'Games';
    swapIcon(games);
    connect(games);
    sports.insertAdjacentElement('afterend', games);
  }

  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { injectFull(); injectMini(); } catch (_) {} }, 500);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', schedule);
  schedule();
})();
