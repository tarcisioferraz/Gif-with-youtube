// Nexus YouTube+ — janela de atualização (usa updater.js).
const U = NexusUpdater;
const $ = (id) => document.getElementById(id);
const current = U.current;
const SETUP = new URLSearchParams(location.search).get('setup') === '1';

function setStatus(text, kind) { const s = $('status'); s.textContent = text; s.className = kind || ''; }
function setProgress(p) { $('progress').style.width = Math.round(p * 100) + '%'; }
function show(id, on) { $(id).hidden = !on; }
const hooks = { status: (t) => setStatus(t), progress: setProgress };

function friendly(e) {
  const msg = (e && e.message) || String(e);
  if (e && e.name === 'AbortError') return 'Seleção cancelada.';
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'O Chrome não permitiu gravar nessa pasta. Escolha a pasta da extensão (não escolha Downloads/Documentos inteiros).';
  return msg;
}

async function doUpdate(handle) {
  show('pickBtn', false); show('allowBtn', false); show('changeBtn', false);
  const remote = await U.runUpdate(handle, hooks);
  setStatus('Atualizado para a v' + remote.version + '! Reiniciando a extensão… depois atualize as abas do YouTube (F5).', 'ok');
  setProgress(1);
  setTimeout(() => chrome.runtime.reload(), 1500);
}

async function guard(fn) {
  try { await fn(); }
  catch (e) { setStatus(friendly(e), 'err'); setProgress(0); show('pickBtn', true); show('changeBtn', false); show('allowBtn', false); }
}

async function pickFolder() {
  await guard(async () => {
    const handle = await window.showDirectoryPicker({ id: 'nexus-extension-folder', mode: 'readwrite' });
    const found = await U.resolveExtensionDir(handle);
    if (!found) throw new Error('Não achei o manifest.json do Nexus YouTube+ nessa pasta. Selecione a pasta que você carregou em chrome://extensions.');
    if (found.manifest.version !== current.version) throw new Error('Essa pasta está na versão ' + found.manifest.version + ', mas o Chrome está usando a ' + current.version + '. Selecione a pasta exata carregada em chrome://extensions.');
    await U.kvSet('extDir', found.dir);
    const remote = await U.fetchRemoteManifest().catch(() => null);
    if (remote && U.isNewer(remote.version, current.version)) {
      await doUpdate(found.dir);
    } else {
      setStatus('Pronto! A pasta foi autorizada. O auto update já pode atualizar sozinho.', 'ok');
      setProgress(1);
      show('changeBtn', true);
    }
  });
}

async function main() {
  $('versions').textContent = 'Versão instalada: v' + current.version;
  $('pickBtn').addEventListener('click', pickFolder);
  $('changeBtn').addEventListener('click', pickFolder);
  $('allowBtn').addEventListener('click', () => guard(async () => {
    const handle = await U.kvGet('extDir');
    if (!handle || !(await U.ensurePermission(handle, true))) throw new Error('Permissão não concedida.');
    if (SETUP) { setStatus('Pronto! A permissão foi concedida.', 'ok'); setProgress(1); show('allowBtn', false); return; }
    await doUpdate(handle);
  }));

  const handle = await U.kvGet('extDir').catch(() => null);

  // Modo de configuração (aberto ao ligar o Auto update): só escolhe/autoriza a pasta.
  if (SETUP) {
    if (!handle) {
      setStatus('Para o auto update funcionar, selecione a pasta da extensão (a mesma que você carregou em chrome://extensions). Só precisa fazer isso uma vez.');
      $('hint').textContent = 'É a pasta que contém o manifest.json. O Chrome vai pedir permissão para a extensão gravar nela.';
      show('pickBtn', true);
    } else if (await U.ensurePermission(handle, false)) {
      setStatus('Tudo certo! O auto update já está autorizado.', 'ok'); setProgress(1); show('changeBtn', true);
    } else {
      setStatus('Clique para permitir que a extensão grave na pasta (necessário para o auto update).');
      show('allowBtn', true); show('changeBtn', true);
    }
    return;
  }

  try {
    const remote = await U.fetchRemoteManifest();
    $('versions').textContent = 'Instalada: v' + current.version + '  →  GitHub: v' + remote.version;
    if (!U.isNewer(remote.version, current.version)) {
      const rv = String(remote.version).split('.').map(Number), cv = String(current.version).split('.').map(Number);
      let remoteOlder = false;
      for (let i = 0; i < 3; i++) { if ((rv[i] || 0) !== (cv[i] || 0)) { remoteOlder = (rv[i] || 0) < (cv[i] || 0); break; } }
      if (remoteOlder) {
        setStatus('O ZIP publicado na Release mais recente é a v' + remote.version + ', anterior à instalada (v' + current.version + '). Publique uma Release com o ZIP e o manifest.json atualizados.', 'err');
      } else {
        setStatus('Você já está na versão mais recente publicada (v' + current.version + ').', 'ok');
      }
      setProgress(1);
      return;
    }
  } catch (e) {
    setStatus('Não consegui consultar o GitHub: ' + friendly(e), 'err');
    return;
  }

  if (!handle) {
    setStatus('Primeira vez: selecione a pasta da extensão (a mesma que você carregou em chrome://extensions). Só precisa fazer isso uma vez.');
    $('hint').textContent = 'É a pasta que contém o manifest.json. O Chrome vai pedir permissão para a extensão gravar nela.';
    show('pickBtn', true);
    return;
  }
  if (await U.ensurePermission(handle, false)) {
    guard(() => doUpdate(handle));
  } else {
    setStatus('Nova versão disponível. Clique para permitir que a extensão grave na pasta e atualizar.');
    show('allowBtn', true); show('changeBtn', true);
  }
}
main();
