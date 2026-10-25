const DEFAULTS={feedBatchEnabled:true,feedBatchSize:7,performanceMode:true,enabled:true,gifButton:true,plusToolbar:true,searchHeart:true,autoUpdate:false,shortcuts:true,commentTools:true,backgroundColor:'#0f0f0f',backgroundImage:'',backgroundOpacity:25,backgroundTarget:'main',compactPanel:false,cleanShortsNav:false,cleanShortsShelves:false,cleanCommunityShelves:false,cleanCommerceButtons:false,cleanComments:false,cleanEndscreen:false};
const ids=Object.keys(DEFAULTS), $=id=>document.getElementById(id);
function read(){return new Promise(resolve=>chrome.storage.sync.get(DEFAULTS,resolve))}
function save(patch){$('saveStatus').innerHTML='<span class="status-dot"></span> Salvando configurações…';chrome.storage.sync.set(patch,()=>{$('saveStatus').innerHTML='<span class="status-dot"></span> Configurações salvas automaticamente';});}
function render(data){ids.forEach(id=>{const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=!!data[id];else el.value=data[id]??DEFAULTS[id];});const videoToggle=$('plusToolbarVideo');if(videoToggle)videoToggle.checked=!!data.plusToolbar;$('opacityValue').textContent=$('backgroundOpacity').value+'%';}
(async()=>{render(await read());ids.forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('change',()=>{const value=el.type==='checkbox'?el.checked:(el.type==='range'?Number(el.value):el.value);save({[id]:value});if(id==='backgroundOpacity')$('opacityValue').textContent=value+'%';});if(el.type==='range')el.addEventListener('input',()=>{if(el.id==='backgroundOpacity')$('opacityValue').textContent=el.value+'%';});});const videoToggle=$('plusToolbarVideo');if(videoToggle)videoToggle.addEventListener('change',()=>save({plusToolbar:videoToggle.checked}));})();
$('resetBackground').addEventListener('click',()=>{const patch={backgroundColor:DEFAULTS.backgroundColor,backgroundImage:'',backgroundOpacity:25,backgroundTarget:'main'};save(patch);read().then(render);});
$('resetAll').addEventListener('click',()=>{save(DEFAULTS);render(DEFAULTS);});


// Verificação manual e estado da versão publicada no GitHub.
const updateStatusEl = $('updateStatus');
function renderUpdateStatus(status) {
  if (!updateStatusEl) return;
  if (!status || !status.ok) { updateStatusEl.textContent = 'Não foi possível consultar o GitHub. Confira a conexão e tente novamente.'; return; }
  if (status.updateAvailable) {
    updateStatusEl.textContent = 'Atualização disponível no ZIP da Release do GitHub: v' + status.latestVersion + ' (instalada: v' + status.currentVersion + ').';
    return;
  }
  const remote = String(status.latestVersion || '').split('.').map(Number);
  const local = String(status.currentVersion || '').split('.').map(Number);
  let remoteOlder = false;
  for (let i = 0; i < 3; i++) {
    if ((remote[i] || 0) !== (local[i] || 0)) { remoteOlder = (remote[i] || 0) < (local[i] || 0); break; }
  }
  if (remoteOlder) {
    updateStatusEl.textContent = 'O ZIP da Release mais recente no GitHub está desatualizado: v' + status.latestVersion + '. A instalada é v' + status.currentVersion + '. Publique a nova versão como ZIP na Release mais recente para que o verificador a reconheça.';
  } else {
    updateStatusEl.textContent = 'Você está usando a versão mais recente publicada (v' + status.currentVersion + '). O ZIP no GitHub também informa v' + status.latestVersion + '.';
  }
}
if ($('checkUpdates')) $('checkUpdates').addEventListener('click', () => {
  updateStatusEl.textContent = 'Consultando GitHub…';
  chrome.runtime.sendMessage({type: 'nexus-check-update'}, (result) => {
    if (chrome.runtime.lastError) { renderUpdateStatus(null); return; }
    renderUpdateStatus(result);
  });
});
if ($('openReleases')) $('openReleases').addEventListener('click', () => {
  chrome.runtime.sendMessage({type: 'nexus-open-update-page'});
});
chrome.storage.local.get('nexusUpdateStatus', (data) => { if (data.nexusUpdateStatus) renderUpdateStatus(data.nexusUpdateStatus); });

$('resetClean').addEventListener('click',()=>{const patch={cleanShortsNav:false,cleanShortsShelves:false,cleanCommunityShelves:false,cleanCommerceButtons:false,cleanComments:false,cleanEndscreen:false};save(patch);render({...DEFAULTS,...patch});});

if ($('runAutoUpdate')) $('runAutoUpdate').addEventListener('click', () => { chrome.runtime.sendMessage({type: 'nexus-start-auto-update'}); });
// Ao ligar o Auto update sem pasta autorizada, abre a janela para escolher a pasta (uma vez só).
if ($('autoUpdate')) $('autoUpdate').addEventListener('change', async () => {
  if (!$('autoUpdate').checked) return;
  let handle = null;
  try {
    handle = await new Promise((resolve, reject) => {
      const req = indexedDB.open('nexus-update', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { const r = req.result.transaction('kv').objectStore('kv').get('extDir'); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); };
      req.onerror = () => reject(req.error);
    });
  } catch (_) {}
  if (!handle) chrome.runtime.sendMessage({type: 'nexus-start-auto-update', setup: true});
});
