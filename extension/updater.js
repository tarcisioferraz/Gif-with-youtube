// Nexus YouTube+ — lógica de atualização compartilhada (janela de atualização e segundo plano).
// Baixa os arquivos novos do GitHub e grava na pasta "sem compactação" da extensão, usando a
// pasta que o usuário autorizou uma vez (FileSystemDirectoryHandle guardado no IndexedDB).
(function (root) {
  'use strict';
  const REPO = { owner: 'tarcisioferraz', repo: 'Nexus-Youtube-', branch: 'main', dir: 'extension' };
  const RAW = 'https://raw.githubusercontent.com/' + REPO.owner + '/' + REPO.repo + '/' + REPO.branch + '/';
  const TREE_URL = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.repo + '/git/trees/' + REPO.branch + '?recursive=1';
  const FALLBACK_FILES = [
    'manifest.json', 'background.js', 'updater.js', 'content.js', 'content.css', 'search-heart.js', 'games-menu.js',
    'options.html', 'options.js', 'options.css', 'update.html', 'update.js', 'LEIA-ME.txt',
    'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png', 'icons/trophy.svg'
  ];
  const current = chrome.runtime.getManifest();

  /* ---------- IndexedDB (guarda a pasta autorizada) ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('nexus-update', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function kvGet(key) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function kvSet(key, value) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      if (value === null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- Versões ---------- */
  function parseVersion(v) {
    const m = String(v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? m.slice(1, 4).map(Number) : null;
  }
  function isNewer(remote, local) {
    const a = parseVersion(remote), b = parseVersion(local);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  }
  async function fetchRemoteManifest() {
    const r = await fetch(RAW + REPO.dir + '/manifest.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('GitHub respondeu HTTP ' + r.status);
    return r.json();
  }

  /* ---------- Pasta da extensão ---------- */
  async function resolveExtensionDir(handle) {
    // Aceita a própria pasta da extensão ou a pasta acima dela (que contém "extension").
    const tryDir = async (dir) => {
      try {
        const fh = await dir.getFileHandle('manifest.json');
        const m = JSON.parse(await (await fh.getFile()).text());
        return m && m.name === current.name ? { dir, manifest: m } : null;
      } catch (_) { return null; }
    };
    let found = await tryDir(handle);
    if (!found) { try { found = await tryDir(await handle.getDirectoryHandle('extension')); } catch (_) {} }
    return found;
  }
  async function ensurePermission(handle, interactive) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!interactive) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  /* ---------- Download e gravação ---------- */
  async function listRemoteFiles() {
    try {
      const r = await fetch(TREE_URL, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const prefix = REPO.dir + '/';
      const files = (data.tree || []).filter((n) => n.type === 'blob' && n.path.startsWith(prefix)).map((n) => n.path.slice(prefix.length));
      if (files.includes('manifest.json')) return files;
    } catch (_) {}
    return FALLBACK_FILES;
  }
  async function writeFile(rootDir, relPath, buffer) {
    const parts = relPath.split('/');
    const name = parts.pop();
    let dir = rootDir;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(buffer);
    await w.close();
  }

  // Baixa tudo primeiro; só grava se todos os downloads deram certo. Não recarrega a extensão.
  async function runUpdate(handle, hooks) {
    const status = (hooks && hooks.status) || (() => {});
    const progress = (hooks && hooks.progress) || (() => {});
    progress(0);
    const found = await resolveExtensionDir(handle);
    if (!found) {
      await kvSet('extDir', null);
      throw new Error('Essa não é a pasta da extensão (não achei o manifest.json do Nexus YouTube+). Selecione a pasta que você carregou no Chrome.');
    }
    if (found.manifest.version !== current.version) {
      await kvSet('extDir', null);
      throw new Error('Essa pasta está na versão ' + found.manifest.version + ', mas o Chrome está usando a ' + current.version + '. Selecione a pasta exata que foi carregada em chrome://extensions.');
    }

    status('Procurando arquivos novos no GitHub…');
    const files = await listRemoteFiles();
    const downloaded = [];
    for (let i = 0; i < files.length; i++) {
      status('Baixando ' + files[i] + ' (' + (i + 1) + '/' + files.length + ')…');
      const r = await fetch(RAW + REPO.dir + '/' + files[i] + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('Não consegui baixar ' + files[i] + ' (HTTP ' + r.status + '). Nada foi alterado.');
      downloaded.push([files[i], await r.arrayBuffer()]);
      progress(0.5 * (i + 1) / files.length);
    }

    const manifestEntry = downloaded.find((d) => d[0] === 'manifest.json');
    let remoteManifest = null;
    try { remoteManifest = JSON.parse(new TextDecoder().decode(manifestEntry[1])); } catch (_) {}
    if (!remoteManifest || remoteManifest.name !== current.name || !parseVersion(remoteManifest.version)) {
      throw new Error('O manifest baixado é inválido. Nada foi alterado.');
    }

    // manifest.json por último: se algo falhar no meio, a versão antiga continua marcada.
    downloaded.sort((a, b) => (a[0] === 'manifest.json') - (b[0] === 'manifest.json'));
    for (let i = 0; i < downloaded.length; i++) {
      status('Instalando ' + downloaded[i][0] + '…');
      await writeFile(found.dir, downloaded[i][0], downloaded[i][1]);
      progress(0.5 + 0.5 * (i + 1) / downloaded.length);
    }
    return remoteManifest;
  }

  root.NexusUpdater = {
    current, kvGet, kvSet, parseVersion, isNewer, fetchRemoteManifest,
    resolveExtensionDir, ensurePermission, runUpdate
  };
})(typeof self !== 'undefined' ? self : window);
