// Nexus YouTube+ — lógica de atualização compartilhada (janela de atualização e segundo plano).
// Baixa os arquivos novos do GitHub e grava na pasta "sem compactação" da extensão, usando a
// pasta que o usuário autorizou uma vez (FileSystemDirectoryHandle guardado no IndexedDB).
(function (root) {
  'use strict';
  const REPO = { owner: 'tarcisioferraz', repo: 'Nexus-YoutubePlus', branch: 'main', dir: 'extension' };
  const API = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.repo;
  const RAW = 'https://raw.githubusercontent.com/' + REPO.owner + '/' + REPO.repo + '/' + REPO.branch + '/';
  const ZIP_URL = 'https://codeload.github.com/' + REPO.owner + '/' + REPO.repo + '/zip/refs/heads/' + REPO.branch;
  const LATEST_RELEASE_URL = API + '/releases/latest';
  const FALLBACK_FILES = [
    'manifest.json', 'background.js', 'updater.js', 'content.js', 'content.css', 'search-heart.js', 'games-menu.js', 'feed-optimizer.js', 'youtube-performance.css',
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
  // Lê o diretório central do ZIP. Os caminhos são usados apenas dentro da pasta extension/;
  // caminhos absolutos e segmentos ".." são descartados para impedir gravação fora da extensão.
  async function readZipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (i + 4 <= bytes.length && view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('O ZIP baixado não tem diretório central válido.');
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) {
        throw new Error('O diretório central do ZIP está corrompido.');
      }
      const method = view.getUint16(pos + 10, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const uncompressedSize = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
      if (name && !name.endsWith('/') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..')) {
        entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function unzipEntry(buffer, entry) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const o = entry.localOffset;
    if (o + 30 > bytes.length || view.getUint32(o, true) !== 0x04034b50) {
      throw new Error('Cabeçalho de arquivo inválido dentro do ZIP.');
    }
    const nameLen = view.getUint16(o + 26, true);
    const extraLen = view.getUint16(o + 28, true);
    const start = o + 30 + nameLen + extraLen;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new Error('Arquivo incompleto dentro do ZIP: ' + entry.name);
    const compressed = bytes.slice(start, end);
    let raw;
    if (entry.method === 0) raw = compressed;
    else if (entry.method === 8 && typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error('Método de compactação ZIP não suportado (' + entry.method + ') no arquivo ' + entry.name);
    }
    if (entry.uncompressedSize && raw.length !== entry.uncompressedSize) {
      throw new Error('Tamanho inválido ao extrair ' + entry.name + ' do ZIP.');
    }
    return raw;
  }

  async function unpackExtensionZip(buffer) {
    const entries = await readZipEntries(buffer);
    // Prefere extension/manifest.json em qualquer nível (asset de release ou ZIP do repositório).
    let manifestEntry = entries.find((e) => /(^|\/)extension\/manifest\.json$/i.test(e.name));
    let prefix = '';
    if (manifestEntry) {
      const marker = manifestEntry.name.toLowerCase().lastIndexOf('extension/manifest.json');
      prefix = manifestEntry.name.slice(0, marker) + manifestEntry.name.slice(marker, marker + 'extension/'.length);
    } else {
      // Também aceita um ZIP que contenha diretamente os arquivos da extensão.
      manifestEntry = entries.find((e) => /(^|\/)manifest\.json$/i.test(e.name));
      if (!manifestEntry) throw new Error('Não encontrei extension/manifest.json dentro do ZIP.');
      prefix = manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('manifest.json'));
    }

    const selected = entries.filter((e) => e.name.startsWith(prefix)).map((e) => ({
      path: e.name.slice(prefix.length), entry: e
    })).filter((e) => e.path && !e.path.startsWith('/') && !e.path.split('/').includes('..'));
    const unpacked = [];
    for (const item of selected) {
      const data = await unzipEntry(buffer, item.entry);
      unpacked.push([item.path, data]);
    }
    const manifestFile = unpacked.find((f) => f[0] === 'manifest.json');
    if (!manifestFile) throw new Error('O manifesto não foi extraído do ZIP.');
    let manifest;
    try { manifest = JSON.parse(new TextDecoder().decode(manifestFile[1])); }
    catch (_) { throw new Error('O manifest.json dentro do ZIP não contém JSON válido.'); }
    if (!manifest || manifest.name !== current.name || !parseVersion(manifest.version)) {
      throw new Error('O manifest.json do ZIP não é válido para o Nexus YouTube+.');
    }
    return { manifest, files: unpacked };
  }

  async function downloadZip(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'nexus_cache_bust=' + Date.now(), {
      cache: 'no-store', headers: { Accept: 'application/zip, application/octet-stream, application/vnd.github+json' }
    });
    if (!r.ok) throw new Error('Download do ZIP respondeu HTTP ' + r.status);
    return await r.arrayBuffer();
  }

  // Usa o ZIP anexado à Release mais recente; se a API/asset falhar, tenta o ZIP da branch main.
  // A versão é sempre lida do manifest.json extraído do arquivo, nunca do nome da tag ou do ZIP.
  async function fetchRemotePackage() {
    let releaseError = null;
    try {
      const r = await fetch(LATEST_RELEASE_URL + '?nexus_cache_bust=' + Date.now(), {
        cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }
      });
      if (!r.ok) throw new Error('Consulta de Releases respondeu HTTP ' + r.status);
      const release = await r.json();
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = assets.find((a) => /\.zip$/i.test(a.name || '') && a.browser_download_url);
      if (!asset) throw new Error('A Release mais recente não tem um arquivo ZIP anexado.');
      const packageData = await unpackExtensionZip(await downloadZip(asset.browser_download_url));
      packageData.source = { type: 'release', tag: String(release.tag_name || ''), asset: asset.name || '', url: asset.browser_download_url };
      return packageData;
    } catch (e) { releaseError = e; }

    try {
      const packageData = await unpackExtensionZip(await downloadZip(ZIP_URL));
      packageData.source = { type: 'main', tag: REPO.branch, asset: 'ZIP da branch main', url: ZIP_URL };
      return packageData;
    } catch (zipError) {
      throw new Error('Não consegui baixar/extrair o ZIP da Release nem o ZIP da branch main. Release: ' +
        ((releaseError && releaseError.message) || releaseError) + '; main: ' + ((zipError && zipError.message) || zipError));
    }
  }

  async function fetchRemoteManifest() {
    return (await fetchRemotePackage()).manifest;
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

  /* ---------- Gravação da extensão ---------- */
  async function writeFile(rootDir, relPath, buffer) {
    const normalized = String(relPath || '').replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error('Caminho inseguro encontrado no ZIP: ' + relPath);
    }
    const parts = normalized.split('/').filter(Boolean);
    const name = parts.pop();
    let dir = rootDir;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(buffer);
    await w.close();
  }

  // Baixa um único ZIP, extrai os arquivos da pasta extension/, valida o manifesto e só então grava.
  async function runUpdate(handle, hooks) {
    const status = (hooks && hooks.status) || (() => {});
    const progress = (hooks && hooks.progress) || (() => {});
    progress(0);
    const found = await resolveExtensionDir(handle);
    if (!found) {
      await kvSet('extDir', null);
      throw new Error('Essa não é a pasta da extensão (não achei o manifest.json do Nexus YouTube+). Selecione a pasta que você carregou em chrome://extensions.');
    }
    if (found.manifest.version !== current.version) {
      await kvSet('extDir', null);
      throw new Error('Essa pasta está na versão ' + found.manifest.version + ', mas o Chrome está usando a ' + current.version + '. Selecione a pasta exata que foi carregada em chrome://extensions.');
    }

    status('Baixando o ZIP da versão mais recente do GitHub…');
    const remotePackage = await fetchRemotePackage();
    const remoteManifest = remotePackage.manifest;
    if (!isNewer(remoteManifest.version, current.version)) {
      throw new Error('O ZIP publicado no GitHub contém a v' + remoteManifest.version + ', mas a extensão instalada é a v' + current.version + '. Nenhum arquivo foi alterado. Publique uma Release com o ZIP e o manifest.json atualizados.');
    }
    const downloaded = remotePackage.files;
    if (!downloaded.some((f) => f[0] === 'background.js') || !downloaded.some((f) => f[0] === 'content.js')) {
      throw new Error('O ZIP não contém os arquivos principais da extensão. Nada foi alterado.');
    }

    // Grava o manifesto por último, para não declarar uma versão nova antes dos demais arquivos.
    downloaded.sort((a, b) => (a[0] === 'manifest.json') - (b[0] === 'manifest.json'));
    for (let i = 0; i < downloaded.length; i++) {
      status('Instalando ' + downloaded[i][0] + ' (' + (i + 1) + '/' + downloaded.length + ')…');
      await writeFile(found.dir, downloaded[i][0], downloaded[i][1]);
      progress((i + 1) / downloaded.length);
    }
    return remoteManifest;
  }

  root.NexusUpdater = {
    current, kvGet, kvSet, parseVersion, isNewer, fetchRemoteManifest, fetchRemotePackage,
    resolveExtensionDir, ensurePermission, runUpdate
  };
})(typeof self !== 'undefined' ? self : window);
