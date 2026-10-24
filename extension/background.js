// Nexus YouTube+ — verificador de versão pelo manifesto público do GitHub.
const NEXUS_UPDATE = {
  currentVersion: chrome.runtime.getManifest().version,
  manifestUrl: 'https://raw.githubusercontent.com/tarcisioferraz/Nexus-Youtube-/main/extension/manifest.json',
  repositoryUrl: 'https://github.com/tarcisioferraz/Nexus-Youtube-',
  releasesUrl: 'https://github.com/tarcisioferraz/Nexus-Youtube-/releases/latest'
};

chrome.runtime.onInstalled.addListener(() => {
  checkForNexusUpdate().catch(() => {});
  chrome.alarms.create('nexus-update-check', { periodInMinutes: 360 });
});
chrome.runtime.onStartup.addListener(() => checkForNexusUpdate().catch(() => {}));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nexus-update-check') checkForNexusUpdate().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'nexus-check-update') {
    checkForNexusUpdate(true).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if (msg.type === 'nexus-open-update-page') {
    chrome.tabs.create({ url: NEXUS_UPDATE.releasesUrl });
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'gif-search') {
    search(msg.query || '', msg.pos || '')
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message || String(e) }));
    return true;
  }
});

function parseVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}
function isNewerVersion(remote, local) {
  const a = parseVersion(remote), b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function notifyUpdateOnce(version) {
  return new Promise((resolve) => {
    chrome.notifications.create('nexus-update-' + version, {
      type: 'basic', iconUrl: 'icons/128.png',
      title: 'Nexus YouTube+ — atualização disponível',
      message: 'A versão ' + version + ' está disponível. Clique aqui para abrir a página oficial de atualização.',
      priority: 1
    }, () => resolve());
  });
}
async function checkForNexusUpdate(manual = false) {
  const response = await fetch(NEXUS_UPDATE.manifestUrl + '?t=' + Date.now(), {
    cache: 'no-store', headers: { Accept: 'application/json, text/plain' }
  });
  if (!response.ok) throw new Error('GitHub respondeu HTTP ' + response.status);
  const remoteManifest = await response.json();
  const remoteVersion = String(remoteManifest.version || '');
  if (!parseVersion(remoteVersion)) throw new Error('A versão no manifesto remoto não está no formato X.Y.Z.');

  const updateAvailable = isNewerVersion(remoteVersion, NEXUS_UPDATE.currentVersion);
  const status = {
    ok: true, currentVersion: NEXUS_UPDATE.currentVersion,
    latestVersion: remoteVersion, updateAvailable,
    repositoryUrl: NEXUS_UPDATE.repositoryUrl, releasesUrl: NEXUS_UPDATE.releasesUrl,
    checkedAt: Date.now()
  };
  await chrome.storage.local.set({ nexusUpdateStatus: status });
  if (updateAvailable) {
    const saved = await chrome.storage.local.get(['nexusUpdateNotifiedVersion']);
    if (manual || saved.nexusUpdateNotifiedVersion !== remoteVersion) {
      await notifyUpdateOnce(remoteVersion);
      await chrome.storage.local.set({ nexusUpdateNotifiedVersion: remoteVersion });
    }
  }
  return status;
}
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('nexus-update-')) chrome.tabs.create({ url: NEXUS_UPDATE.releasesUrl });
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

