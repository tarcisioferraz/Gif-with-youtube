// Nexus YouTube+ — verificação de atualizações do manifesto público no GitHub.
try { importScripts('updater.js'); } catch (e) { console.warn('[Nexus YouTube+] updater.js não carregou', e); }

const NEXUS_UPDATE = {
  currentVersion: chrome.runtime.getManifest().version,
  manifestUrl: 'https://raw.githubusercontent.com/tarcisioferraz/Nexus-YoutubePlus/main/extension/manifest.json',
  repositoryUrl: 'https://github.com/tarcisioferraz/Nexus-YoutubePlus',
  releasesUrl: 'https://github.com/tarcisioferraz/Nexus-YoutubePlus/releases/latest',
  // Página de agradecimento aberta ao desinstalar (GitHub Pages: pasta /docs do repositório).
  thanksUrl: 'https://tarcisioferraz.github.io/Nexus-YoutubePlus/obrigado.html',
  intervalMinutes: 15,      // verificação normal (aviso com botão Atualizar)
  autoIntervalMinutes: 5,   // verificação quando o Auto update está ligado
  snoozeMinutes: 15         // "Mais tarde"
};

// Clicar no ícone da extensão na barra do navegador (ou no menu de extensões) abre as configurações.
function openNexusSettings() {
  try {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  } catch (_) {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
}
chrome.action.onClicked.addListener(openNexusSettings);

// Ao desinstalar, o Chrome abre esta página (precisa ser http/https).
try { chrome.runtime.setUninstallURL(NEXUS_UPDATE.thanksUrl + '?v=' + encodeURIComponent(NEXUS_UPDATE.currentVersion)); } catch (_) {}

async function isAutoUpdateOn() {
  try { return !!(await chrome.storage.sync.get({ autoUpdate: false })).autoUpdate; } catch (_) { return false; }
}
// Com Auto update ligado verifica a cada 5 min; desligado, a cada 15 min.
async function scheduleUpdateAlarm() {
  const period = (await isAutoUpdateOn()) ? NEXUS_UPDATE.autoIntervalMinutes : NEXUS_UPDATE.intervalMinutes;
  const existing = await chrome.alarms.get('nexus-update-check');
  if (!existing || existing.periodInMinutes !== period) await chrome.alarms.create('nexus-update-check', { periodInMinutes: period });
}
scheduleUpdateAlarm().catch(() => {});

chrome.runtime.onInstalled.addListener((details) => {
  scheduleUpdateAlarm().catch(() => {});
  checkForNexusUpdate().catch(() => {});
  // Depois de uma atualização, avisa que terminou (as abas abertas precisam de F5).
  if (details && details.reason === 'update' && details.previousVersion && details.previousVersion !== NEXUS_UPDATE.currentVersion) {
    chrome.notifications.create('nexus-updated-' + NEXUS_UPDATE.currentVersion, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'Nexus YouTube+ atualizado',
      message: 'Agora na versão ' + NEXUS_UPDATE.currentVersion + '. Atualize as abas do YouTube (F5). Suas configurações foram mantidas.',
      priority: 1
    });
  }
});
chrome.runtime.onStartup.addListener(() => {
  scheduleUpdateAlarm().catch(() => {});
  checkForNexusUpdate().catch(() => {});
});
// Ligou/desligou o Auto update: ajusta o intervalo e, se ligou, já verifica.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.autoUpdate) {
    scheduleUpdateAlarm().catch(() => {});
    if (changes.autoUpdate.newValue) checkForNexusUpdate().catch(() => {});
  }
});

// "Quando entra": ao abrir o YouTube (a página consulta o status), verifica se há update.
let lastEnterCheck = 0;
async function checkOnEnter() {
  if (Date.now() - lastEnterCheck < 60000) return;
  lastEnterCheck = Date.now();
  if (await isAutoUpdateOn()) checkForNexusUpdate().catch(() => {});
}

