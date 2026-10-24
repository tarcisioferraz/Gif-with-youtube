const DEFAULTS={enabled:true,gifButton:true,plusToolbar:true,searchHeart:true,shortcuts:true,commentTools:true,backgroundColor:'#0f0f0f',backgroundImage:'',backgroundOpacity:25,backgroundTarget:'main',compactPanel:false,cleanShortsNav:false,cleanShortsShelves:false,cleanCommunityShelves:false,cleanCommerceButtons:false,cleanComments:false,cleanEndscreen:false,ambientLight:false,ambientIntensity:65};
const ids=Object.keys(DEFAULTS), $=id=>document.getElementById(id);
function read(){return new Promise(resolve=>chrome.storage.sync.get(DEFAULTS,resolve))}
function save(patch){$('saveStatus').innerHTML='<span class="status-dot"></span> Salvando configurações…';chrome.storage.sync.set(patch,()=>{$('saveStatus').innerHTML='<span class="status-dot"></span> Configurações salvas automaticamente';});}
function render(data){ids.forEach(id=>{const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=!!data[id];else el.value=data[id]??DEFAULTS[id];});const videoToggle=$('plusToolbarVideo');if(videoToggle)videoToggle.checked=!!data.plusToolbar;$('opacityValue').textContent=$('backgroundOpacity').value+'%';const ambientOut=$('ambientIntensityValue');if(ambientOut)ambientOut.textContent=($('ambientIntensity')?.value||65)+'%';}
(async()=>{render(await read());ids.forEach(id=>{const el=$(id);if(!el)return;el.addEventListener('change',()=>{const value=el.type==='checkbox'?el.checked:(el.type==='range'?Number(el.value):el.value);save({[id]:value});if(id==='backgroundOpacity')$('opacityValue').textContent=value+'%';if(id==='ambientIntensity'&&$('ambientIntensityValue'))$('ambientIntensityValue').textContent=value+'%';});if(el.type==='range')el.addEventListener('input',()=>{if(el.id==='backgroundOpacity')$('opacityValue').textContent=el.value+'%';if(el.id==='ambientIntensity'&&$('ambientIntensityValue'))$('ambientIntensityValue').textContent=el.value+'%';});});const videoToggle=$('plusToolbarVideo');if(videoToggle)videoToggle.addEventListener('change',()=>save({plusToolbar:videoToggle.checked}));})();
$('resetBackground').addEventListener('click',()=>{const patch={backgroundColor:DEFAULTS.backgroundColor,backgroundImage:'',backgroundOpacity:25,backgroundTarget:'main'};save(patch);read().then(render);});
$('resetAll').addEventListener('click',()=>{save(DEFAULTS);render(DEFAULTS);});


// Verificação manual e estado da versão publicada no GitHub.
const updateStatusEl = $('updateStatus');
function renderUpdateStatus(status) {
  if (!updateStatusEl) return;
  if (!status || !status.ok) { updateStatusEl.textContent = 'Não foi possível consultar o GitHub. Confira a conexão e tente novamente.'; return; }
  if (status.updateAvailable) updateStatusEl.textContent = 'Atualização disponível: v' + status.latestVersion + ' (instalada: v' + status.currentVersion + '). Clique em “Abrir versões no GitHub” para baixar.';
  else updateStatusEl.textContent = 'Você está usando v' + status.currentVersion + '. Versão informada pelo GitHub: v' + status.latestVersion + '.';
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

$('resetClean').addEventListener('click',()=>{const patch={cleanShortsNav:false,cleanShortsShelves:false,cleanCommunityShelves:false,cleanCommerceButtons:false,cleanComments:false,cleanEndscreen:false,ambientLight:false,ambientIntensity:65};save(patch);render({...DEFAULTS,...patch});});
