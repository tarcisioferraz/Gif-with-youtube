// Configuração automática: não exige chave de API nem abre tela de opções.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'gif-search') {
    search(msg.query || '', msg.pos || '')
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true; // resposta assíncrona
  }
});

async function search(query, pos) {
  // Pesquisa pública do GIPHY; funciona sem API key.
  return searchWeb(query);
}

async function searchGiphy(query, pos, key) {
  const offset = Number(pos) || 0;
  const base = query ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
  const p = new URLSearchParams({ api_key: key, limit: '24', offset: String(offset), rating: 'pg-13' });
  if (query) { p.set('q', query); p.set('lang', 'pt'); }
  const res = await fetch(`${base}?${p}`);
  if (!res.ok) throw new Error(`Giphy respondeu ${res.status}. Verifique sua chave de API.`);
  const json = await res.json();
  const data = json.data || [];
  const items = data.map((g) => {
    const img = g.images.fixed_width_small || g.images.fixed_width || g.images.original;
    return {
      id: g.id,
      title: g.title || 'GIF',
      preview: img.url,
      w: Number(img.width) || 1,
      h: Number(img.height) || 1,
      url: `https://media.giphy.com/media/${g.id}/giphy.gif`
    };
  });
  return { provider: 'giphy', items, next: items.length ? String(offset + items.length) : null };
}

async function searchTenor(query, pos, key) {
  const base = query ? 'https://tenor.googleapis.com/v2/search' : 'https://tenor.googleapis.com/v2/featured';
  const p = new URLSearchParams({
    key, limit: '24', locale: 'pt_BR', contentfilter: 'medium', media_filter: 'gif,tinygif'
  });
  if (query) p.set('q', query);
  if (pos) p.set('pos', pos);
  const res = await fetch(`${base}?${p}`);
  if (!res.ok) throw new Error(`Tenor respondeu ${res.status}. Verifique sua chave de API.`);
  const json = await res.json();
  const items = (json.results || []).map((r) => {
    const tiny = r.media_formats.tinygif || r.media_formats.gif;
    const full = r.media_formats.gif || tiny;
    return {
      id: r.id,
      title: r.content_description || 'GIF',
      preview: tiny.url,
      w: (tiny.dims && tiny.dims[0]) || 1,
      h: (tiny.dims && tiny.dims[1]) || 1,
      url: full.url
    };
  });
  return { provider: 'tenor', items, next: json.next || null };
}

/* ---------- Pesquisa SEM chave de API ----------
   Lê a página pública https://giphy.com/explore/<termo> e extrai os GIFs.
   Não tem paginação e pode quebrar se o GIPHY mudar o site. */
function toSlug(q) {
  return (q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function searchWeb(query) {
  const slug = toSlug(query) || 'reaction';
  const res = await fetch(`https://giphy.com/explore/${encodeURIComponent(slug)}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`O site do GIPHY respondeu ${res.status}. Tente novamente mais tarde ou cole um link direto de GIF.`);
  let html = await res.text();
  html = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');

  const re = /https:\/\/media\d*\.giphy\.com\/media\/(?:v1\.[A-Za-z0-9=_-]+\/)?([A-Za-z0-9]+)\/(?:giphy|200|200w|100|100w)\.gif/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(html)) && seen.size < 30) {
    if (!seen.has(m[1])) seen.set(m[1], m[0]);
  }
  const items = [...seen].map(([id, preview]) => ({
    id,
    title: 'GIF',
    preview,
    w: 1,
    h: 1,
    url: `https://media.giphy.com/media/${id}/giphy.gif`
  }));
  return { provider: 'giphy', items, next: null };
}