// Atualização silenciosa (só com o Auto update ligado). Retorna true se iniciou a atualização.
let autoUpdateRunning = false;
async function tryAutoUpdate() {
  if (!(await isAutoUpdateOn()) || !self.NexusUpdater) return false;
  if (autoUpdateRunning) return true;
  const saved = await chrome.storage.local.get('nexusAutoUpdateFailedAt');
  if (Date.now() - Number(saved.nexusAutoUpdateFailedAt || 0) < 30 * 60 * 1000) return false; // espera após falha
  autoUpdateRunning = true;
  try {
    const handle = await NexusUpdater.kvGet('extDir');
    if (!handle || !(await NexusUpdater.ensurePermission(handle, false))) throw new Error('Pasta da extensão ainda não autorizada.');
    await NexusUpdater.runUpdate(handle, {});
    await chrome.storage.local.remove(['nexusAutoUpdateFailedAt', 'nexusAutoUpdateError']);
    setTimeout(() => chrome.runtime.reload(), 500);
    return true;
  } catch (e) {
    autoUpdateRunning = false;
    await chrome.storage.local.set({ nexusAutoUpdateFailedAt: Date.now(), nexusAutoUpdateError: String((e && e.message) || e) });
    return false;
  }
}

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
  if (msg.type === 'nexus-get-update-status') {
    checkOnEnter();
    chrome.storage.local.get(['nexusUpdateStatus', 'nexusUpdateSnoozeUntil'], (data) => {
      const status = data.nexusUpdateStatus || null;
      if (status && status.updateAvailable && Number(data.nexusUpdateSnoozeUntil || 0) <= Date.now()) {
        sendResponse({ show: true, status });
      } else {
        sendResponse({ show: false, status });
      }
    });
    return true;
  }
  if (msg.type === 'nexus-update-later') {
    chrome.storage.local.set({ nexusUpdateSnoozeUntil: Date.now() + NEXUS_UPDATE.snoozeMinutes * 60 * 1000 }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'nexus-start-auto-update') {
    const page = msg.setup ? 'update.html?setup=1' : 'update.html';
    chrome.windows.create({ url: chrome.runtime.getURL(page), type: 'popup', width: 540, height: 640 });
    sendResponse({ ok: true });
    return false;
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
async function showUpdatePromptInYouTube(status) {
  const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*'] });
  let delivered = false;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'nexus-show-update-prompt', status });
      delivered = true;
    } catch (_) {
      // A página pode ainda não ter terminado de carregar; ela consultará o status ao abrir.
    }
  }
  if (!delivered) {
    chrome.notifications.create('nexus-update-' + status.latestVersion, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'Nexus YouTube+ — novo update',
      message: 'A versão ' + status.latestVersion + ' está disponível. Abra o YouTube para ver as opções de atualização.',
      priority: 1
    });
  }
}
async function checkForNexusUpdate(manual = false) {
  // O verificador compartilhado baixa o ZIP do repositório e lê a versão
  // diretamente do extension/manifest.json; usa RAW como fallback se necessário.
  let remoteManifest;
  if (self.NexusUpdater && typeof NexusUpdater.fetchRemoteManifest === 'function') {
    remoteManifest = await NexusUpdater.fetchRemoteManifest();
  } else {
    const response = await fetch(NEXUS_UPDATE.manifestUrl + '?t=' + Date.now(), {
      cache: 'no-store', headers: { Accept: 'application/json, text/plain' }
    });
    if (!response.ok) throw new Error('GitHub respondeu HTTP ' + response.status);
    remoteManifest = await response.json();
  }
  const remoteVersion = String(remoteManifest.version || '');
  if (!parseVersion(remoteVersion)) throw new Error('A versão no manifesto remoto não está no formato X.Y.Z.');

  const updateAvailable = isNewerVersion(remoteVersion, NEXUS_UPDATE.currentVersion);
  const status = {
    ok: true,
    currentVersion: NEXUS_UPDATE.currentVersion,
    latestVersion: remoteVersion,
    updateAvailable,
    repositoryUrl: NEXUS_UPDATE.repositoryUrl,
    releasesUrl: NEXUS_UPDATE.releasesUrl,
    checkedAt: Date.now()
  };
  await chrome.storage.local.set({ nexusUpdateStatus: status });
  if (updateAvailable) {
    // Auto update ligado: atualiza direto, sem perguntar. Se não der (ex.: pasta não autorizada), cai no aviso normal.
    if (await tryAutoUpdate()) return status;
    const saved = await chrome.storage.local.get(['nexusUpdatePromptedVersion', 'nexusUpdateSnoozeUntil']);
    const snooze = Number(saved.nexusUpdateSnoozeUntil || 0);
    const shouldPrompt = manual ||
      saved.nexusUpdatePromptedVersion !== remoteVersion ||
      (snooze > 0 && snooze <= Date.now());
    if (shouldPrompt) {
      await showUpdatePromptInYouTube(status);
      await chrome.storage.local.set({ nexusUpdatePromptedVersion: remoteVersion });
    }
  } else {
    await chrome.storage.local.remove(['nexusUpdateSnoozeUntil', 'nexusUpdatePromptedVersion']);
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

