(() => {
  'use strict';
  console.log('[Nexus YouTube+] extensão carregada');

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { error: 'Sem resposta da extensão' }));
      } catch (e) {
        resolve({ error: 'Extensão recarregada. Atualize a página (F5).' });
      }
    });

  const COMMENT_SELECTOR =
    'ytd-commentbox, ytd-comment-simplebox-renderer, ytd-comments, #comments, ' +
    'ytd-engagement-panel-section-list-renderer, ytd-comment-thread-renderer, ytd-comment-view-model, ' +
    'ytd-comment-renderer, yt-comment-view-model, yt-comment-thread-renderer, ' +
    'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text, ' +
    'ytd-comment-thread-renderer #content-text, #content-text, .yt-core-attributed-string';

  let panel, searchInput, bodyEl, cols, statusEl, footEl, floatBtn;
  let currentEditor = null;
  let editorRange = null;
  let anchorEl = null;
  let query = '';
  let nextPos = '';
  let loading = false;
  let reqId = 0;
  let heights = [0, 0];
  let debounce;
  let floatVisible = false;
  let sportsMenu;
  let sportsHideTimer;

  const extensionConfig = { enabled: true, gifButton: true, plusToolbar: true, shortcuts: true, commentTools: true,
    backgroundColor: '#0f0f0f', backgroundImage: '', backgroundOpacity: 25, backgroundTarget: 'main', compactPanel: false,
    cleanShortsNav: false, cleanShortsShelves: false, cleanCommunityShelves: false,
    cleanCommerceButtons: false, cleanComments: false, cleanEndscreen: false, ambientLight: false, ambientIntensity: 65 };
  function applyExtensionConfig(config) {
    Object.assign(extensionConfig, config || {});
    const root = document.documentElement;
    root.classList.toggle('ytgif-extension-disabled', !extensionConfig.enabled);
    root.classList.toggle('ytgif-hide-gif-button', !extensionConfig.gifButton);
    root.classList.toggle('ytgif-hide-plus-toolbar', !extensionConfig.plusToolbar);
    root.classList.toggle('ytgif-disable-comment-tools', !extensionConfig.commentTools);
    root.classList.toggle('ytgif-compact-panel', !!extensionConfig.compactPanel);
    root.classList.toggle('ytgif-clean-shorts-nav', !!extensionConfig.cleanShortsNav);
    root.classList.toggle('ytgif-clean-shorts-shelves', !!extensionConfig.cleanShortsShelves);
    root.classList.toggle('ytgif-clean-community-shelves', !!extensionConfig.cleanCommunityShelves);
    root.classList.toggle('ytgif-clean-commerce', !!extensionConfig.cleanCommerceButtons);
    root.classList.toggle('ytgif-clean-comments', !!extensionConfig.cleanComments);
    root.classList.toggle('ytgif-clean-endscreen', !!extensionConfig.cleanEndscreen);
    root.classList.toggle('nexus-ambient-enabled', !!extensionConfig.ambientLight);
    root.style.setProperty('--nexus-ambient-opacity', String(Math.max(0.2, Math.min(1, Number(extensionConfig.ambientIntensity || 65) / 100))));
    const color = /^#[0-9a-f]{3,8}$/i.test(extensionConfig.backgroundColor || '') ? extensionConfig.backgroundColor : '#0f0f0f';
    const image = typeof extensionConfig.backgroundImage === 'string' ? extensionConfig.backgroundImage.trim() : '';
    const opacity = Math.max(0, Math.min(100, Number(extensionConfig.backgroundOpacity) || 0)) / 100;
    let safeUrl = '';
    try { const u = new URL(image); if (u.protocol === 'https:' || u.protocol === 'http:') safeUrl = u.href.replace(/[()\\\\"']/g, ''); } catch (_) {}
    root.style.setProperty('--ytgif-custom-background', color);
    root.style.setProperty('--ytgif-custom-bg-image', safeUrl ? `linear-gradient(rgba(15,15,15,${1-opacity}), rgba(15,15,15,${1-opacity})), url("${safeUrl}")` : 'none');
    root.classList.toggle('ytgif-custom-bg-all', extensionConfig.backgroundTarget === 'all');
    root.classList.toggle('ytgif-custom-bg-main', extensionConfig.backgroundTarget !== 'all');
    syncPageBackgroundLayer(color, safeUrl ? `linear-gradient(rgba(15,15,15,${1-opacity}), rgba(15,15,15,${1-opacity})), url("${safeUrl}")` : 'none');
    document.querySelectorAll('.ytgif-sidebar-settings').forEach(el => { if (!extensionConfig.enabled) el.remove(); });
  }

  // O YouTube mistura diversos contêineres e, em algumas telas, não deixa um
  // fundo editável. Esta camada fica fixa atrás da interface inteira, enquanto
  // todos os controles e vídeos continuam acima dela.
  function syncPageBackgroundLayer(color, backgroundImage) {
    if (!document.body) return;
    let layer = document.getElementById('ytgif-page-background-layer');
    if (!extensionConfig.enabled) {
      if (layer) layer.remove();
      document.documentElement.classList.remove('ytgif-page-background-active');
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'ytgif-page-background-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    layer.style.backgroundColor = color;
    layer.style.backgroundImage = backgroundImage;
    document.documentElement.classList.add('ytgif-page-background-active');
  }
  try {
    chrome.storage.sync.get(extensionConfig, applyExtensionConfig);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const patch = {};
      Object.keys(changes).forEach(k => patch[k] = changes[k].newValue);
      applyExtensionConfig(patch);
    });
  } catch (_) {}

  /* ---------- Painel de GIFs ---------- */
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ytgif-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ytgif-head">
        <input type="text" class="ytgif-search" placeholder="Pesquisar GIFs ou colar link" autocomplete="off" spellcheck="false">
        <button type="button" class="ytgif-tools-toggle" title="Ferramentas Plus">Plus</button>
        <button type="button" class="ytgif-close" title="Fechar">✕</button>
      </div>
      <div class="ytgif-body">
        <div class="ytgif-cols"><div class="ytgif-col"></div><div class="ytgif-col"></div></div>
        <div class="ytgif-status"></div>
      </div>
      <div class="ytgif-foot"></div>
      <section class="ytgif-plus-tools" hidden>
        <div class="ytgif-plus-title">YouTube Plus</div>
        <div class="ytgif-plus-grid">
          <button data-plus="queue">Fila inteligente</button>
          <button data-plus="clean">Limpeza visual</button>
          <button data-plus="stats">Estatísticas</button>
          <button data-plus="repeat">Repetir últimos 10 s</button>
          <button data-plus="shorts">Modo Shorts</button>
          <button data-plus="audio">Áudio +</button>
          <button data-plus="export">Exportar dados</button>
          <button data-plus="diagnostics">Diagnóstico</button>
        </div>
        <div class="ytgif-plus-status" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(panel);

    searchInput = panel.querySelector('.ytgif-search');
    const plusTools = panel.querySelector('.ytgif-plus-tools');
    const plusStatus = panel.querySelector('.ytgif-plus-status');
    panel.querySelector('.ytgif-tools-toggle').addEventListener('click', () => {
      plusTools.hidden = !plusTools.hidden;
    });
    const plusSay = (message) => { plusStatus.textContent = message; };
    const readData = () => {
      try { return JSON.parse(localStorage.getItem('ytgifPlusData') || '{}'); } catch (_) { return {}; }
    };
    const saveData = (data) => localStorage.setItem('ytgifPlusData', JSON.stringify(data));
    const videoNow = () => document.querySelector('video.html5-main-video, ytd-player video, video');
    const videoKey = () => location.pathname + location.search;
    panel.querySelectorAll('[data-plus]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.plus;
      const data = readData();
      if (action === 'queue') {
        const links = [...document.querySelectorAll('a#video-title, a[href*="/watch"], a[href*="/shorts/"]')]
          .filter(a => a.href && a.querySelector('yt-img-shadow, img') && !a.href.includes('list='))
          .map(a => ({title:(a.textContent || a.getAttribute('title') || 'Vídeo').trim(), url:a.href}))
          .filter((item, i, arr) => arr.findIndex(x => x.url === item.url) === i).slice(0, 30);
        data.queue = links; saveData(data);
        plusSay('Fila salva: ' + links.length + ' vídeos encontrados nesta página.');
      } else if (action === 'clean') {
        document.documentElement.classList.toggle('ytgif-plus-clean');
        plusSay(document.documentElement.classList.contains('ytgif-plus-clean') ? 'Limpeza visual ativada. Clique novamente para restaurar.' : 'Visual original restaurado.');
      } else if (action === 'stats') {
        const stats = data.stats || {};
        stats[videoKey()] = {title: document.title, seconds: Math.floor((videoNow() || {}).currentTime || 0), updated: new Date().toISOString()};
        data.stats = stats; saveData(data);
        plusSay('Estatísticas locais: ' + Object.keys(stats).length + ' vídeos registrados.');
      } else if (action === 'repeat') {
        const v = videoNow();
        if (!v) return plusSay('Nenhum vídeo encontrado.');
        const end = v.currentTime, start = Math.max(0, end - 10);
        v.currentTime = start;
        const handler = () => { if (v.currentTime >= end) v.currentTime = start; };
        v.addEventListener('timeupdate', handler);
        plusSay('Repetindo o trecho de 10 segundos. Clique novamente para parar.');
        button.dataset.repeatActive = '1';
        button.onclick = () => { v.removeEventListener('timeupdate', handler); button.onclick = null; delete button.dataset.repeatActive; plusSay('Repetição desativada.'); };
      } else if (action === 'shorts') {
        document.documentElement.classList.toggle('ytgif-plus-shorts');
        plusSay(document.documentElement.classList.contains('ytgif-plus-shorts') ? 'Modo Shorts ativado.' : 'Modo Shorts desativado.');
      } else if (action === 'audio') {
        const v = videoNow();
        if (!v) return plusSay('Nenhum vídeo encontrado.');
        v.volume = v.volume >= 1 ? 0.7 : Math.min(1, v.volume + 0.2);
        plusSay('Volume do vídeo: ' + Math.round(v.volume * 100) + '%. O limite do elemento é 100%.');
      } else if (action === 'export') {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'youtube-plus-dados.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
        plusSay('Exportação iniciada.');
      } else if (action === 'diagnostics') {
        const v = videoNow();
        plusSay('Diagnóstico: vídeo=' + Boolean(v) + ', Shorts=' + location.pathname.includes('/shorts/') + ', painel=' + Boolean(panel) + ', versão 2.1.0.');
      }
    }));
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); if (panel.hidden) openPanel(floatBtn || document.body, currentEditor); else closePanel(); }
      if (e.altKey && e.key === 'ArrowRight') { const v=videoNow(); if(v) v.currentTime += 5; }
      if (e.altKey && e.key === 'ArrowLeft') { const v=videoNow(); if(v) v.currentTime = Math.max(0,v.currentTime-5); }
    });

    bodyEl = panel.querySelector('.ytgif-body');
    cols = [...panel.querySelectorAll('.ytgif-col')];
    statusEl = panel.querySelector('.ytgif-status');
    footEl = panel.querySelector('.ytgif-foot');

    panel.querySelector('.ytgif-close').addEventListener('click', closePanel);

    ['keydown', 'keypress', 'keyup'].forEach((ev) =>
      searchInput.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'keydown' && e.key === 'Escape') closePanel();
      })
    );

    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        query = searchInput.value.trim();
        load(true);
      }, 350);
    });

    bodyEl.addEventListener('scroll', () => {
      if (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 200) load(false);
    });

    statusEl.addEventListener('click', (e) => {
      if (e.target.closest('.ytgif-opts')) {
        e.preventDefault();
        send({ type: 'open-options' });
      }
    });

    panel.addEventListener('mousedown', (e) => {
      if (e.target !== searchInput) e.preventDefault();
    });
  }

  function setStatus(html) {
    statusEl.innerHTML = html || '';
  }

  function linkToGif(q) {
    q = (q || '').trim();
    if (!/^https?:\/\//i.test(q)) return null;
    if (GIF_RE.test(q)) return q;
    const m =
      q.match(/giphy\.com\/(?:gifs|stickers)\/(?:[^\/?#]*-)?([A-Za-z0-9]+)(?:[\/?#]|$)/i) ||
      q.match(/giphy\.com\/(?:media|embed)\/([A-Za-z0-9]+)/i);
    return m ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : null;
  }

  async function load(reset) {
    if (reset) {
      reqId++;
      nextPos = '';
      heights = [0, 0];
      cols.forEach((c) => (c.innerHTML = ''));
      const direct = linkToGif(query);
      if (direct) {
        addItem({ id: 'link', title: 'GIF do link', preview: direct, url: direct, w: 1, h: 1 });
        nextPos = null;
        loading = false;
        setStatus('Clique no GIF para adicionar.');
        footEl.textContent = '';
        return;
      }
    } else if (loading || nextPos === null) {
      return;
    }
    const my = reqId;
    loading = true;
    setStatus('Carregando…');

    const r = await send({ type: 'gif-search', query, pos: nextPos || '' });
    if (my !== reqId) return;
    loading = false;

    if (r.error) {
      if (r.error === 'NO_KEY') {
        setStatus('A pesquisa automática pode estar indisponível. Cole um link direto de GIF (.gif) ou um link de página do GIPHY.');
      } else {
        setStatus('Erro: ' + r.error);
      }
      nextPos = null;
      return;
    }

    r.items.forEach(addItem);
    nextPos = r.next;
    setStatus(!r.items.length && !cols[0].children.length ? 'Nenhum GIF encontrado. Tente outra palavra ou cole um link de GIF.' : '');
    footEl.textContent = r.provider === 'tenor' ? 'via Tenor' : 'via GIPHY';

    if (nextPos && bodyEl.scrollHeight <= bodyEl.clientHeight + 50) load(false);
  }

  function addItem(g) {
    const img = document.createElement('img');
    img.className = 'ytgif-item';
    img.src = g.preview;
    img.alt = g.title;
    img.title = g.title;
    img.loading = 'lazy';
    if (g.w > 1) img.style.aspectRatio = `${g.w} / ${g.h}`;
    img.addEventListener('click', () => pick(g));
    const i = heights[0] <= heights[1] ? 0 : 1;
    heights[i] += g.h / g.w;
    cols[i].appendChild(img);
  }

  function makeComposeToken(url) {
    const token = document.createElement('span');
    token.className = 'ytgif-compose-token';
    token.contentEditable = 'false';
    token.dataset.ytgifUrl = url;
    token.title = 'GIF — clique para remover';
    const img = gifImg(url, 'ytgif-compose-img');
    const text = document.createElement('span');
    // O texto continua no comentário enviado ao YouTube, mas fica invisível enquanto
    // a pessoa escreve. Assim, a extensão não depende de conteúdo que o YouTube
    // possa descartar ao publicar.
    text.className = 'ytgif-hidden-link';
    text.textContent = url;
    token.append(img, text);
    token.addEventListener('mousedown', (e) => e.preventDefault());
    token.addEventListener('click', (e) => {
      e.preventDefault();
      const editor = token.closest('[contenteditable="true"]');
      token.remove();
      if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return token;
  }

  function selectionIn(editor) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return range;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function rememberEditorRange(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) editorRange = range.cloneRange();
  }

  function insertGifAtSelection(url) {
    const ed = currentEditor;
    if (!ed || !document.contains(ed)) return;
    ed.focus();
    if (!ed.isContentEditable) {
      ed.value += (ed.value ? ' ' : '') + url;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const range = editorRange && ed.contains(editorRange.commonAncestorContainer)
      ? editorRange.cloneRange()
      : selectionIn(ed);
    editorRange = null;
    range.deleteContents();
    const token = makeComposeToken(url);
    range.insertNode(token);
    // Se o GIF foi colocado no meio ou ao lado de palavras, separa-o
    // automaticamente. Espaços já existentes são mantidos como estão.
    const left = token.previousSibling;
    const right = token.nextSibling;
    if (left && left.nodeType === Node.TEXT_NODE && left.nodeValue && !/\s$/.test(left.nodeValue)) {
      token.before(document.createTextNode(' '));
    }
    if (right && right.nodeType === Node.TEXT_NODE && right.nodeValue && !/^\s/.test(right.nodeValue)) {
      token.after(document.createTextNode(' '));
    }
    const caret = document.createRange();
    caret.setStartAfter(token);
    caret.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(caret);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pick(g) {
    insertGifAtSelection(g.url);
    closePanel();
  }

  // O editor de comentários de vídeos longos pode enviar innerText e ignorar
  // conteúdo visualmente oculto. Pouco antes do envio, convertemos cada token
  // para sua URL real; assim o servidor recebe o link e o renderizador local
  // consegue transformá-lo novamente em GIF após publicar.
  function expandGifTokensForPost(scope) {
    if (!scope) return false;
    const root = scope.nodeType === Node.ELEMENT_NODE ? scope : null;
    if (!root) return false;
    const tokens = [];
    if (root.matches && root.matches('.ytgif-compose-token[data-ytgif-url]')) tokens.push(root);
    if (root.querySelectorAll) tokens.push(...root.querySelectorAll('.ytgif-compose-token[data-ytgif-url]'));
    let changed = false;
    tokens.forEach((token) => {
      const url = token.dataset.ytgifUrl;
      if (!url) return;
      token.replaceWith(document.createTextNode(url));
      changed = true;
    });
    if (changed) {
      const editor = root.matches && root.matches('[contenteditable="true"], textarea, input')
        ? root
        : root.querySelector('[contenteditable="true"], textarea, input');
      if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return changed;
  }

  function findGifComposeScope(node) {
    if (!node || !node.closest) return null;
    const editor = node.closest('[contenteditable="true"], textarea, input');
    if (editor && editor.querySelector && editor.querySelector('.ytgif-compose-token[data-ytgif-url]')) return editor;
    const selectors = [
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer',
      'ytd-comment-dialog-renderer',
      'ytd-backstage-post-dialog-renderer',
      'ytd-backstage-post-thread-renderer',
      'ytd-backstage-post-renderer',
      'ytd-post-renderer',
      'ytd-comments',
      'ytd-app'
    ];
    for (const selector of selectors) {
      const scope = node.closest(selector);
      if (scope && scope.querySelector && scope.querySelector('.ytgif-compose-token[data-ytgif-url]')) return scope;
    }
    return editor;
  }

  function expandTokensBeforeSubmit(node) {
    const scope = findGifComposeScope(node);
    if (!scope) return false;
    const changed = expandGifTokensForPost(scope);
    if (changed) {
      // O YouTube pode atualizar o DOM em mais de uma etapa depois do envio.
      setTimeout(() => { try { renderGifLinks(); } catch (_) {} }, 700);
      setTimeout(() => { try { renderGifLinks(); } catch (_) {} }, 1800);
    }
    return changed;
  }

  // Abrange comentários de vídeos, respostas, diálogos de comentários e
  // compositores de publicações da Comunidade que reutilizam os tokens GIF.
  document.addEventListener('click', (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    const submit = path.find((node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = node.tagName;
      if (tag !== 'BUTTON' && tag !== 'YTD-BUTTON-RENDERER' && tag !== 'TP-YT-PAPER-BUTTON') return false;
      const label = [
        node.id, node.getAttribute('aria-label'), node.getAttribute('title'),
        node.textContent, node.getAttribute('data-tooltip-text')
      ].filter(Boolean).join(' ').toLowerCase();
      return node.id === 'submit-button' ||
        /\b(comment|reply|respond|post|publicar|comentar|responder)\b/.test(label);
    }) || (event.target.closest && event.target.closest('#submit-button'));
    if (submit) expandTokensBeforeSubmit(submit);
  }, true);

  document.addEventListener('submit', (event) => {
    expandTokensBeforeSubmit(event.target);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const editor = event.target.closest && event.target.closest('[contenteditable="true"], textarea, input');
    if (editor) expandTokensBeforeSubmit(editor);
  }, true);

  function openPanel(anchor, editor) {
    if (!panel) buildPanel();
    anchorEl = anchor;
    if (editor) {
      currentEditor = editor;
      rememberEditorRange(editor);
    }
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 20);
    const h = Math.min(420, window.innerHeight - 20);
    let left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    panel.hidden = false;
    searchInput.value = '';
    query = '';
    load(true);
    searchInput.focus();
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  const panelOpen = () => panel && !panel.hidden;

  document.addEventListener(
    'click',
    (e) => {
      if (!panelOpen()) return;
      const path = e.composedPath();
      if (path.includes(panel) || path.some((n) => n.classList && n.classList.contains('ytgif-btn'))) return;
      closePanel();
    },
    true
  );

  function makeButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytgif-btn';
    btn.title = 'Adicionar GIF';
    btn.setAttribute('aria-label', 'Adicionar GIF');
    btn.textContent = 'GIF';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  }

  function trophyIconMarkup() {
    return '<svg class="ytgif-sports-trophy" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g></svg>';
  }

  function buildSportsMenu() {
    if (sportsMenu) return sportsMenu;
    sportsMenu = document.createElement('div');
    sportsMenu.id = 'ytgif-sports-menu';
    sportsMenu.hidden = true;
    sportsMenu.innerHTML = [
      ['⚽', 'Futebol', 'futebol'],
      ['🏀', 'Basquete', 'basquete'],
      ['🏐', 'Vôlei', 'volei'],
      ['🏎️', 'Fórmula 1', 'formula 1'],
      ['🥊', 'MMA', 'mma'],
      ['🎾', 'Tênis', 'tenis'],
      ['⚾', 'Beisebol', 'beisebol'],
      ['🏈', 'Futebol americano', 'futebol americano'],
      ['🏉', 'Rúgbi', 'rugby'],
      ['🏸', 'Badminton', 'badminton'],
      ['🏓', 'Tênis de mesa', 'tenis de mesa'],
      ['🥋', 'Judô', 'judo'],
      ['🥋', 'Taekwondo', 'taekwondo'],
      ['🏊', 'Natação', 'natacao'],
      ['🚴', 'Ciclismo', 'ciclismo'],
      ['🏋️', 'Levantamento de peso', 'levantamento de peso']
    ].map(([icon, label, query]) =>
      '<a href="/results?search_query=' + encodeURIComponent(query) + '" data-query="' + query + '"><span>' + icon + '</span>' + label + '</a>'
    ).join('');
    sportsMenu.querySelectorAll('a[data-query]').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        const query = item.getAttribute('data-query') || '';
        // Use the selected category for results, but keep YouTube's visible search field empty.
        const target = new URL('/results', location.origin);
        target.searchParams.set('search_query', query);
        location.assign(target.href);
        try {
          sessionStorage.setItem('ytgif-clear-search-after-sports', '1');
        } catch (_) {}
      });
    });
    sportsMenu.addEventListener('mouseenter', () => clearTimeout(sportsHideTimer));
    sportsMenu.addEventListener('mouseleave', hideSportsMenuSoon);
    document.body.appendChild(sportsMenu);
    return sportsMenu;
  }

  function showSportsMenu(anchor) {
    const menu = buildSportsMenu();
    clearTimeout(sportsHideTimer);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.min(rect.right + 8, window.innerWidth - 190) + 'px';
    menu.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 270)) + 'px';
    menu.hidden = false;
  }

  function hideSportsMenuSoon() {
    clearTimeout(sportsHideTimer);
    sportsHideTimer = setTimeout(() => {
      if (sportsMenu) sportsMenu.hidden = true;
    }, 180);
  }

  function connectSportsMenu(entry) {
    const link = entry.querySelector('a[href]');
    if (!link || link.dataset.ytgifSportsMenu) return;
    link.dataset.ytgifSportsMenu = '1';
    link.href = '#';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showSportsMenu(link);
    });
    entry.addEventListener('mouseenter', () => showSportsMenu(link));
    entry.addEventListener('mouseleave', hideSportsMenuSoon);
    link.addEventListener('focus', () => showSportsMenu(link));
  }

  /* ---------- Atalho Esportes abaixo de Shorts ---------- */
  function injectSportsTab() {
    const shorts = [...document.querySelectorAll('ytd-guide-entry-renderer')].find((entry) => {
      const title = entry.querySelector('#title, yt-formatted-string');
      return title && title.textContent.trim().toLowerCase() === 'shorts';
    });
    if (!shorts || shorts.parentElement.querySelector('.ytgif-sports-entry')) return;

    // Clonar a entrada nativa preserva tamanho, tema claro/escuro e comportamento
    // visual da barra lateral do YouTube.
    const sports = shorts.cloneNode(true);
    sports.classList.add('ytgif-sports-entry');
    sports.removeAttribute('selected');
    const link = sports.querySelector('a[href]');
    if (!link) return;
    link.href = '#';
    link.setAttribute('aria-label', 'Esportes');
    link.removeAttribute('aria-current');
    const title = sports.querySelector('#title, yt-formatted-string');
    if (title) title.textContent = 'Esportes';
    const icon = sports.querySelector('#icon, yt-icon');
    if (icon) {
      const trophy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trophy.setAttribute('class', 'ytgif-sports-trophy');
      trophy.setAttribute('viewBox', '0 0 24 24');
      trophy.setAttribute('aria-hidden', 'true');
      trophy.setAttribute('focusable', 'false');
      trophy.innerHTML = '<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g>';
      icon.replaceWith(trophy);
    }
    connectSportsMenu(sports);
    shorts.insertAdjacentElement('afterend', sports);
  }

  function injectMiniSportsTab() {
    const shorts = [...document.querySelectorAll('ytd-mini-guide-entry-renderer')].find((entry) => {
      const link = entry.querySelector('a[aria-label]');
      return link && link.getAttribute('aria-label').trim().toLowerCase() === 'shorts';
    });
    if (!shorts || shorts.parentElement.querySelector('.ytgif-mini-sports-entry')) return;

    // Esta é a barra compacta exibida na imagem: Início, Shorts, Inscrições e Você.
    const sports = shorts.cloneNode(true);
    sports.classList.add('ytgif-mini-sports-entry');
    const link = sports.querySelector('a[href]');
    if (!link) return;
    link.href = '#';
    link.setAttribute('aria-label', 'Esportes');
    link.setAttribute('title', 'Esportes');
    link.removeAttribute('aria-current');
    const title = sports.querySelector('.title');
    if (title) title.textContent = 'Esportes';
    const tooltip = sports.querySelector('tp-yt-paper-tooltip #tooltip');
    if (tooltip) tooltip.textContent = 'Esportes';
    const icon = sports.querySelector('#icon, yt-icon');
    if (icon) {
      const trophy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trophy.setAttribute('class', 'ytgif-sports-trophy');
      trophy.setAttribute('viewBox', '0 0 24 24');
      trophy.setAttribute('aria-hidden', 'true');
      trophy.setAttribute('focusable', 'false');
      trophy.innerHTML = '<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g>';
      icon.replaceWith(trophy);
    }
    connectSportsMenu(sports);
    shorts.insertAdjacentElement('afterend', sports);
  }

  function clearSportsSearchField() {
    let shouldClear = false;
    try {
      shouldClear = sessionStorage.getItem('ytgif-clear-search-after-sports') === '1';
    } catch (_) {}
    if (!shouldClear) return;
    const input = document.querySelector('input[name="search_query"], input.yt-searchbox-input, #search input');
    if (input) {
      input.value = '';
      input.setAttribute('value', '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try { sessionStorage.removeItem('ytgif-clear-search-after-sports'); } catch (_) {}
    }
  }

  /* ---------- Botão embutido (ao lado do emoji) ---------- */
  function injectButtons() {
    document.querySelectorAll('ytd-commentbox').forEach((box) => {
      if (box.querySelector('.ytgif-btn')) return;
      const btn = makeButton();
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ed =
          box.querySelector('#contenteditable-root') ||
          box.querySelector('[contenteditable="true"]') ||
          currentEditor;
        if (panelOpen() && anchorEl === btn) closePanel();
        else openPanel(btn, ed);
      });
      const emoji = box.querySelector('#emoji-button');
      if (emoji) {
        emoji.insertAdjacentElement('afterend', btn);
      } else {
        const footer = box.querySelector('#footer') || box.querySelector('#buttons');
        if (footer) footer.insertBefore(btn, footer.firstChild);
      }
    });
  }

  /* ---------- Botão flutuante (plano B, sempre aparece ao focar no comentário) ---------- */
  function buildFloat() {
    floatBtn = makeButton();
    floatBtn.classList.add('ytgif-float');
    floatBtn.hidden = true;
    floatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panelOpen() && anchorEl === floatBtn) closePanel();
      else openPanel(floatBtn, currentEditor);
    });
    document.body.appendChild(floatBtn);
  }

  function inlineVisibleFor(editor) {
    const box = editor && editor.closest && editor.closest('ytd-commentbox');
    const b = box && box.querySelector('.ytgif-btn');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function placeFloat() {
    if (!floatVisible) return;
    const ed = currentEditor;
    if (!ed || !document.contains(ed)) return hideFloat();
    const r = ed.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return hideFloat();
    if (inlineVisibleFor(ed)) {
      floatBtn.hidden = true;
    } else {
      floatBtn.hidden = false;
      const left = Math.max(4, Math.min(r.right - 56, window.innerWidth - 64));
      let top = r.top - 34;
      if (top < 4) top = r.bottom + 4;
      floatBtn.style.left = left + 'px';
      floatBtn.style.top = top + 'px';
    }
    requestAnimationFrame(placeFloat);
  }

  function showFloat() {
    if (!floatBtn) buildFloat();
    if (floatVisible) return;
    floatVisible = true;
    requestAnimationFrame(placeFloat);
  }

  function hideFloat() {
    floatVisible = false;
    if (floatBtn) floatBtn.hidden = true;
  }

  function isCommentEditor(path) {
    const t = path[0];
    if (!(t instanceof HTMLElement)) return false;
    if (!(t.isContentEditable || t.tagName === 'TEXTAREA')) return false;
    return path.some((n) => n.matches && n.matches(COMMENT_SELECTOR));
  }

  // Ao clicar em "Editar", o YouTube recria o contenteditable a partir do texto
  // publicado. Reidrata os links de GIF nesse novo editor como miniaturas inline.
  function hydrateEditorGifTokens(editor) {
    if (!editor || !editor.isContentEditable || editor.dataset.ytgifHydrating) return;
    editor.dataset.ytgifHydrating = '1';
    const urlRe = /(?:https?:\/\/)?(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/[^\s"'<>]+|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/[A-Za-z0-9]+/gi;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let changed = false;
    nodes.forEach((node) => {
      if (!node.parentElement || node.parentElement.closest('.ytgif-compose-token')) return;
      const source = node.nodeValue || '';
      const matches = [...source.matchAll(urlRe)];
      if (!matches.length) return;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      let found = false;
      matches.forEach((match) => {
        const url = resolveGifCandidate(match[0]);
        if (!url) return;
        fragment.append(source.slice(offset, match.index));
        fragment.append(makeComposeToken(url));
        offset = match.index + match[0].length;
        found = true;
      });
      if (!found) return;
      fragment.append(source.slice(offset));
      node.replaceWith(fragment);
      changed = true;
    });
    if (changed) editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const path = e.composedPath();
      if (path.includes(panel) || path.includes(floatBtn)) return;
      if (isCommentEditor(path)) {
        currentEditor = path[0];
        // Espera o YouTube preencher o editor após o clique em Editar.
        setTimeout(() => hydrateEditorGifTokens(currentEditor), 0);
        showFloat();
      }
    },
    true
  );

  document.addEventListener(
    'focusout',
    () => {
      setTimeout(() => {
        if (panelOpen()) return;
        const a = document.activeElement;
        if (a === currentEditor || a === floatBtn) return;
        hideFloat();
      }, 250);
    },
    true
  );

  /* ---------- Links de GIF viram imagem nos comentários ---------- */
  const GIF_RE = /^https?:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/\S+\.gif(\?\S*)?$/i;
  const GIF_HOSTS = '(?:media\\d*\\.giphy\\.com|i\\.giphy\\.com|media\\.tenor\\.com|c\\.tenor\\.com)';
  const GIF_FIND_SRC = '(?:https?:\\/\\/)?' + GIF_HOSTS + '\\/[^\\s"\'<>]+?\\.gif(?:\\?[^\\s"\'<>&]*)?';
  const GIF_FIND = new RegExp(GIF_FIND_SRC, 'i');
  const DIRECT_GIF_URL = /https?:\/\/(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?/i;

  function normUrl(u) {
    u = u.replace(/[.,;:!?)]+$/, '');
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  function directGifUrl(value) {
    let raw = String(value || '');
    try { raw = decodeURIComponent(raw); } catch (_) {}
    const match = raw.match(DIRECT_GIF_URL);
    return match ? normUrl(match[0]) : null;
  }

  // Cria uma imagem DOM normal. Nunca navega o frame do YouTube: o navegador
  // carrega o GIF diretamente pelo atributo src, que aceita apenas HTTP(S).
  function gifImg(url, cls, onInvalid) {
    const img = document.createElement('img');
    if (cls) img.className = cls;
    img.alt = 'Anexo de imagem do comentário';
    img.loading = 'lazy';
    if (typeof onInvalid === 'function') img.addEventListener('error', onInvalid, { once: true });
    if (/^https?:\/\//i.test(url)) img.src = url;
    return img;
  }

  // Mesma estrutura de imagem usada pelo YouTube nos comentários de vídeos
  // longos. Isso evita depender do layout específico dos Shorts.
  function postedGifImg(url, onInvalid) {
    const img = gifImg(
      url,
      'ytCoreImageHost ytwCommentImageAttachmentViewModelImage ytCoreImageContentModeScaleAspectFit',
      onInvalid
    );
    img.addEventListener('load', () => {
      img.classList.add('ytCoreImageLoaded');
      img.dataset.ytgifVerified = '1';
    }, { once: true });
    img.alt = 'Anexo de imagem do comentário';
    img.style.cssText = 'display:block;max-width:min(480px,100%);max-height:360px;width:auto;height:auto;object-fit:contain;border-radius:4px;margin:6px 0;';
    return img;
  }

  // Acha a URL do GIF no texto do link (que o YouTube mostra sem "https://") ou no href/redirect
  function resolveGifCandidate(value) {
    const raw = String(value || '').trim();
    const directUrl = directGifUrl(raw);
    if (directUrl) return directUrl;
    const direct = raw.match(GIF_FIND);
    if (direct) return normUrl(direct[0]);
    // Links to a GIPHY page are not direct .gif URLs. Convert known media IDs
    // to the direct animated GIF endpoint so the comment can render an <img>.
    const page = raw.match(/(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/(?:[^\s/?#]*-)?([A-Za-z0-9]+)(?:[/?#]|$)/i);
    if (page) return `https://media.giphy.com/media/${page[1]}/giphy.gif`;
    const media = raw.match(/(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/([A-Za-z0-9]+)/i);
    if (media) return `https://media.giphy.com/media/${media[1]}/giphy.gif`;
    return null;
  }

  function findGifUrl(a) {
    const cands = [a.textContent || '', a.getAttribute('href') || '', a.href || ''];
    // YouTube sometimes wraps external URLs in /redirect?q=... and encodes them.
    for (const raw of [...cands]) {
      try { cands.push(decodeURIComponent(raw)); } catch (_) {}
      try {
        const u = new URL(raw, location.href);
        for (const key of ['q', 'url', 'u', 'redirect_url']) {
          const value = u.searchParams.get(key);
          if (value) {
            cands.push(value);
            try { cands.push(decodeURIComponent(value)); } catch (_) {}
          }
        }
      } catch (_) {}
    }
    for (const c of cands) {
      const resolved = resolveGifCandidate(c);
      if (resolved) return resolved;
    }
    return null;
  }

  // Comentários de vídeo longo podem ser colocados pelo YouTube em Shadow DOM.
  // querySelectorAll(document) não entra nessas camadas, então percorremos também
  // cada shadowRoot aberto para localizar o link que acabou de ser publicado.
  function queryDeep(selector) {
    const found = new Set();
    const visited = new Set();
    const visit = (root) => {
      if (!root || visited.has(root)) return;
      visited.add(root);
      root.querySelectorAll(selector).forEach((element) => found.add(element));
      root.querySelectorAll('*').forEach((element) => {
        if (element.shadowRoot) visit(element.shadowRoot);
      });
    };
    visit(document);
    return [...found];
  }

  function closestComposed(element, selector) {
    let node = element;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches(selector)) return node;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }

  function replacePublishedGifLink(a, knownCommentLink) {
    if (a.dataset.ytgifRendered) return;
    if (closestComposed(a, '#ytgif-panel, .ytgif-preview, [contenteditable]')) return;
    if (!knownCommentLink) {
      const commentRoot = closestComposed(a,
        'ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer, ' +
        'yt-comment-view-model, yt-comment-thread-renderer, yt-reel-comments-overlay-renderer, ' +
        'yt-shorts-comment-renderer, #content-text, #comments, ytd-comments, ' +
        'ytd-engagement-panel-section-list-renderer'
      );
      if (!commentRoot) return;
    }
    const url = directGifUrl(a.textContent) || directGifUrl(a.getAttribute('href')) || findGifUrl(a);
    if (!url) return;
    const originalLink = a.cloneNode(true);
    const img = postedGifImg(url, () => {
      if (img.isConnected) img.replaceWith(originalLink);
    });
    const before = document.createElement('br');
    const after = document.createElement('br');
    before.className = 'ytgif-posted-break';
    after.className = 'ytgif-posted-break';
    a.before(before);
    a.replaceWith(img);
    img.after(after);
    console.log('[Nexus YouTube+] Link substituído por GIF:', url);
  }

  function renderGifLinks() {
    // Estrutura confirmada na página salva de vídeo longo: o link fica dentro de
    // yt-attributed-string#content-text[slot="content"]. Trata-a primeiro.
    queryDeep(
      'ytd-comment-view-model yt-attributed-string#content-text[slot="content"] a[href], ' +
      'ytd-comment-view-model yt-attributed-string#content-text a.ytAttributedStringLink[href]'
    ).forEach((a) => replacePublishedGifLink(a, true));

    queryDeep(
      '#comments a[href], ytd-comments a[href], ytd-comment-view-model a[href], ' +
      'ytd-comment-renderer a[href], ytd-comment-thread-renderer a[href], ' +
      'yt-comment-view-model a[href], yt-comment-thread-renderer a[href], ' +
      'ytd-engagement-panel-section-list-renderer a[href], ' +
      'ytd-item-section-renderer #contents ytd-comment-renderer a[href], ' +
      'yt-reel-comments-overlay-renderer a[href], yt-shorts-comment-renderer a[href], ' +
      '#content-text a[href], .yt-core-attributed-string a[href], ' +
      'yt-attributed-string a[href]'
    ).forEach((a) => replacePublishedGifLink(a, false));

    // URLs de GIF em texto puro (sem link)
    queryDeep(
        'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text, ytd-comment-thread-renderer #content-text, ytd-comment-view-model .yt-core-attributed-string, ytd-comment-renderer .yt-core-attributed-string, ytd-comment-thread-renderer .yt-core-attributed-string, ytd-comment-view-model yt-attributed-string, ytd-comment-renderer yt-attributed-string, ytd-comment-thread-renderer yt-attributed-string, #comments #content-text, yt-comment-view-model #content-text, yt-comment-thread-renderer #content-text, yt-comment-view-model, yt-comment-thread-renderer, yt-reel-comments-overlay-renderer, yt-shorts-comment-renderer'
      ).forEach((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((n) => {
          const par = n.parentElement;
          if (!par || par.closest('a') || par.closest('.ytgif-inline')) return;
          const t = n.nodeValue;
          // Match both direct .gif URLs and common GIPHY page URLs in plain text.
          const re = /(?:https?:\/\/)?(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/[^\s"'<>]+|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/[A-Za-z0-9]+/gi;
          const matches = [...t.matchAll(re)];
          if (!matches.length) return;
          const frag = document.createDocumentFragment();
          let last = 0;
          for (const m of matches) {
            const resolved = resolveGifCandidate(m[0]);
            if (!resolved) continue;
            frag.append(t.slice(last, m.index));
            const before = document.createElement('br');
            const inlineImg = postedGifImg(resolved);
            const after = document.createElement('br');
            before.className = after.className = 'ytgif-posted-break';
            frag.append(before, inlineImg, after);
            last = m.index + m[0].length;
          }
          if (last === 0) return;
          frag.append(t.slice(last));
          n.replaceWith(frag);
        });
      });
  }


  /* ---------- YouTube Plus: ferramentas extras locais ---------- */
  const YTP_KEY = 'ytgif-plus-state-v2';
  const ytpState = (() => { try { return JSON.parse(localStorage.getItem(YTP_KEY) || '{}'); } catch (_) { return {}; } })();
  const ytpGet = (k, fallback) => ytpState[k] === undefined ? fallback : ytpState[k];
  function ytpSave() { try { localStorage.setItem(YTP_KEY, JSON.stringify(ytpState)); } catch (_) {} }
  function ytpVideo() { return document.querySelector('ytd-player video.html5-main-video, #movie_player video, video.html5-main-video'); }
  function ytpToast(msg) {
    let el = document.getElementById('ytgif-plus-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ytgif-plus-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function ytpButton(label, title, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ytgif-plus-btn'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); }); return b;
  }
  function ytpCurrentId() { return new URL(location.href).searchParams.get('v') || location.pathname.split('/').filter(Boolean).pop() || 'unknown'; }
  function ytpLoadList(k) { try { const all = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(all) ? all : []; } catch (_) { return []; } }
  function ytpSaveList(k, value) { try { localStorage.setItem(k, JSON.stringify(value)); } catch (_) {} }
  function ytpBookmark() {
    const v = ytpVideo(); if (!v) return ytpToast('Vídeo não encontrado');
    const item = { id: ytpCurrentId(), title: document.title.replace(/\s*-\s*YouTube$/, ''), time: Math.floor(v.currentTime), url: location.href.split('&t=')[0], savedAt: Date.now() };
    const list = ytpLoadList('ytgif-plus-bookmarks'); list.unshift(item); ytpSaveList('ytgif-plus-bookmarks', list.slice(0, 300)); ytpToast(`Momento salvo: ${formatTime(item.time)}`);
  }
  function formatTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec/3600) ? Math.floor(sec/3600)+':' : ''}${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
  function ytpCapture() {
    const v = ytpVideo(); if (!v || !v.videoWidth) return ytpToast('O vídeo ainda não está pronto');
    try { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v,0,0); c.toBlob(blob => { if (!blob) return ytpToast('Não foi possível capturar este quadro'); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `youtube-${ytpCurrentId()}-${formatTime(v.currentTime).replace(/:/g,'-')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }, 'image/png'); } catch (_) { ytpToast('Captura bloqueada pelo navegador neste vídeo'); }
  }
  async function ytpPictureInPicture() {
    const v = ytpVideo();
    if (!v) return ytpToast('Vídeo não encontrado');
    try {
      if (document.pictureInPictureElement === v) { await document.exitPictureInPicture(); return; }
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      if (!document.pictureInPictureEnabled || typeof v.requestPictureInPicture !== 'function') {
        return ytpToast('Picture-in-Picture não é compatível com este vídeo ou navegador');
      }
      await v.requestPictureInPicture();
      ytpToast('Vídeo flutuante aberto. Arraste a janela PiP para qualquer área da tela.');
    } catch (error) {
      ytpToast('Não foi possível abrir o vídeo flutuante. Tente iniciar a reprodução primeiro.');
    }
  }
  function ytpTimer() {
    const raw = prompt('Parar a reprodução em quantos minutos? (0 cancela)', String(ytpGet('timerMinutes', 30)));
    if (raw === null) return; const mins = Number(raw);
    if (!Number.isFinite(mins) || mins < 0 || mins > 1440) return ytpToast('Digite um valor entre 0 e 1440');
    ytpState.timerMinutes = mins; ytpSave(); if (window.__ytgifStopTimer) clearTimeout(window.__ytgifStopTimer);
    if (!mins) return ytpToast('Temporizador cancelado');
    window.__ytgifStopTimer = setTimeout(() => { const v = ytpVideo(); if (v) v.pause(); ytpToast('Temporizador: reprodução pausada'); }, mins * 60000); ytpToast(`Temporizador definido: ${mins} min`);
  }
  function ytpCinema() { document.documentElement.classList.toggle('ytgif-plus-cinema'); const on = document.documentElement.classList.contains('ytgif-plus-cinema'); ytpState.cinema = on; ytpSave(); ytpToast(on ? 'Modo cinema ativado (Esc para sair)' : 'Modo cinema desativado'); }
  function ytpCustomize() {
    const accent = prompt('Cor de destaque (nome ou hexadecimal, ex. #3ea6ff):', ytpGet('accent', '#3ea6ff')); if (accent === null) return;
    const size = prompt('Tamanho dos controles (compacto, normal ou grande):', ytpGet('controlSize', 'normal')); if (size === null) return;
    const safeAccent = /^#[0-9a-f]{3,8}$/i.test(accent.trim()) || /^[a-z]{3,20}$/i.test(accent.trim()) ? accent.trim() : '#3ea6ff';
    ytpState.accent = safeAccent; ytpState.controlSize = ['compacto','normal','grande'].includes(size.toLowerCase()) ? size.toLowerCase() : 'normal'; ytpSave(); document.documentElement.style.setProperty('--ytgif-plus-accent', ytpState.accent); document.documentElement.dataset.ytgifPlusSize = ytpState.controlSize; ytpToast('Personalização salva');
  }
  function ytpFilterComments() {
    const words = prompt('Palavras para ocultar nos comentários, separadas por vírgula:', ytpGet('blockedWords', '').join(', ')); if (words === null) return;
    ytpState.blockedWords = words.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 50); ytpSave(); ytpApplyCommentFilters(); ytpToast('Filtro de comentários atualizado');
  }
  function ytpApplyCommentFilters() {
    if (!extensionConfig.enabled || !extensionConfig.commentTools) return;
    const words = ytpGet('blockedWords', []); if (!words.length) { document.querySelectorAll('[data-ytgif-filter-hidden="1"]').forEach(el => { el.hidden = false; delete el.dataset.ytgifFilterHidden; }); return; }
    document.querySelectorAll('ytd-comment-view-model, ytd-comment-renderer, yt-comment-view-model, yt-comment-thread-renderer').forEach(el => {
      const text = (el.innerText || '').toLowerCase(); const hide = words.some(w => w && text.includes(w)); el.hidden = hide; if (hide) el.dataset.ytgifFilterHidden = '1'; else delete el.dataset.ytgifFilterHidden;
    });
  }
  function ytpShowBookmarks() {
    const list = ytpLoadList('ytgif-plus-bookmarks'); if (!list.length) return ytpToast('Ainda não há momentos salvos');
    const chosen = prompt('Momentos salvos:\n' + list.slice(0, 20).map((x,i)=>`${i+1}. ${x.title} — ${formatTime(x.time)}`).join('\n') + '\n\nDigite o número para abrir:', '1');
    const idx = Number(chosen) - 1; if (chosen === null || !Number.isInteger(idx) || !list[idx]) return;
    const x = list[idx]; location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(x.id)}&t=${x.time}s`;
  }
  function ytpInjectToolbar() {
    if (!extensionConfig.enabled || !extensionConfig.plusToolbar) { const old=document.querySelector('.ytgif-plus-toolbar'); if(old) old.remove(); return; }
    const video = ytpVideo();
    if (!video) return;
    let panel = document.getElementById('ytgif-plus-floating-panel');
    let toggle = document.getElementById('ytgif-plus-floating-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'ytgif-plus-floating-toggle';
      toggle.type = 'button';
      toggle.textContent = '✦';
      toggle.title = 'Abrir ferramentas Nexus YouTube+';
      toggle.setAttribute('aria-label', 'Abrir ferramentas Nexus YouTube+');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const p = document.getElementById('ytgif-plus-floating-panel');
        if (!p) return;
        const open = p.hidden;
        p.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '×' : '✦';
        toggle.title = open ? 'Fechar ferramentas' : 'Abrir ferramentas Nexus YouTube+';
      });
      document.body.appendChild(toggle);
    }
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'ytgif-plus-floating-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Ferramentas do YouTube Plus');
      const heading = document.createElement('div');
      heading.className = 'ytgif-plus-panel-heading';
      heading.textContent = 'YouTube Plus';
      const bar = document.createElement('div');
      bar.className = 'ytgif-plus-toolbar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Ferramentas extras do YouTube');
      bar.append(
        ytpButton('−5s','Voltar 5 segundos',()=>{ const v=ytpVideo(); if(v)v.currentTime=Math.max(0,v.currentTime-5); }),
        ytpButton('+5s','Avançar 5 segundos',()=>{ const v=ytpVideo(); if(v)v.currentTime=Math.min(v.duration||Infinity,v.currentTime+5); }),
        ytpButton('1×','Velocidade de reprodução',()=>{ const v=ytpVideo(); if(!v)return; const speeds=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3]; const i=speeds.indexOf(v.playbackRate); v.playbackRate=speeds[(i+1)%speeds.length]; bar.querySelector('[aria-label="Velocidade de reprodução"]').textContent=v.playbackRate+'×'; ytpToast('Velocidade '+v.playbackRate+'×'); }),
        ytpButton('☆','Salvar momento exato',ytpBookmark),
        ytpButton('▣','Capturar quadro',ytpCapture),
        ytpButton('PiP','Abrir vídeo flutuante fora do Chrome',ytpPictureInPicture),
        ytpButton('▰','Modo cinema',ytpCinema),
        ytpButton('◷','Temporizador',ytpTimer),
        ytpButton('★','Momentos salvos',ytpShowBookmarks),
        ytpButton('⚙','Personalizar',ytpCustomize),
        ytpButton('☷','Filtrar comentários',ytpFilterComments)
      );
      panel.append(heading, bar);
      document.body.appendChild(panel);
    }
    const v = video;
    if (!v.dataset.ytgifHistoryBound) {
      v.dataset.ytgifHistoryBound = '1';
      v.addEventListener('timeupdate', () => {
        if (!v.duration || !Number.isFinite(v.currentTime)) return;
        const id = ytpCurrentId();
        const hist = ytpLoadList('ytgif-plus-history');
        const now = Date.now();
        const existing = hist.find(x => x.id === id);
        if (existing) { existing.time = Math.floor(v.currentTime); existing.duration = Math.floor(v.duration); existing.updatedAt = now; }
        else hist.unshift({ id, title: document.title.replace(/\s*-\s*YouTube$/, ''), url: location.href, time: Math.floor(v.currentTime), duration: Math.floor(v.duration), updatedAt: now });
        ytpSaveList('ytgif-plus-history', hist.slice(0, 100));
      }, { passive: true });
    }
  }
  function ytpKeyboard(e) {
    if (!extensionConfig.shortcuts) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t=e.target; if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
    const v=ytpVideo(); if (!v) return;
    if (e.key==='[') { v.currentTime=Math.max(0,v.currentTime-5); }
    else if (e.key===']') { v.currentTime=Math.min(v.duration||Infinity,v.currentTime+5); }
    else if (e.key.toLowerCase()==='b') { e.preventDefault(); ytpBookmark(); }
    else if (e.key.toLowerCase()==='c') { e.preventDefault(); ytpCapture(); }
    else if (e.key.toLowerCase()==='m') { e.preventDefault(); ytpCinema(); }
    else if (e.key.toLowerCase()==='j' && e.shiftKey) { e.preventDefault(); ytpShowBookmarks(); }
    else if (e.key==='Escape' && document.documentElement.classList.contains('ytgif-plus-cinema')) { document.documentElement.classList.remove('ytgif-plus-cinema'); ytpState.cinema=false; ytpSave(); }
  }
  document.addEventListener('keydown', ytpKeyboard, true);
  if (ytpGet('cinema', false)) document.documentElement.classList.add('ytgif-plus-cinema');
  if (ytpGet('accent', null)) document.documentElement.style.setProperty('--ytgif-plus-accent', ytpState.accent);
  if (ytpGet('controlSize', null)) document.documentElement.dataset.ytgifPlusSize = ytpState.controlSize;
  setInterval(() => { try { ytpInjectToolbar(); ytpApplyCommentFilters(); } catch (_) {} }, 1200);


  /* ---------- Atalho de configurações no fim da barra lateral ---------- */
  function injectSettingsSidebarEntry() {
    if (!extensionConfig.enabled) {
      document.querySelectorAll('.ytgif-sidebar-settings, #ytgif-settings-fallback').forEach(el => el.remove());
      return;
    }
    if (document.querySelector('.ytgif-sidebar-settings')) return;

    const guide = document.querySelector('ytd-guide-renderer');
    const sections = guide ? [...guide.querySelectorAll('ytd-guide-section-renderer #items')].filter(el => el.isConnected) : [];
    const host = sections.find(el => el.querySelector('ytd-guide-entry-renderer')) ||
      (guide && (guide.querySelector('#sections') || guide.querySelector('#items')));

    const openSettings = (event) => {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      // Content scripts não podem abrir a página de opções diretamente.
      // Solicite ao service worker para abrir a página, evitando o bloqueio do Chrome.
      try {
        chrome.runtime.sendMessage({ type: 'open-options' }, () => {
          // Leia lastError para evitar avisos no console se a extensão estiver sendo recarregada.
          const error = chrome.runtime.lastError;
          if (error) console.warn('[Nexus YouTube+] Não foi possível abrir configurações:', error.message);
        });
      } catch (error) {
        console.warn('[Nexus YouTube+] Falha ao solicitar abertura das configurações:', error);
      }
    };

    if (host) {
      const nativeEntry = [...guide.querySelectorAll('ytd-guide-entry-renderer')].find(entry => {
        const title = entry.querySelector('#title, yt-formatted-string');
        return title && title.textContent.trim().toLowerCase() === 'shorts';
      });
      if (nativeEntry) {
        const item = nativeEntry.cloneNode(true);
        item.classList.add('ytgif-sidebar-settings');
        item.removeAttribute('selected');
        const link = item.querySelector('a[href], #endpoint');
        if (link) {
          link.href = '#';
          link.setAttribute('aria-label', 'Configurações da extensão');
          link.setAttribute('title', 'Configurações da extensão');
          link.removeAttribute('aria-current');
          link.addEventListener('click', openSettings);
        } else {
          item.addEventListener('click', openSettings);
        }
        const title = item.querySelector('#title, yt-formatted-string');
        if (title) title.textContent = 'Configurações';
        const icon = item.querySelector('#icon, yt-icon');
        if (icon) icon.innerHTML = '<span class="ytgif-settings-gear" aria-hidden="true">⚙</span>';
        item.setAttribute('title', 'Abrir configurações do Nexus YouTube+');
        item.addEventListener('click', openSettings);
        host.appendChild(item);
        return;
      }
    }

    // Fallback garantido: aparece no canto inferior esquerdo caso o YouTube mude a estrutura da guia.
    const fallback = document.createElement('button');
    fallback.id = 'ytgif-settings-fallback';
    fallback.type = 'button';
    fallback.innerHTML = '<span aria-hidden="true">⚙</span><span>Configurações</span>';
    fallback.title = 'Abrir configurações do Nexus YouTube+';
    fallback.addEventListener('click', openSettings);
    document.body.appendChild(fallback);
  }

  /* ---------- Ocultar atalhos durante vídeo longo em tela cheia ---------- */
  function updateLongVideoFullscreenState() {
    const player = document.querySelector('#movie_player');
    const isLongVideoPage = location.pathname.startsWith('/watch') &&
      !!document.querySelector('ytd-watch-flexy') &&
      !document.querySelector('ytd-reel-video-renderer, ytd-shorts');
    const isFullscreen = !!(document.fullscreenElement ||
      (player && player.classList.contains('ytp-fullscreen')) ||
      document.querySelector('ytd-watch-flexy[fullscreen], ytd-watch-flexy[fullscreen="true"]'));
    document.documentElement.classList.toggle('nexus-long-video-fullscreen', isLongVideoPage && isFullscreen);
  }

  // A troca de tela cheia do player altera classes, não necessariamente o DOM.
  // Observar esses atributos mantém os atalhos ocultos mesmo quando o YouTube não
  // dispara o evento nativo fullscreenchange.
  new MutationObserver(updateLongVideoFullscreenState).observe(document.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class', 'fullscreen']
  });
  document.addEventListener('fullscreenchange', updateLongVideoFullscreenState, true);
  document.addEventListener('webkitfullscreenchange', updateLongVideoFullscreenState, true);
  window.addEventListener('yt-navigate-finish', updateLongVideoFullscreenState, true);


  /* ---------- Aviso central de atualização do Nexus YouTube+ ---------- */
  let nexusUpdateDialog = null;
  function closeNexusUpdateDialog() {
    if (nexusUpdateDialog) nexusUpdateDialog.remove();
    nexusUpdateDialog = null;
  }
  function showNexusUpdateDialog(status) {
    if (!status || !status.updateAvailable || nexusUpdateDialog || document.getElementById('nexus-update-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'nexus-update-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:2147483647','display:flex',
      'align-items:center','justify-content:center','padding:24px',
      'background:rgba(0,0,0,.72)','backdrop-filter:blur(5px)',
      'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
    ].join(';');
    const card = document.createElement('section');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'nexus-update-title');
    card.style.cssText = [
      'box-sizing:border-box','width:min(460px,100%)','padding:28px',
      'border:1px solid rgba(120,170,255,.34)','border-radius:22px',
      'background:linear-gradient(145deg,#151d2c,#0c111b)',
      'color:#f5f7fb','box-shadow:0 24px 90px rgba(0,0,0,.65)',
      'text-align:left'
    ].join(';');
    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'NEXUS YOUTUBE+';
    eyebrow.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:2px;color:#82b7ff;margin-bottom:12px';
    const title = document.createElement('h2');
    title.id = 'nexus-update-title';
    title.textContent = 'Novo update da extensão';
    title.style.cssText = 'font-size:25px;line-height:1.2;margin:0 0 12px;font-weight:750;color:#fff';
    const message = document.createElement('p');
    message.textContent = 'Uma nova versão do Nexus YouTube+ está disponível.';
    message.style.cssText = 'font-size:15px;line-height:1.55;color:#d5dbea;margin:0 0 12px';
    const version = document.createElement('div');
    version.textContent = 'Nova versão: ' + String(status.latestVersion || 'disponível') + '  ·  Instalada: ' + String(status.currentVersion || chrome.runtime.getManifest().version);
    version.style.cssText = 'font-size:13px;color:#aebbd0;margin-bottom:24px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end';
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'Mais tarde';
    later.style.cssText = 'border:1px solid #3a4558;background:#202a3a;color:#e7edf8;padding:12px 17px;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer';
    later.addEventListener('click', () => {
      send({ type: 'nexus-update-later' });
      closeNexusUpdateDialog();
    });
    const update = document.createElement('button');
    update.type = 'button';
    update.textContent = 'Atualizar';
    update.style.cssText = 'border:0;background:linear-gradient(135deg,#4f9cff,#3477f6);color:#fff;padding:12px 19px;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 5px 18px rgba(52,119,246,.3)';
    update.addEventListener('click', () => {
      send({ type: 'nexus-open-update-page' });
      closeNexusUpdateDialog();
    });
    actions.append(later, update);
    card.append(eyebrow, title, message, version, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        send({ type: 'nexus-update-later' });
        closeNexusUpdateDialog();
      }
    });
    document.addEventListener('keydown', function onEscape(event) {
      if (event.key === 'Escape' && nexusUpdateDialog === overlay) {
        document.removeEventListener('keydown', onEscape);
        send({ type: 'nexus-update-later' });
        closeNexusUpdateDialog();
      }
    }, { once: true });
    document.documentElement.appendChild(overlay);
    nexusUpdateDialog = overlay;
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'nexus-show-update-prompt') showNexusUpdateDialog(message.status);
  });
  send({ type: 'nexus-get-update-status' }).then((result) => {
    if (result && result.show && result.status) showNexusUpdateDialog(result.status);
  });

  /* ---------- Observador (YouTube é uma SPA) ---------- */
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectSportsTab();
      injectMiniSportsTab();
      injectSettingsSidebarEntry();
      clearSportsSearchField();
      injectButtons();
      renderGifLinks();
      ytpInjectToolbar();
      ytpApplyCommentFilters();
      updateLongVideoFullscreenState();
    }, 400);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('yt-navigate-finish', () => {
    closePanel();
    schedule();
  });
  schedule();
  setInterval(() => {
    try { renderGifLinks(); } catch (_) {}
  }, 1500);

  /* ---------- Luz ambiente dinâmica (efeito Ambilight leve) ---------- */
  const ambientPlayers = new WeakMap();
  function setupAmbientLight() {
    const enabled = !!extensionConfig.ambientLight;
    document.querySelectorAll('#movie_player').forEach((player) => {
      let canvas = player.querySelector(':scope > .nexus-ambient-canvas');
      if (!enabled) {
        if (canvas) { canvas.dataset.stop = '1'; canvas.remove(); }
        return;
      }
      if (canvas) return;
      const video = player.querySelector('video');
      if (!video) return;
      canvas = document.createElement('canvas');
      canvas.className = 'nexus-ambient-canvas';
      canvas.width = 96;
      canvas.height = 54;
      canvas.setAttribute('aria-hidden', 'true');
      player.insertBefore(canvas, player.firstChild);
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      let raf = 0;
      const draw = () => {
        if (!canvas.isConnected || canvas.dataset.stop === '1' || !extensionConfig.ambientLight) {
          if (raf) cancelAnimationFrame(raf);
          canvas.remove();
          return;
        }
        if (!document.hidden && video.readyState >= 2 && !video.paused && !video.ended) {
          try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (_) {}
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    });
  }
  let ambientScanTimer = setInterval(setupAmbientLight, 900);
  document.addEventListener('visibilitychange', setupAmbientLight);
(() => {
  'use strict';
  console.log('[Nexus YouTube+] extensão carregada');

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r || { error: 'Sem resposta da extensão' }));
      } catch (e) {
        resolve({ error: 'Extensão recarregada. Atualize a página (F5).' });
      }
    });

  const COMMENT_SELECTOR =
    'ytd-commentbox, ytd-comment-simplebox-renderer, ytd-comments, #comments, ' +
    'ytd-engagement-panel-section-list-renderer, ytd-comment-thread-renderer, ytd-comment-view-model, ' +
    'ytd-comment-renderer, yt-comment-view-model, yt-comment-thread-renderer, ' +
    'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text, ' +
    'ytd-comment-thread-renderer #content-text, #content-text, .yt-core-attributed-string';

  let panel, searchInput, bodyEl, cols, statusEl, footEl, floatBtn;
  let currentEditor = null;
  let editorRange = null;
  let anchorEl = null;
  let query = '';
  let nextPos = '';
  let loading = false;
  let reqId = 0;
  let heights = [0, 0];
  let debounce;
  let floatVisible = false;
  let sportsMenu;
  let sportsHideTimer;

  const extensionConfig = { enabled: true, gifButton: true, plusToolbar: true, shortcuts: true, commentTools: true,
    backgroundColor: '#0f0f0f', backgroundImage: '', backgroundOpacity: 25, backgroundTarget: 'main', compactPanel: false,
    cleanShortsNav: false, cleanShortsShelves: false, cleanCommunityShelves: false,
    cleanCommerceButtons: false, cleanComments: false, cleanEndscreen: false, ambientLight: false, ambientIntensity: 65 };
  function applyExtensionConfig(config) {
    Object.assign(extensionConfig, config || {});
    const root = document.documentElement;
    root.classList.toggle('ytgif-extension-disabled', !extensionConfig.enabled);
    root.classList.toggle('ytgif-hide-gif-button', !extensionConfig.gifButton);
    root.classList.toggle('ytgif-hide-plus-toolbar', !extensionConfig.plusToolbar);
    root.classList.toggle('ytgif-disable-comment-tools', !extensionConfig.commentTools);
    root.classList.toggle('ytgif-compact-panel', !!extensionConfig.compactPanel);
    root.classList.toggle('ytgif-clean-shorts-nav', !!extensionConfig.cleanShortsNav);
    root.classList.toggle('ytgif-clean-shorts-shelves', !!extensionConfig.cleanShortsShelves);
    root.classList.toggle('ytgif-clean-community-shelves', !!extensionConfig.cleanCommunityShelves);
    root.classList.toggle('ytgif-clean-commerce', !!extensionConfig.cleanCommerceButtons);
    root.classList.toggle('ytgif-clean-comments', !!extensionConfig.cleanComments);
    root.classList.toggle('ytgif-clean-endscreen', !!extensionConfig.cleanEndscreen);
    root.classList.toggle('nexus-ambient-enabled', !!extensionConfig.ambientLight);
    root.style.setProperty('--nexus-ambient-opacity', String(Math.max(0.2, Math.min(1, Number(extensionConfig.ambientIntensity || 65) / 100))));
    const color = /^#[0-9a-f]{3,8}$/i.test(extensionConfig.backgroundColor || '') ? extensionConfig.backgroundColor : '#0f0f0f';
    const image = typeof extensionConfig.backgroundImage === 'string' ? extensionConfig.backgroundImage.trim() : '';
    const opacity = Math.max(0, Math.min(100, Number(extensionConfig.backgroundOpacity) || 0)) / 100;
    let safeUrl = '';
    try { const u = new URL(image); if (u.protocol === 'https:' || u.protocol === 'http:') safeUrl = u.href.replace(/[()\\\\"']/g, ''); } catch (_) {}
    root.style.setProperty('--ytgif-custom-background', color);
    root.style.setProperty('--ytgif-custom-bg-image', safeUrl ? `linear-gradient(rgba(15,15,15,${1-opacity}), rgba(15,15,15,${1-opacity})), url("${safeUrl}")` : 'none');
    root.classList.toggle('ytgif-custom-bg-all', extensionConfig.backgroundTarget === 'all');
    root.classList.toggle('ytgif-custom-bg-main', extensionConfig.backgroundTarget !== 'all');
    syncPageBackgroundLayer(color, safeUrl ? `linear-gradient(rgba(15,15,15,${1-opacity}), rgba(15,15,15,${1-opacity})), url("${safeUrl}")` : 'none');
    document.querySelectorAll('.ytgif-sidebar-settings').forEach(el => { if (!extensionConfig.enabled) el.remove(); });
  }

  // O YouTube mistura diversos contêineres e, em algumas telas, não deixa um
  // fundo editável. Esta camada fica fixa atrás da interface inteira, enquanto
  // todos os controles e vídeos continuam acima dela.
  function syncPageBackgroundLayer(color, backgroundImage) {
    if (!document.body) return;
    let layer = document.getElementById('ytgif-page-background-layer');
    if (!extensionConfig.enabled) {
      if (layer) layer.remove();
      document.documentElement.classList.remove('ytgif-page-background-active');
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'ytgif-page-background-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    layer.style.backgroundColor = color;
    layer.style.backgroundImage = backgroundImage;
    document.documentElement.classList.add('ytgif-page-background-active');
  }
  try {
    chrome.storage.sync.get(extensionConfig, applyExtensionConfig);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const patch = {};
      Object.keys(changes).forEach(k => patch[k] = changes[k].newValue);
      applyExtensionConfig(patch);
    });
  } catch (_) {}

  /* ---------- Painel de GIFs ---------- */
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ytgif-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ytgif-head">
        <input type="text" class="ytgif-search" placeholder="Pesquisar GIFs ou colar link" autocomplete="off" spellcheck="false">
        <button type="button" class="ytgif-tools-toggle" title="Ferramentas Plus">Plus</button>
        <button type="button" class="ytgif-close" title="Fechar">✕</button>
      </div>
      <div class="ytgif-body">
        <div class="ytgif-cols"><div class="ytgif-col"></div><div class="ytgif-col"></div></div>
        <div class="ytgif-status"></div>
      </div>
      <div class="ytgif-foot"></div>
      <section class="ytgif-plus-tools" hidden>
        <div class="ytgif-plus-title">YouTube Plus</div>
        <div class="ytgif-plus-grid">
          <button data-plus="queue">Fila inteligente</button>
          <button data-plus="clean">Limpeza visual</button>
          <button data-plus="stats">Estatísticas</button>
          <button data-plus="repeat">Repetir últimos 10 s</button>
          <button data-plus="shorts">Modo Shorts</button>
          <button data-plus="audio">Áudio +</button>
          <button data-plus="export">Exportar dados</button>
          <button data-plus="diagnostics">Diagnóstico</button>
        </div>
        <div class="ytgif-plus-status" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(panel);

    searchInput = panel.querySelector('.ytgif-search');
    const plusTools = panel.querySelector('.ytgif-plus-tools');
    const plusStatus = panel.querySelector('.ytgif-plus-status');
    panel.querySelector('.ytgif-tools-toggle').addEventListener('click', () => {
      plusTools.hidden = !plusTools.hidden;
    });
    const plusSay = (message) => { plusStatus.textContent = message; };
    const readData = () => {
      try { return JSON.parse(localStorage.getItem('ytgifPlusData') || '{}'); } catch (_) { return {}; }
    };
    const saveData = (data) => localStorage.setItem('ytgifPlusData', JSON.stringify(data));
    const videoNow = () => document.querySelector('video.html5-main-video, ytd-player video, video');
    const videoKey = () => location.pathname + location.search;
    panel.querySelectorAll('[data-plus]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.plus;
      const data = readData();
      if (action === 'queue') {
        const links = [...document.querySelectorAll('a#video-title, a[href*="/watch"], a[href*="/shorts/"]')]
          .filter(a => a.href && a.querySelector('yt-img-shadow, img') && !a.href.includes('list='))
          .map(a => ({title:(a.textContent || a.getAttribute('title') || 'Vídeo').trim(), url:a.href}))
          .filter((item, i, arr) => arr.findIndex(x => x.url === item.url) === i).slice(0, 30);
        data.queue = links; saveData(data);
        plusSay('Fila salva: ' + links.length + ' vídeos encontrados nesta página.');
      } else if (action === 'clean') {
        document.documentElement.classList.toggle('ytgif-plus-clean');
        plusSay(document.documentElement.classList.contains('ytgif-plus-clean') ? 'Limpeza visual ativada. Clique novamente para restaurar.' : 'Visual original restaurado.');
      } else if (action === 'stats') {
        const stats = data.stats || {};
        stats[videoKey()] = {title: document.title, seconds: Math.floor((videoNow() || {}).currentTime || 0), updated: new Date().toISOString()};
        data.stats = stats; saveData(data);
        plusSay('Estatísticas locais: ' + Object.keys(stats).length + ' vídeos registrados.');
      } else if (action === 'repeat') {
        const v = videoNow();
        if (!v) return plusSay('Nenhum vídeo encontrado.');
        const end = v.currentTime, start = Math.max(0, end - 10);
        v.currentTime = start;
        const handler = () => { if (v.currentTime >= end) v.currentTime = start; };
        v.addEventListener('timeupdate', handler);
        plusSay('Repetindo o trecho de 10 segundos. Clique novamente para parar.');
        button.dataset.repeatActive = '1';
        button.onclick = () => { v.removeEventListener('timeupdate', handler); button.onclick = null; delete button.dataset.repeatActive; plusSay('Repetição desativada.'); };
      } else if (action === 'shorts') {
        document.documentElement.classList.toggle('ytgif-plus-shorts');
        plusSay(document.documentElement.classList.contains('ytgif-plus-shorts') ? 'Modo Shorts ativado.' : 'Modo Shorts desativado.');
      } else if (action === 'audio') {
        const v = videoNow();
        if (!v) return plusSay('Nenhum vídeo encontrado.');
        v.volume = v.volume >= 1 ? 0.7 : Math.min(1, v.volume + 0.2);
        plusSay('Volume do vídeo: ' + Math.round(v.volume * 100) + '%. O limite do elemento é 100%.');
      } else if (action === 'export') {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'youtube-plus-dados.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
        plusSay('Exportação iniciada.');
      } else if (action === 'diagnostics') {
        const v = videoNow();
        plusSay('Diagnóstico: vídeo=' + Boolean(v) + ', Shorts=' + location.pathname.includes('/shorts/') + ', painel=' + Boolean(panel) + ', versão 2.1.0.');
      }
    }));
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); if (panel.hidden) openPanel(floatBtn || document.body, currentEditor); else closePanel(); }
      if (e.altKey && e.key === 'ArrowRight') { const v=videoNow(); if(v) v.currentTime += 5; }
      if (e.altKey && e.key === 'ArrowLeft') { const v=videoNow(); if(v) v.currentTime = Math.max(0,v.currentTime-5); }
    });

    bodyEl = panel.querySelector('.ytgif-body');
    cols = [...panel.querySelectorAll('.ytgif-col')];
    statusEl = panel.querySelector('.ytgif-status');
    footEl = panel.querySelector('.ytgif-foot');

    panel.querySelector('.ytgif-close').addEventListener('click', closePanel);

    ['keydown', 'keypress', 'keyup'].forEach((ev) =>
      searchInput.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'keydown' && e.key === 'Escape') closePanel();
      })
    );

    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        query = searchInput.value.trim();
        load(true);
      }, 350);
    });

    bodyEl.addEventListener('scroll', () => {
      if (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 200) load(false);
    });

    statusEl.addEventListener('click', (e) => {
      if (e.target.closest('.ytgif-opts')) {
        e.preventDefault();
        send({ type: 'open-options' });
      }
    });

    panel.addEventListener('mousedown', (e) => {
      if (e.target !== searchInput) e.preventDefault();
    });
  }

  function setStatus(html) {
    statusEl.innerHTML = html || '';
  }

  function linkToGif(q) {
    q = (q || '').trim();
    if (!/^https?:\/\//i.test(q)) return null;
    if (GIF_RE.test(q)) return q;
    const m =
      q.match(/giphy\.com\/(?:gifs|stickers)\/(?:[^\/?#]*-)?([A-Za-z0-9]+)(?:[\/?#]|$)/i) ||
      q.match(/giphy\.com\/(?:media|embed)\/([A-Za-z0-9]+)/i);
    return m ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : null;
  }

  async function load(reset) {
    if (reset) {
      reqId++;
      nextPos = '';
      heights = [0, 0];
      cols.forEach((c) => (c.innerHTML = ''));
      const direct = linkToGif(query);
      if (direct) {
        addItem({ id: 'link', title: 'GIF do link', preview: direct, url: direct, w: 1, h: 1 });
        nextPos = null;
        loading = false;
        setStatus('Clique no GIF para adicionar.');
        footEl.textContent = '';
        return;
      }
    } else if (loading || nextPos === null) {
      return;
    }
    const my = reqId;
    loading = true;
    setStatus('Carregando…');

    const r = await send({ type: 'gif-search', query, pos: nextPos || '' });
    if (my !== reqId) return;
    loading = false;

    if (r.error) {
      if (r.error === 'NO_KEY') {
        setStatus('A pesquisa automática pode estar indisponível. Cole um link direto de GIF (.gif) ou um link de página do GIPHY.');
      } else {
        setStatus('Erro: ' + r.error);
      }
      nextPos = null;
      return;
    }

    r.items.forEach(addItem);
    nextPos = r.next;
    setStatus(!r.items.length && !cols[0].children.length ? 'Nenhum GIF encontrado. Tente outra palavra ou cole um link de GIF.' : '');
    footEl.textContent = r.provider === 'tenor' ? 'via Tenor' : 'via GIPHY';

    if (nextPos && bodyEl.scrollHeight <= bodyEl.clientHeight + 50) load(false);
  }

  function addItem(g) {
    const img = document.createElement('img');
    img.className = 'ytgif-item';
    img.src = g.preview;
    img.alt = g.title;
    img.title = g.title;
    img.loading = 'lazy';
    if (g.w > 1) img.style.aspectRatio = `${g.w} / ${g.h}`;
    img.addEventListener('click', () => pick(g));
    const i = heights[0] <= heights[1] ? 0 : 1;
    heights[i] += g.h / g.w;
    cols[i].appendChild(img);
  }

  function makeComposeToken(url) {
    const token = document.createElement('span');
    token.className = 'ytgif-compose-token';
    token.contentEditable = 'false';
    token.dataset.ytgifUrl = url;
    token.title = 'GIF — clique para remover';
    const img = gifImg(url, 'ytgif-compose-img');
    const text = document.createElement('span');
    // O texto continua no comentário enviado ao YouTube, mas fica invisível enquanto
    // a pessoa escreve. Assim, a extensão não depende de conteúdo que o YouTube
    // possa descartar ao publicar.
    text.className = 'ytgif-hidden-link';
    text.textContent = url;
    token.append(img, text);
    token.addEventListener('mousedown', (e) => e.preventDefault());
    token.addEventListener('click', (e) => {
      e.preventDefault();
      const editor = token.closest('[contenteditable="true"]');
      token.remove();
      if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return token;
  }

  function selectionIn(editor) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return range;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function rememberEditorRange(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) editorRange = range.cloneRange();
  }

  function insertGifAtSelection(url) {
    const ed = currentEditor;
    if (!ed || !document.contains(ed)) return;
    ed.focus();
    if (!ed.isContentEditable) {
      ed.value += (ed.value ? ' ' : '') + url;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const range = editorRange && ed.contains(editorRange.commonAncestorContainer)
      ? editorRange.cloneRange()
      : selectionIn(ed);
    editorRange = null;
    range.deleteContents();
    const token = makeComposeToken(url);
    range.insertNode(token);
    // Se o GIF foi colocado no meio ou ao lado de palavras, separa-o
    // automaticamente. Espaços já existentes são mantidos como estão.
    const left = token.previousSibling;
    const right = token.nextSibling;
    if (left && left.nodeType === Node.TEXT_NODE && left.nodeValue && !/\s$/.test(left.nodeValue)) {
      token.before(document.createTextNode(' '));
    }
    if (right && right.nodeType === Node.TEXT_NODE && right.nodeValue && !/^\s/.test(right.nodeValue)) {
      token.after(document.createTextNode(' '));
    }
    const caret = document.createRange();
    caret.setStartAfter(token);
    caret.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(caret);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pick(g) {
    insertGifAtSelection(g.url);
    closePanel();
  }

  // O editor de comentários de vídeos longos pode enviar innerText e ignorar
  // conteúdo visualmente oculto. Pouco antes do envio, convertemos cada token
  // para sua URL real; assim o servidor recebe o link e o renderizador local
  // consegue transformá-lo novamente em GIF após publicar.
  function expandGifTokensForPost(scope) {
    if (!scope) return false;
    const root = scope.nodeType === Node.ELEMENT_NODE ? scope : null;
    if (!root) return false;
    const tokens = [];
    if (root.matches && root.matches('.ytgif-compose-token[data-ytgif-url]')) tokens.push(root);
    if (root.querySelectorAll) tokens.push(...root.querySelectorAll('.ytgif-compose-token[data-ytgif-url]'));
    let changed = false;
    tokens.forEach((token) => {
      const url = token.dataset.ytgifUrl;
      if (!url) return;
      token.replaceWith(document.createTextNode(url));
      changed = true;
    });
    if (changed) {
      const editor = root.matches && root.matches('[contenteditable="true"], textarea, input')
        ? root
        : root.querySelector('[contenteditable="true"], textarea, input');
      if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return changed;
  }

  function findGifComposeScope(node) {
    if (!node || !node.closest) return null;
    const editor = node.closest('[contenteditable="true"], textarea, input');
    if (editor && editor.querySelector && editor.querySelector('.ytgif-compose-token[data-ytgif-url]')) return editor;
    const selectors = [
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer',
      'ytd-comment-dialog-renderer',
      'ytd-backstage-post-dialog-renderer',
      'ytd-backstage-post-thread-renderer',
      'ytd-backstage-post-renderer',
      'ytd-post-renderer',
      'ytd-comments',
      'ytd-app'
    ];
    for (const selector of selectors) {
      const scope = node.closest(selector);
      if (scope && scope.querySelector && scope.querySelector('.ytgif-compose-token[data-ytgif-url]')) return scope;
    }
    return editor;
  }

  function expandTokensBeforeSubmit(node) {
    const scope = findGifComposeScope(node);
    if (!scope) return false;
    const changed = expandGifTokensForPost(scope);
    if (changed) {
      // O YouTube pode atualizar o DOM em mais de uma etapa depois do envio.
      setTimeout(() => { try { renderGifLinks(); } catch (_) {} }, 700);
      setTimeout(() => { try { renderGifLinks(); } catch (_) {} }, 1800);
    }
    return changed;
  }

  // Abrange comentários de vídeos, respostas, diálogos de comentários e
  // compositores de publicações da Comunidade que reutilizam os tokens GIF.
  document.addEventListener('click', (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    const submit = path.find((node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = node.tagName;
      if (tag !== 'BUTTON' && tag !== 'YTD-BUTTON-RENDERER' && tag !== 'TP-YT-PAPER-BUTTON') return false;
      const label = [
        node.id, node.getAttribute('aria-label'), node.getAttribute('title'),
        node.textContent, node.getAttribute('data-tooltip-text')
      ].filter(Boolean).join(' ').toLowerCase();
      return node.id === 'submit-button' ||
        /\b(comment|reply|respond|post|publicar|comentar|responder)\b/.test(label);
    }) || (event.target.closest && event.target.closest('#submit-button'));
    if (submit) expandTokensBeforeSubmit(submit);
  }, true);

  document.addEventListener('submit', (event) => {
    expandTokensBeforeSubmit(event.target);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const editor = event.target.closest && event.target.closest('[contenteditable="true"], textarea, input');
    if (editor) expandTokensBeforeSubmit(editor);
  }, true);

  function openPanel(anchor, editor) {
    if (!panel) buildPanel();
    anchorEl = anchor;
    if (editor) {
      currentEditor = editor;
      rememberEditorRange(editor);
    }
    const r = anchor.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 20);
    const h = Math.min(420, window.innerHeight - 20);
    let left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 6);
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
    panel.hidden = false;
    searchInput.value = '';
    query = '';
    load(true);
    searchInput.focus();
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  const panelOpen = () => panel && !panel.hidden;

  document.addEventListener(
    'click',
    (e) => {
      if (!panelOpen()) return;
      const path = e.composedPath();
      if (path.includes(panel) || path.some((n) => n.classList && n.classList.contains('ytgif-btn'))) return;
      closePanel();
    },
    true
  );

  function makeButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytgif-btn';
    btn.title = 'Adicionar GIF';
    btn.setAttribute('aria-label', 'Adicionar GIF');
    btn.textContent = 'GIF';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    return btn;
  }

  function trophyIconMarkup() {
    return '<svg class="ytgif-sports-trophy" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g></svg>';
  }

  function buildSportsMenu() {
    if (sportsMenu) return sportsMenu;
    sportsMenu = document.createElement('div');
    sportsMenu.id = 'ytgif-sports-menu';
    sportsMenu.hidden = true;
    sportsMenu.innerHTML = [
      ['⚽', 'Futebol', 'futebol'],
      ['🏀', 'Basquete', 'basquete'],
      ['🏐', 'Vôlei', 'volei'],
      ['🏎️', 'Fórmula 1', 'formula 1'],
      ['🥊', 'MMA', 'mma'],
      ['🎾', 'Tênis', 'tenis'],
      ['⚾', 'Beisebol', 'beisebol'],
      ['🏈', 'Futebol americano', 'futebol americano'],
      ['🏉', 'Rúgbi', 'rugby'],
      ['🏸', 'Badminton', 'badminton'],
      ['🏓', 'Tênis de mesa', 'tenis de mesa'],
      ['🥋', 'Judô', 'judo'],
      ['🥋', 'Taekwondo', 'taekwondo'],
      ['🏊', 'Natação', 'natacao'],
      ['🚴', 'Ciclismo', 'ciclismo'],
      ['🏋️', 'Levantamento de peso', 'levantamento de peso']
    ].map(([icon, label, query]) =>
      '<a href="/results?search_query=' + encodeURIComponent(query) + '" data-query="' + query + '"><span>' + icon + '</span>' + label + '</a>'
    ).join('');
    sportsMenu.querySelectorAll('a[data-query]').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        const query = item.getAttribute('data-query') || '';
        // Use the selected category for results, but keep YouTube's visible search field empty.
        const target = new URL('/results', location.origin);
        target.searchParams.set('search_query', query);
        location.assign(target.href);
        try {
          sessionStorage.setItem('ytgif-clear-search-after-sports', '1');
        } catch (_) {}
      });
    });
    sportsMenu.addEventListener('mouseenter', () => clearTimeout(sportsHideTimer));
    sportsMenu.addEventListener('mouseleave', hideSportsMenuSoon);
    document.body.appendChild(sportsMenu);
    return sportsMenu;
  }

  function showSportsMenu(anchor) {
    const menu = buildSportsMenu();
    clearTimeout(sportsHideTimer);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.min(rect.right + 8, window.innerWidth - 190) + 'px';
    menu.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 270)) + 'px';
    menu.hidden = false;
  }

  function hideSportsMenuSoon() {
    clearTimeout(sportsHideTimer);
    sportsHideTimer = setTimeout(() => {
      if (sportsMenu) sportsMenu.hidden = true;
    }, 180);
  }

  function connectSportsMenu(entry) {
    const link = entry.querySelector('a[href]');
    if (!link || link.dataset.ytgifSportsMenu) return;
    link.dataset.ytgifSportsMenu = '1';
    link.href = '#';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showSportsMenu(link);
    });
    entry.addEventListener('mouseenter', () => showSportsMenu(link));
    entry.addEventListener('mouseleave', hideSportsMenuSoon);
    link.addEventListener('focus', () => showSportsMenu(link));
  }

  /* ---------- Atalho Esportes abaixo de Shorts ---------- */
  function injectSportsTab() {
    const shorts = [...document.querySelectorAll('ytd-guide-entry-renderer')].find((entry) => {
      const title = entry.querySelector('#title, yt-formatted-string');
      return title && title.textContent.trim().toLowerCase() === 'shorts';
    });
    if (!shorts || shorts.parentElement.querySelector('.ytgif-sports-entry')) return;

    // Clonar a entrada nativa preserva tamanho, tema claro/escuro e comportamento
    // visual da barra lateral do YouTube.
    const sports = shorts.cloneNode(true);
    sports.classList.add('ytgif-sports-entry');
    sports.removeAttribute('selected');
    const link = sports.querySelector('a[href]');
    if (!link) return;
    link.href = '#';
    link.setAttribute('aria-label', 'Esportes');
    link.removeAttribute('aria-current');
    const title = sports.querySelector('#title, yt-formatted-string');
    if (title) title.textContent = 'Esportes';
    const icon = sports.querySelector('#icon, yt-icon');
    if (icon) {
      const trophy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trophy.setAttribute('class', 'ytgif-sports-trophy');
      trophy.setAttribute('viewBox', '0 0 24 24');
      trophy.setAttribute('aria-hidden', 'true');
      trophy.setAttribute('focusable', 'false');
      trophy.innerHTML = '<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g>';
      icon.replaceWith(trophy);
    }
    connectSportsMenu(sports);
    shorts.insertAdjacentElement('afterend', sports);
  }

  function injectMiniSportsTab() {
    const shorts = [...document.querySelectorAll('ytd-mini-guide-entry-renderer')].find((entry) => {
      const link = entry.querySelector('a[aria-label]');
      return link && link.getAttribute('aria-label').trim().toLowerCase() === 'shorts';
    });
    if (!shorts || shorts.parentElement.querySelector('.ytgif-mini-sports-entry')) return;

    // Esta é a barra compacta exibida na imagem: Início, Shorts, Inscrições e Você.
    const sports = shorts.cloneNode(true);
    sports.classList.add('ytgif-mini-sports-entry');
    const link = sports.querySelector('a[href]');
    if (!link) return;
    link.href = '#';
    link.setAttribute('aria-label', 'Esportes');
    link.setAttribute('title', 'Esportes');
    link.removeAttribute('aria-current');
    const title = sports.querySelector('.title');
    if (title) title.textContent = 'Esportes';
    const tooltip = sports.querySelector('tp-yt-paper-tooltip #tooltip');
    if (tooltip) tooltip.textContent = 'Esportes';
    const icon = sports.querySelector('#icon, yt-icon');
    if (icon) {
      const trophy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trophy.setAttribute('class', 'ytgif-sports-trophy');
      trophy.setAttribute('viewBox', '0 0 24 24');
      trophy.setAttribute('aria-hidden', 'true');
      trophy.setAttribute('focusable', 'false');
      trophy.innerHTML = '<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0.7px 1px 0.7px #000)"><path d="M7.5 3.5h9v5.8a4.5 4.5 0 0 1-9 0V3.5Z" stroke="#f4f4f4" stroke-width="2.1"/><path d="M7.5 5H4.7v2.1a4 4 0 0 0 4 4M16.5 5h2.8v2.1a4 4 0 0 1-4 4" stroke="#e2e2e2" stroke-width="1.8"/><path d="M12 13.8v4.1M9 21h6M10 18h4" stroke="#f4f4f4" stroke-width="2"/></g>';
      icon.replaceWith(trophy);
    }
    connectSportsMenu(sports);
    shorts.insertAdjacentElement('afterend', sports);
  }

  function clearSportsSearchField() {
    let shouldClear = false;
    try {
      shouldClear = sessionStorage.getItem('ytgif-clear-search-after-sports') === '1';
    } catch (_) {}
    if (!shouldClear) return;
    const input = document.querySelector('input[name="search_query"], input.yt-searchbox-input, #search input');
    if (input) {
      input.value = '';
      input.setAttribute('value', '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      try { sessionStorage.removeItem('ytgif-clear-search-after-sports'); } catch (_) {}
    }
  }

  /* ---------- Botão embutido (ao lado do emoji) ---------- */
  function injectButtons() {
    document.querySelectorAll('ytd-commentbox').forEach((box) => {
      if (box.querySelector('.ytgif-btn')) return;
      const btn = makeButton();
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ed =
          box.querySelector('#contenteditable-root') ||
          box.querySelector('[contenteditable="true"]') ||
          currentEditor;
        if (panelOpen() && anchorEl === btn) closePanel();
        else openPanel(btn, ed);
      });
      const emoji = box.querySelector('#emoji-button');
      if (emoji) {
        emoji.insertAdjacentElement('afterend', btn);
      } else {
        const footer = box.querySelector('#footer') || box.querySelector('#buttons');
        if (footer) footer.insertBefore(btn, footer.firstChild);
      }
    });
  }

  /* ---------- Botão flutuante (plano B, sempre aparece ao focar no comentário) ---------- */
  function buildFloat() {
    floatBtn = makeButton();
    floatBtn.classList.add('ytgif-float');
    floatBtn.hidden = true;
    floatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panelOpen() && anchorEl === floatBtn) closePanel();
      else openPanel(floatBtn, currentEditor);
    });
    document.body.appendChild(floatBtn);
  }

  function inlineVisibleFor(editor) {
    const box = editor && editor.closest && editor.closest('ytd-commentbox');
    const b = box && box.querySelector('.ytgif-btn');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function placeFloat() {
    if (!floatVisible) return;
    const ed = currentEditor;
    if (!ed || !document.contains(ed)) return hideFloat();
    const r = ed.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return hideFloat();
    if (inlineVisibleFor(ed)) {
      floatBtn.hidden = true;
    } else {
      floatBtn.hidden = false;
      const left = Math.max(4, Math.min(r.right - 56, window.innerWidth - 64));
      let top = r.top - 34;
      if (top < 4) top = r.bottom + 4;
      floatBtn.style.left = left + 'px';
      floatBtn.style.top = top + 'px';
    }
    requestAnimationFrame(placeFloat);
  }

  function showFloat() {
    if (!floatBtn) buildFloat();
    if (floatVisible) return;
    floatVisible = true;
    requestAnimationFrame(placeFloat);
  }

  function hideFloat() {
    floatVisible = false;
    if (floatBtn) floatBtn.hidden = true;
  }

  function isCommentEditor(path) {
    const t = path[0];
    if (!(t instanceof HTMLElement)) return false;
    if (!(t.isContentEditable || t.tagName === 'TEXTAREA')) return false;
    return path.some((n) => n.matches && n.matches(COMMENT_SELECTOR));
  }

  // Ao clicar em "Editar", o YouTube recria o contenteditable a partir do texto
  // publicado. Reidrata os links de GIF nesse novo editor como miniaturas inline.
  function hydrateEditorGifTokens(editor) {
    if (!editor || !editor.isContentEditable || editor.dataset.ytgifHydrating) return;
    editor.dataset.ytgifHydrating = '1';
    const urlRe = /(?:https?:\/\/)?(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/[^\s"'<>]+|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/[A-Za-z0-9]+/gi;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let changed = false;
    nodes.forEach((node) => {
      if (!node.parentElement || node.parentElement.closest('.ytgif-compose-token')) return;
      const source = node.nodeValue || '';
      const matches = [...source.matchAll(urlRe)];
      if (!matches.length) return;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      let found = false;
      matches.forEach((match) => {
        const url = resolveGifCandidate(match[0]);
        if (!url) return;
        fragment.append(source.slice(offset, match.index));
        fragment.append(makeComposeToken(url));
        offset = match.index + match[0].length;
        found = true;
      });
      if (!found) return;
      fragment.append(source.slice(offset));
      node.replaceWith(fragment);
      changed = true;
    });
    if (changed) editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const path = e.composedPath();
      if (path.includes(panel) || path.includes(floatBtn)) return;
      if (isCommentEditor(path)) {
        currentEditor = path[0];
        // Espera o YouTube preencher o editor após o clique em Editar.
        setTimeout(() => hydrateEditorGifTokens(currentEditor), 0);
        showFloat();
      }
    },
    true
  );

  document.addEventListener(
    'focusout',
    () => {
      setTimeout(() => {
        if (panelOpen()) return;
        const a = document.activeElement;
        if (a === currentEditor || a === floatBtn) return;
        hideFloat();
      }, 250);
    },
    true
  );

  /* ---------- Links de GIF viram imagem nos comentários ---------- */
  const GIF_RE = /^https?:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/\S+\.gif(\?\S*)?$/i;
  const GIF_HOSTS = '(?:media\\d*\\.giphy\\.com|i\\.giphy\\.com|media\\.tenor\\.com|c\\.tenor\\.com)';
  const GIF_FIND_SRC = '(?:https?:\\/\\/)?' + GIF_HOSTS + '\\/[^\\s"\'<>]+?\\.gif(?:\\?[^\\s"\'<>&]*)?';
  const GIF_FIND = new RegExp(GIF_FIND_SRC, 'i');
  const DIRECT_GIF_URL = /https?:\/\/(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?/i;

  function normUrl(u) {
    u = u.replace(/[.,;:!?)]+$/, '');
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  function directGifUrl(value) {
    let raw = String(value || '');
    try { raw = decodeURIComponent(raw); } catch (_) {}
    const match = raw.match(DIRECT_GIF_URL);
    return match ? normUrl(match[0]) : null;
  }

  // Cria uma imagem DOM normal. Nunca navega o frame do YouTube: o navegador
  // carrega o GIF diretamente pelo atributo src, que aceita apenas HTTP(S).
  function gifImg(url, cls, onInvalid) {
    const img = document.createElement('img');
    if (cls) img.className = cls;
    img.alt = 'Anexo de imagem do comentário';
    img.loading = 'lazy';
    if (typeof onInvalid === 'function') img.addEventListener('error', onInvalid, { once: true });
    if (/^https?:\/\//i.test(url)) img.src = url;
    return img;
  }

  // Mesma estrutura de imagem usada pelo YouTube nos comentários de vídeos
  // longos. Isso evita depender do layout específico dos Shorts.
  function postedGifImg(url, onInvalid) {
    const img = gifImg(
      url,
      'ytCoreImageHost ytwCommentImageAttachmentViewModelImage ytCoreImageContentModeScaleAspectFit',
      onInvalid
    );
    img.addEventListener('load', () => {
      img.classList.add('ytCoreImageLoaded');
      img.dataset.ytgifVerified = '1';
    }, { once: true });
    img.alt = 'Anexo de imagem do comentário';
    img.style.cssText = 'display:block;max-width:min(480px,100%);max-height:360px;width:auto;height:auto;object-fit:contain;border-radius:4px;margin:6px 0;';
    return img;
  }

  // Acha a URL do GIF no texto do link (que o YouTube mostra sem "https://") ou no href/redirect
  function resolveGifCandidate(value) {
    const raw = String(value || '').trim();
    const directUrl = directGifUrl(raw);
    if (directUrl) return directUrl;
    const direct = raw.match(GIF_FIND);
    if (direct) return normUrl(direct[0]);
    // Links to a GIPHY page are not direct .gif URLs. Convert known media IDs
    // to the direct animated GIF endpoint so the comment can render an <img>.
    const page = raw.match(/(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/(?:[^\s/?#]*-)?([A-Za-z0-9]+)(?:[/?#]|$)/i);
    if (page) return `https://media.giphy.com/media/${page[1]}/giphy.gif`;
    const media = raw.match(/(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/([A-Za-z0-9]+)/i);
    if (media) return `https://media.giphy.com/media/${media[1]}/giphy.gif`;
    return null;
  }

  function findGifUrl(a) {
    const cands = [a.textContent || '', a.getAttribute('href') || '', a.href || ''];
    // YouTube sometimes wraps external URLs in /redirect?q=... and encodes them.
    for (const raw of [...cands]) {
      try { cands.push(decodeURIComponent(raw)); } catch (_) {}
      try {
        const u = new URL(raw, location.href);
        for (const key of ['q', 'url', 'u', 'redirect_url']) {
          const value = u.searchParams.get(key);
          if (value) {
            cands.push(value);
            try { cands.push(decodeURIComponent(value)); } catch (_) {}
          }
        }
      } catch (_) {}
    }
    for (const c of cands) {
      const resolved = resolveGifCandidate(c);
      if (resolved) return resolved;
    }
    return null;
  }

  // Comentários de vídeo longo podem ser colocados pelo YouTube em Shadow DOM.
  // querySelectorAll(document) não entra nessas camadas, então percorremos também
  // cada shadowRoot aberto para localizar o link que acabou de ser publicado.
  function queryDeep(selector) {
    const found = new Set();
    const visited = new Set();
    const visit = (root) => {
      if (!root || visited.has(root)) return;
      visited.add(root);
      root.querySelectorAll(selector).forEach((element) => found.add(element));
      root.querySelectorAll('*').forEach((element) => {
        if (element.shadowRoot) visit(element.shadowRoot);
      });
    };
    visit(document);
    return [...found];
  }

  function closestComposed(element, selector) {
    let node = element;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches(selector)) return node;
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return null;
  }

  function replacePublishedGifLink(a, knownCommentLink) {
    if (a.dataset.ytgifRendered) return;
    if (closestComposed(a, '#ytgif-panel, .ytgif-preview, [contenteditable]')) return;
    if (!knownCommentLink) {
      const commentRoot = closestComposed(a,
        'ytd-comment-view-model, ytd-comment-renderer, ytd-comment-thread-renderer, ' +
        'yt-comment-view-model, yt-comment-thread-renderer, yt-reel-comments-overlay-renderer, ' +
        'yt-shorts-comment-renderer, #content-text, #comments, ytd-comments, ' +
        'ytd-engagement-panel-section-list-renderer'
      );
      if (!commentRoot) return;
    }
    const url = directGifUrl(a.textContent) || directGifUrl(a.getAttribute('href')) || findGifUrl(a);
    if (!url) return;
    const originalLink = a.cloneNode(true);
    const img = postedGifImg(url, () => {
      if (img.isConnected) img.replaceWith(originalLink);
    });
    const before = document.createElement('br');
    const after = document.createElement('br');
    before.className = 'ytgif-posted-break';
    after.className = 'ytgif-posted-break';
    a.before(before);
    a.replaceWith(img);
    img.after(after);
    console.log('[Nexus YouTube+] Link substituído por GIF:', url);
  }

  function renderGifLinks() {
    // Estrutura confirmada na página salva de vídeo longo: o link fica dentro de
    // yt-attributed-string#content-text[slot="content"]. Trata-a primeiro.
    queryDeep(
      'ytd-comment-view-model yt-attributed-string#content-text[slot="content"] a[href], ' +
      'ytd-comment-view-model yt-attributed-string#content-text a.ytAttributedStringLink[href]'
    ).forEach((a) => replacePublishedGifLink(a, true));

    queryDeep(
      '#comments a[href], ytd-comments a[href], ytd-comment-view-model a[href], ' +
      'ytd-comment-renderer a[href], ytd-comment-thread-renderer a[href], ' +
      'yt-comment-view-model a[href], yt-comment-thread-renderer a[href], ' +
      'ytd-engagement-panel-section-list-renderer a[href], ' +
      'ytd-item-section-renderer #contents ytd-comment-renderer a[href], ' +
      'yt-reel-comments-overlay-renderer a[href], yt-shorts-comment-renderer a[href], ' +
      '#content-text a[href], .yt-core-attributed-string a[href], ' +
      'yt-attributed-string a[href]'
    ).forEach((a) => replacePublishedGifLink(a, false));

    // URLs de GIF em texto puro (sem link)
    queryDeep(
        'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text, ytd-comment-thread-renderer #content-text, ytd-comment-view-model .yt-core-attributed-string, ytd-comment-renderer .yt-core-attributed-string, ytd-comment-thread-renderer .yt-core-attributed-string, ytd-comment-view-model yt-attributed-string, ytd-comment-renderer yt-attributed-string, ytd-comment-thread-renderer yt-attributed-string, #comments #content-text, yt-comment-view-model #content-text, yt-comment-thread-renderer #content-text, yt-comment-view-model, yt-comment-thread-renderer, yt-reel-comments-overlay-renderer, yt-shorts-comment-renderer'
      ).forEach((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((n) => {
          const par = n.parentElement;
          if (!par || par.closest('a') || par.closest('.ytgif-inline')) return;
          const t = n.nodeValue;
          // Match both direct .gif URLs and common GIPHY page URLs in plain text.
          const re = /(?:https?:\/\/)?(?:media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com)\/[^\s"'<>]+?\.gif(?:\?[^\s"'<>]*)?|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:gifs|stickers)\/[^\s"'<>]+|(?:https?:\/\/)?(?:www\.)?giphy\.com\/(?:media|embed)\/[A-Za-z0-9]+/gi;
          const matches = [...t.matchAll(re)];
          if (!matches.length) return;
          const frag = document.createDocumentFragment();
          let last = 0;
          for (const m of matches) {
            const resolved = resolveGifCandidate(m[0]);
            if (!resolved) continue;
            frag.append(t.slice(last, m.index));
            const before = document.createElement('br');
            const inlineImg = postedGifImg(resolved);
            const after = document.createElement('br');
            before.className = after.className = 'ytgif-posted-break';
            frag.append(before, inlineImg, after);
            last = m.index + m[0].length;
          }
          if (last === 0) return;
          frag.append(t.slice(last));
          n.replaceWith(frag);
        });
      });
  }


  /* ---------- YouTube Plus: ferramentas extras locais ---------- */
  const YTP_KEY = 'ytgif-plus-state-v2';
  const ytpState = (() => { try { return JSON.parse(localStorage.getItem(YTP_KEY) || '{}'); } catch (_) { return {}; } })();
  const ytpGet = (k, fallback) => ytpState[k] === undefined ? fallback : ytpState[k];
  function ytpSave() { try { localStorage.setItem(YTP_KEY, JSON.stringify(ytpState)); } catch (_) {} }
  function ytpVideo() { return document.querySelector('ytd-player video.html5-main-video, #movie_player video, video.html5-main-video'); }
  function ytpToast(msg) {
    let el = document.getElementById('ytgif-plus-toast');
    if (!el) { el = document.createElement('div'); el.id = 'ytgif-plus-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function ytpButton(label, title, fn) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ytgif-plus-btn'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); }); return b;
  }
  function ytpCurrentId() { return new URL(location.href).searchParams.get('v') || location.pathname.split('/').filter(Boolean).pop() || 'unknown'; }
  function ytpLoadList(k) { try { const all = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(all) ? all : []; } catch (_) { return []; } }
  function ytpSaveList(k, value) { try { localStorage.setItem(k, JSON.stringify(value)); } catch (_) {} }
  function ytpBookmark() {
    const v = ytpVideo(); if (!v) return ytpToast('Vídeo não encontrado');
    const item = { id: ytpCurrentId(), title: document.title.replace(/\s*-\s*YouTube$/, ''), time: Math.floor(v.currentTime), url: location.href.split('&t=')[0], savedAt: Date.now() };
    const list = ytpLoadList('ytgif-plus-bookmarks'); list.unshift(item); ytpSaveList('ytgif-plus-bookmarks', list.slice(0, 300)); ytpToast(`Momento salvo: ${formatTime(item.time)}`);
  }
  function formatTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec/3600) ? Math.floor(sec/3600)+':' : ''}${String(Math.floor(sec/60)%60).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }
  function ytpCapture() {
    const v = ytpVideo(); if (!v || !v.videoWidth) return ytpToast('O vídeo ainda não está pronto');
    try { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v,0,0); c.toBlob(blob => { if (!blob) return ytpToast('Não foi possível capturar este quadro'); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `youtube-${ytpCurrentId()}-${formatTime(v.currentTime).replace(/:/g,'-')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }, 'image/png'); } catch (_) { ytpToast('Captura bloqueada pelo navegador neste vídeo'); }
  }
  async function ytpPictureInPicture() {
    const v = ytpVideo();
    if (!v) return ytpToast('Vídeo não encontrado');
    try {
      if (document.pictureInPictureElement === v) { await document.exitPictureInPicture(); return; }
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      if (!document.pictureInPictureEnabled || typeof v.requestPictureInPicture !== 'function') {
        return ytpToast('Picture-in-Picture não é compatível com este vídeo ou navegador');
      }
      await v.requestPictureInPicture();
      ytpToast('Vídeo flutuante aberto. Arraste a janela PiP para qualquer área da tela.');
    } catch (error) {
      ytpToast('Não foi possível abrir o vídeo flutuante. Tente iniciar a reprodução primeiro.');
    }
  }
  function ytpTimer() {
    const raw = prompt('Parar a reprodução em quantos minutos? (0 cancela)', String(ytpGet('timerMinutes', 30)));
    if (raw === null) return; const mins = Number(raw);
    if (!Number.isFinite(mins) || mins < 0 || mins > 1440) return ytpToast('Digite um valor entre 0 e 1440');
    ytpState.timerMinutes = mins; ytpSave(); if (window.__ytgifStopTimer) clearTimeout(window.__ytgifStopTimer);
    if (!mins) return ytpToast('Temporizador cancelado');
    window.__ytgifStopTimer = setTimeout(() => { const v = ytpVideo(); if (v) v.pause(); ytpToast('Temporizador: reprodução pausada'); }, mins * 60000); ytpToast(`Temporizador definido: ${mins} min`);
  }
  function ytpCinema() { document.documentElement.classList.toggle('ytgif-plus-cinema'); const on = document.documentElement.classList.contains('ytgif-plus-cinema'); ytpState.cinema = on; ytpSave(); ytpToast(on ? 'Modo cinema ativado (Esc para sair)' : 'Modo cinema desativado'); }
  function ytpCustomize() {
    const accent = prompt('Cor de destaque (nome ou hexadecimal, ex. #3ea6ff):', ytpGet('accent', '#3ea6ff')); if (accent === null) return;
    const size = prompt('Tamanho dos controles (compacto, normal ou grande):', ytpGet('controlSize', 'normal')); if (size === null) return;
    const safeAccent = /^#[0-9a-f]{3,8}$/i.test(accent.trim()) || /^[a-z]{3,20}$/i.test(accent.trim()) ? accent.trim() : '#3ea6ff';
    ytpState.accent = safeAccent; ytpState.controlSize = ['compacto','normal','grande'].includes(size.toLowerCase()) ? size.toLowerCase() : 'normal'; ytpSave(); document.documentElement.style.setProperty('--ytgif-plus-accent', ytpState.accent); document.documentElement.dataset.ytgifPlusSize = ytpState.controlSize; ytpToast('Personalização salva');
  }
  function ytpFilterComments() {
    const words = prompt('Palavras para ocultar nos comentários, separadas por vírgula:', ytpGet('blockedWords', '').join(', ')); if (words === null) return;
    ytpState.blockedWords = words.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 50); ytpSave(); ytpApplyCommentFilters(); ytpToast('Filtro de comentários atualizado');
  }
  function ytpApplyCommentFilters() {
    if (!extensionConfig.enabled || !extensionConfig.commentTools) return;
    const words = ytpGet('blockedWords', []); if (!words.length) { document.querySelectorAll('[data-ytgif-filter-hidden="1"]').forEach(el => { el.hidden = false; delete el.dataset.ytgifFilterHidden; }); return; }
    document.querySelectorAll('ytd-comment-view-model, ytd-comment-renderer, yt-comment-view-model, yt-comment-thread-renderer').forEach(el => {
      const text = (el.innerText || '').toLowerCase(); const hide = words.some(w => w && text.includes(w)); el.hidden = hide; if (hide) el.dataset.ytgifFilterHidden = '1'; else delete el.dataset.ytgifFilterHidden;
    });
  }
  function ytpShowBookmarks() {
    const list = ytpLoadList('ytgif-plus-bookmarks'); if (!list.length) return ytpToast('Ainda não há momentos salvos');
    const chosen = prompt('Momentos salvos:\n' + list.slice(0, 20).map((x,i)=>`${i+1}. ${x.title} — ${formatTime(x.time)}`).join('\n') + '\n\nDigite o número para abrir:', '1');
    const idx = Number(chosen) - 1; if (chosen === null || !Number.isInteger(idx) || !list[idx]) return;
    const x = list[idx]; location.href = `https://www.youtube.com/watch?v=${encodeURIComponent(x.id)}&t=${x.time}s`;
  }
  function ytpInjectToolbar() {
    if (!extensionConfig.enabled || !extensionConfig.plusToolbar) { const old=document.querySelector('.ytgif-plus-toolbar'); if(old) old.remove(); return; }
    const video = ytpVideo();
    if (!video) return;
    let panel = document.getElementById('ytgif-plus-floating-panel');
    let toggle = document.getElementById('ytgif-plus-floating-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'ytgif-plus-floating-toggle';
      toggle.type = 'button';
      toggle.textContent = '✦';
      toggle.title = 'Abrir ferramentas Nexus YouTube+';
      toggle.setAttribute('aria-label', 'Abrir ferramentas Nexus YouTube+');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const p = document.getElementById('ytgif-plus-floating-panel');
        if (!p) return;
        const open = p.hidden;
        p.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '×' : '✦';
        toggle.title = open ? 'Fechar ferramentas' : 'Abrir ferramentas Nexus YouTube+';
      });
      document.body.appendChild(toggle);
    }
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'ytgif-plus-floating-panel';
      panel.hidden = true;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Ferramentas do YouTube Plus');
      const heading = document.createElement('div');
      heading.className = 'ytgif-plus-panel-heading';
      heading.textContent = 'YouTube Plus';
      const bar = document.createElement('div');
      bar.className = 'ytgif-plus-toolbar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Ferramentas extras do YouTube');
      bar.append(
        ytpButton('−5s','Voltar 5 segundos',()=>{ const v=ytpVideo(); if(v)v.currentTime=Math.max(0,v.currentTime-5); }),
        ytpButton('+5s','Avançar 5 segundos',()=>{ const v=ytpVideo(); if(v)v.currentTime=Math.min(v.duration||Infinity,v.currentTime+5); }),
        ytpButton('1×','Velocidade de reprodução',()=>{ const v=ytpVideo(); if(!v)return; const speeds=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3]; const i=speeds.indexOf(v.playbackRate); v.playbackRate=speeds[(i+1)%speeds.length]; bar.querySelector('[aria-label="Velocidade de reprodução"]').textContent=v.playbackRate+'×'; ytpToast('Velocidade '+v.playbackRate+'×'); }),
        ytpButton('☆','Salvar momento exato',ytpBookmark),
        ytpButton('▣','Capturar quadro',ytpCapture),
        ytpButton('PiP','Abrir vídeo flutuante fora do Chrome',ytpPictureInPicture),
        ytpButton('▰','Modo cinema',ytpCinema),
        ytpButton('◷','Temporizador',ytpTimer),
        ytpButton('★','Momentos salvos',ytpShowBookmarks),
        ytpButton('⚙','Personalizar',ytpCustomize),
        ytpButton('☷','Filtrar comentários',ytpFilterComments)
      );
      panel.append(heading, bar);
      document.body.appendChild(panel);
    }
    const v = video;
    if (!v.dataset.ytgifHistoryBound) {
      v.dataset.ytgifHistoryBound = '1';
      v.addEventListener('timeupdate', () => {
        if (!v.duration || !Number.isFinite(v.currentTime)) return;
        const id = ytpCurrentId();
        const hist = ytpLoadList('ytgif-plus-history');
        const now = Date.now();
        const existing = hist.find(x => x.id === id);
        if (existing) { existing.time = Math.floor(v.currentTime); existing.duration = Math.floor(v.duration); existing.updatedAt = now; }
        else hist.unshift({ id, title: document.title.replace(/\s*-\s*YouTube$/, ''), url: location.href, time: Math.floor(v.currentTime), duration: Math.floor(v.duration), updatedAt: now });
        ytpSaveList('ytgif-plus-history', hist.slice(0, 100));
      }, { passive: true });
    }
  }
  function ytpKeyboard(e) {
    if (!extensionConfig.shortcuts) return;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t=e.target; if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
    const v=ytpVideo(); if (!v) return;
    if (e.key==='[') { v.currentTime=Math.max(0,v.currentTime-5); }
    else if (e.key===']') { v.currentTime=Math.min(v.duration||Infinity,v.currentTime+5); }
    else if (e.key.toLowerCase()==='b') { e.preventDefault(); ytpBookmark(); }
    else if (e.key.toLowerCase()==='c') { e.preventDefault(); ytpCapture(); }
    else if (e.key.toLowerCase()==='m') { e.preventDefault(); ytpCinema(); }
    else if (e.key.toLowerCase()==='j' && e.shiftKey) { e.preventDefault(); ytpShowBookmarks(); }
    else if (e.key==='Escape' && document.documentElement.classList.contains('ytgif-plus-cinema')) { document.documentElement.classList.remove('ytgif-plus-cinema'); ytpState.cinema=false; ytpSave(); }
  }
  document.addEventListener('keydown', ytpKeyboard, true);
  if (ytpGet('cinema', false)) document.documentElement.classList.add('ytgif-plus-cinema');
  if (ytpGet('accent', null)) document.documentElement.style.setProperty('--ytgif-plus-accent', ytpState.accent);
  if (ytpGet('controlSize', null)) document.documentElement.dataset.ytgifPlusSize = ytpState.controlSize;
  setInterval(() => { try { ytpInjectToolbar(); ytpApplyCommentFilters(); } catch (_) {} }, 1200);


  /* ---------- Atalho de configurações no fim da barra lateral ---------- */
  function injectSettingsSidebarEntry() {
    if (!extensionConfig.enabled) {
      document.querySelectorAll('.ytgif-sidebar-settings, #ytgif-settings-fallback').forEach(el => el.remove());
      return;
    }
    if (document.querySelector('.ytgif-sidebar-settings')) return;

    const guide = document.querySelector('ytd-guide-renderer');
    const sections = guide ? [...guide.querySelectorAll('ytd-guide-section-renderer #items')].filter(el => el.isConnected) : [];
    const host = sections.find(el => el.querySelector('ytd-guide-entry-renderer')) ||
      (guide && (guide.querySelector('#sections') || guide.querySelector('#items')));

    const openSettings = (event) => {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      // Content scripts não podem abrir a página de opções diretamente.
      // Solicite ao service worker para abrir a página, evitando o bloqueio do Chrome.
      try {
        chrome.runtime.sendMessage({ type: 'open-options' }, () => {
          // Leia lastError para evitar avisos no console se a extensão estiver sendo recarregada.
          const error = chrome.runtime.lastError;
          if (error) console.warn('[Nexus YouTube+] Não foi possível abrir configurações:', error.message);
        });
      } catch (error) {
        console.warn('[Nexus YouTube+] Falha ao solicitar abertura das configurações:', error);
      }
    };

    if (host) {
      const nativeEntry = [...guide.querySelectorAll('ytd-guide-entry-renderer')].find(entry => {
        const title = entry.querySelector('#title, yt-formatted-string');
        return title && title.textContent.trim().toLowerCase() === 'shorts';
      });
      if (nativeEntry) {
        const item = nativeEntry.cloneNode(true);
        item.classList.add('ytgif-sidebar-settings');
        item.removeAttribute('selected');
        const link = item.querySelector('a[href], #endpoint');
        if (link) {
          link.href = '#';
          link.setAttribute('aria-label', 'Configurações da extensão');
          link.setAttribute('title', 'Configurações da extensão');
          link.removeAttribute('aria-current');
          link.addEventListener('click', openSettings);
        } else {
          item.addEventListener('click', openSettings);
        }
        const title = item.querySelector('#title, yt-formatted-string');
        if (title) title.textContent = 'Configurações';
        const icon = item.querySelector('#icon, yt-icon');
        if (icon) icon.innerHTML = '<span class="ytgif-settings-gear" aria-hidden="true">⚙</span>';
        item.setAttribute('title', 'Abrir configurações do Nexus YouTube+');
        item.addEventListener('click', openSettings);
        host.appendChild(item);
        return;
      }
    }

    // Fallback garantido: aparece no canto inferior esquerdo caso o YouTube mude a estrutura da guia.
    const fallback = document.createElement('button');
    fallback.id = 'ytgif-settings-fallback';
    fallback.type = 'button';
    fallback.innerHTML = '<span aria-hidden="true">⚙</span><span>Configurações</span>';
    fallback.title = 'Abrir configurações do Nexus YouTube+';
    fallback.addEventListener('click', openSettings);
    document.body.appendChild(fallback);
  }

  /* ---------- Ocultar atalhos durante vídeo longo em tela cheia ---------- */
  function updateLongVideoFullscreenState() {
    const player = document.querySelector('#movie_player');
    const isLongVideoPage = location.pathname.startsWith('/watch') &&
      !!document.querySelector('ytd-watch-flexy') &&
      !document.querySelector('ytd-reel-video-renderer, ytd-shorts');
    const isFullscreen = !!(document.fullscreenElement ||
      (player && player.classList.contains('ytp-fullscreen')) ||
      document.querySelector('ytd-watch-flexy[fullscreen], ytd-watch-flexy[fullscreen="true"]'));
    document.documentElement.classList.toggle('nexus-long-video-fullscreen', isLongVideoPage && isFullscreen);
  }

  // A troca de tela cheia do player altera classes, não necessariamente o DOM.
  // Observar esses atributos mantém os atalhos ocultos mesmo quando o YouTube não
  // dispara o evento nativo fullscreenchange.
  new MutationObserver(updateLongVideoFullscreenState).observe(document.documentElement, {
    attributes: true,
    subtree: true,
    attributeFilter: ['class', 'fullscreen']
  });
  document.addEventListener('fullscreenchange', updateLongVideoFullscreenState, true);
  document.addEventListener('webkitfullscreenchange', updateLongVideoFullscreenState, true);
  window.addEventListener('yt-navigate-finish', updateLongVideoFullscreenState, true);


  /* ---------- Aviso central de atualização do Nexus YouTube+ ---------- */
  let nexusUpdateDialog = null;
  function closeNexusUpdateDialog() {
    if (nexusUpdateDialog) nexusUpdateDialog.remove();
    nexusUpdateDialog = null;
  }
  function showNexusUpdateDialog(status) {
    if (!status || !status.updateAvailable || nexusUpdateDialog || document.getElementById('nexus-update-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'nexus-update-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:2147483647','display:flex',
      'align-items:center','justify-content:center','padding:24px',
      'background:rgba(0,0,0,.72)','backdrop-filter:blur(5px)',
      'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
    ].join(';');
    const card = document.createElement('section');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'nexus-update-title');
    card.style.cssText = [
      'box-sizing:border-box','width:min(460px,100%)','padding:28px',
      'border:1px solid rgba(120,170,255,.34)','border-radius:22px',
      'background:linear-gradient(145deg,#151d2c,#0c111b)',
      'color:#f5f7fb','box-shadow:0 24px 90px rgba(0,0,0,.65)',
      'text-align:left'
    ].join(';');
    const eyebrow = document.createElement('div');
    eyebrow.textContent = 'NEXUS YOUTUBE+';
    eyebrow.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:2px;color:#82b7ff;margin-bottom:12px';
    const title = document.createElement('h2');
    title.id = 'nexus-update-title';
    title.textContent = 'Novo update da extensão';
    title.style.cssText = 'font-size:25px;line-height:1.2;margin:0 0 12px;font-weight:750;color:#fff';
    const message = document.createElement('p');
    message.textContent = 'Uma nova versão do Nexus YouTube+ está disponível.';
    message.style.cssText = 'font-size:15px;line-height:1.55;color:#d5dbea;margin:0 0 12px';
    const version = document.createElement('div');
    version.textContent = 'Nova versão: ' + String(status.latestVersion || 'disponível') + '  ·  Instalada: ' + String(status.currentVersion || chrome.runtime.getManifest().version);
    version.style.cssText = 'font-size:13px;color:#aebbd0;margin-bottom:24px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end';
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'Mais tarde';
    later.style.cssText = 'border:1px solid #3a4558;background:#202a3a;color:#e7edf8;padding:12px 17px;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer';
    later.addEventListener('click', () => {
      send({ type: 'nexus-update-later' });
      closeNexusUpdateDialog();
    });
    const update = document.createElement('button');
    update.type = 'button';
    update.textContent = 'Atualizar';
    update.style.cssText = 'border:0;background:linear-gradient(135deg,#4f9cff,#3477f6);color:#fff;padding:12px 19px;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 5px 18px rgba(52,119,246,.3)';
    update.addEventListener('click', () => {
      send({ type: 'nexus-open-update-page' });
      closeNexusUpdateDialog();
    });
    actions.append(later, update);
    card.append(eyebrow, title, message, version, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        send({ type: 'nexus-update-later' });
        closeNexusUpdateDialog();
      }
    });
    document.addEventListener('keydown', function onEscape(event) {
      if (event.key === 'Escape' && nexusUpdateDialog === overlay) {
        document.removeEventListener('keydown', onEscape);
        send({ type: 'nexus-update-later' });
        closeNexusUpdateDialog();
      }
    }, { once: true });
    document.documentElement.appendChild(overlay);
    nexusUpdateDialog = overlay;
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'nexus-show-update-prompt') showNexusUpdateDialog(message.status);
  });
  send({ type: 'nexus-get-update-status' }).then((result) => {
    if (result && result.show && result.status) showNexusUpdateDialog(result.status);
  });

  /* ---------- Observador (YouTube é uma SPA) ---------- */
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectSportsTab();
      injectMiniSportsTab();
      injectSettingsSidebarEntry();
      clearSportsSearchField();
      injectButtons();
      renderGifLinks();
      ytpInjectToolbar();
      ytpApplyCommentFilters();
      updateLongVideoFullscreenState();
    }, 400);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('yt-navigate-finish', () => {
    closePanel();
    schedule();
  });
  schedule();
  setInterval(() => {
    try { renderGifLinks(); } catch (_) {}
  }, 1500);
})();
})();
