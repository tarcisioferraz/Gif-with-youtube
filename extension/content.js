(() => {
  'use strict';
  console.log('[GIF YouTube] extensão carregada');

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

  /* ---------- Painel de GIFs ---------- */
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ytgif-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="ytgif-head">
        <input type="text" class="ytgif-search" placeholder="Pesquisar GIFs ou colar link" autocomplete="off" spellcheck="false">
        <button type="button" class="ytgif-close" title="Fechar">✕</button>
      </div>
      <div class="ytgif-body">
        <div class="ytgif-cols"><div class="ytgif-col"></div><div class="ytgif-col"></div></div>
        <div class="ytgif-status"></div>
      </div>
      <div class="ytgif-foot"></div>`;
    document.body.appendChild(panel);

    searchInput = panel.querySelector('.ytgif-search');
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
    console.log('[GIF YouTube] Link substituído por GIF:', url);
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

  /* ---------- Observador (YouTube é uma SPA) ---------- */
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      injectButtons();
      renderGifLinks();
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
