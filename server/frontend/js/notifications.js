/* TurniDSP — Sistema notifiche
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
async function loadNotifications() {
  try {
    const data = await TurniApi.notifications({limit:30});
    const badge=$d('notifBadge');
    if(data.unread_count>0){ badge.style.display='inline-block'; badge.textContent=data.unread_count>99?'99+':data.unread_count; }
    else badge.style.display='none';
    const sevColors={critical:'var(--bad)',warning:'var(--warn)',info:'var(--brand)'};
    $d('notifList').innerHTML = data.rows.length
      ? data.rows.map(n=>`<div class="ph-notif-item${n.read_at?'':' unread'}" onclick="clickNotif(${n.id},'${esc(n.action_url||'')}')">
          <div class="ph-notif-title">
            <span class="ph-notif-sev-dot" style="background:${sevColors[n.severity]||'var(--brand)'}"></span>
            ${esc(n.title||'')}
          </div>
          ${n.body?`<div class="ph-notif-body">${esc(n.body)}</div>`:''}
          <div class="ph-notif-ts">${fmtTs(n.created_at)}</div>
        </div>`).join('')
      : '<div style="padding:20px;text-align:center;font-size:.8rem;color:var(--text-muted)">Nessuna notifica</div>';
  } catch {}
}
// clickNotif() defined in SPA layer below
// markAllRead() defined in SPA layer below
// NOTE: the legacy toggleNotif() + a document click-handler used to live here.
// They were removed: toggleNotif() was unreferenced (the app uses
// toggleNotifPanel), and the click-handler duplicated the live one below while
// dereferencing a removed #searchDd element (throwing on every click). The SPA
// versions further down (toggleNotifPanel + the #searchDropdown click-handler)
// are the single source of truth.

async function loadNotifPanel() {
  try {
    var data = await TurniApi.notifications({limit:30});
    var badge = document.getElementById('notifBadge');
    if(data.unread_count>0){badge.style.display='inline-block';badge.textContent=data.unread_count>99?'99+':data.unread_count;}
    else badge.style.display='none';
    var sevC={critical:'var(--bad)',warning:'var(--warn)',info:'var(--brand)'};
    document.getElementById('notifList').innerHTML = data.rows.length
      ? data.rows.map(function(n){
          return '<div class="ph-notif-item'+(n.read_at?'':' unread')+'" onclick="clickNotif('+n.id+',\''+esc(n.action_url||'')+'\')">'+
            '<div class="ph-notif-title"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+(sevC[n.severity]||'var(--brand)')+';margin-right:4px;vertical-align:middle"></span>'+esc(n.title||'')+'</div>'+
            (n.body?'<div class="ph-notif-body">'+esc(n.body)+'</div>':'')+
            '<div class="ph-notif-ts">'+fmtTs(n.created_at)+'</div></div>';
        }).join('')
      : '<div style="padding:20px;text-align:center;font-size:.8rem;color:var(--text-muted)">Nessuna notifica</div>';
  } catch {}
}
function navFromUrl(url){
  try{
    var h=(url.indexOf('#')>=0)?url.slice(url.indexOf('#')+1):'';
    if(/employees/i.test(url)){var m=h.match(/(\d+)/);navigate('employees');if(m&&typeof openProfile==='function')setTimeout(function(){openProfile(+m[1]);},400);return true;}
    if(/scheduler|dashboard/i.test(url)||h==='scheduler'){navigate('scheduler');return true;}
    if(/reports|analytics/i.test(url)){navigate('reports');return true;}
  }catch(e){}
  return false;
}
async function clickNotif(id,url){try{await TurniApi.markRead(id);}catch{} if(url){ if(navFromUrl(url)){toggleNotifPanel();} else location.href=url; } else toggleNotifPanel(); loadNotifPanel();}
async function markAllRead(){try{await TurniApi.markAllRead();loadNotifPanel();}catch{}}
function toggleNotifPanel(){
  _notifOpen=!_notifOpen;
  document.getElementById('notifPanel').style.display=_notifOpen?'block':'none';
  if(_notifOpen) loadNotifPanel();
}
document.addEventListener('click',function(e){
  if(_notifOpen&&!e.target.closest('#notifPanel')&&!e.target.closest('.ph-notif-btn')){_notifOpen=false;document.getElementById('notifPanel').style.display='none';}
  if(document.getElementById('searchDropdown').style.display!=='none'&&!e.target.closest('.ph-search')) document.getElementById('searchDropdown').style.display='none';
});

