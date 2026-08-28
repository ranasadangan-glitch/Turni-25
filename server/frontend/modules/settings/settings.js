/* TurniDSP — Settings (gestione utenti)
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
// ── User management ───────────────────────────────────────────────
var _usersCache = [];
async function loadUsers(){
  try{
    var rows=await TurniApi.users();
    _usersCache = rows;
    var rl=function(r){return {admin:'Admin',osm:'OSM',hr_manager:'HR Manager',team_leader:'Team Leader'}[r]||r;};
    var fmtTs2=function(d){return d?new Date(d).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}):'—';};
    var branchCell=function(u){
      var codes=(u.branch_codes||[]);
      // admin sees everything; other roles are scoped to assigned branches
      if(u.role==='admin') return '<span class="text-xs text-muted">tutte</span>';
      var chips=codes.length?codes.map(function(c){return '<span class="badge b-pri" style="margin:1px">'+esc(c)+'</span>';}).join(''):'<span class="text-xs text-muted">nessuna</span>';
      return chips+' <button class="btn ghost sm" ' + actAttr('click','openAssignBranches',[u.id]) + '>Assegna</button>';
    };
    document.getElementById('usersTbl').innerHTML='<thead><tr><th>Username</th><th>Nome</th><th>Ruolo</th><th>Filiali</th><th>Stato</th><th>Ultimo accesso</th><th></th></tr></thead><tbody>'+
      rows.map(function(u){return '<tr><td><b>'+esc(u.username)+'</b></td><td>'+esc(u.full_name||'')+'</td>'+
        '<td>'+rl(u.role)+'</td>'+
        '<td>'+branchCell(u)+'</td>'+
        '<td><span class="badge '+(u.active?'b-ok':'b-warn')+'">'+(u.active?'attivo':'disattivo')+'</span></td>'+
        '<td style="font-size:.78rem;color:var(--text-muted)">'+fmtTs2(u.last_login)+'</td>'+
        '<td style="display:flex;gap:5px"><button class="btn ghost sm" ' + actAttr('click','toggleUser',[u.id, !u.active]) + '>'+(u.active?'Disattiva':'Attiva')+'</button>'+
        '<button class="btn ghost sm" ' + actAttr('click','resetPw',[u.id]) + '>Reset pw</button></td></tr>';
      }).join('')+'</tbody>';
  } catch(e){document.getElementById('usersTbl').innerHTML='<tbody><tr><td class="text-muted">'+esc(e.message)+'</td></tr></tbody>';}
}

// ── Assign branches (filiali) to a user, e.g. an OSM manager ───────
async function openAssignBranches(userId){
  var u=_usersCache.find(function(x){return x.id===userId;});
  if(!u)return;
  var branches=[];
  try{ branches=await TurniApi.branches(); }catch(e){}
  var assigned=(u.branch_ids||[]).map(String);
  document.getElementById('abUserName').textContent=u.username+(u.full_name?' · '+u.full_name:'');
  document.getElementById('abUserRole').textContent={admin:'Admin',osm:'OSM',hr_manager:'HR Manager',team_leader:'Team Leader'}[u.role]||u.role;
  document.getElementById('abBranches').innerHTML=branches.map(function(b){
    return '<label class="ab-branch"><input type="checkbox" value="'+b.id+'"'+(assigned.includes(String(b.id))?' checked':'')+'> '+esc(b.code)+(b.name?' <span class="text-xs text-muted">'+esc(b.name)+'</span>':'')+'</label>';
  }).join('')||'<span class="text-muted">Nessuna filiale.</span>';
  document.getElementById('abModal').dataset.userId=userId;
  document.getElementById('abMsg').textContent='';
  document.getElementById('abModal').classList.add('on');
}
async function saveAssignBranches(){
  var userId=+document.getElementById('abModal').dataset.userId;
  var branch_ids=Array.prototype.slice.call(document.querySelectorAll('#abBranches input:checked')).map(function(c){return +c.value;});
  try{
    await TurniApi.updateUser(userId,{branch_ids:branch_ids});
    closeAll();
    toast('Filiali assegnate','ok');
    loadUsers();
  }catch(e){document.getElementById('abMsg').textContent=e.message;}
}
async function createUser(){
  var $m=document.getElementById('nuMsg');$m.textContent='';
  var branch_ids=Array.from(document.getElementById('nuBranches').selectedOptions).map(function(o){return +o.value;});
  var payload={username:document.getElementById('nuUser').value.trim(),password:document.getElementById('nuPass').value,full_name:document.getElementById('nuName').value.trim(),role:document.getElementById('nuRole').value,branch_ids:branch_ids};
  if(!payload.username||!payload.password){$m.style.color='var(--bad)';$m.textContent='Username e password obbligatori.';return;}
  try{await TurniApi.createUser(payload);$m.style.color='var(--ok)';$m.textContent='Account creato.';document.getElementById('nuUser').value='';document.getElementById('nuPass').value='';document.getElementById('nuName').value='';loadUsers();}
  catch(e){$m.style.color='var(--bad)';$m.textContent=e.message;}
}
async function toggleUser(id,active){try{await TurniApi.updateUser(id,{active});toast(active?'Utente attivato':'Disattivato');loadUsers();}catch(e){toast(e.message,'bad');}}
async function resetPw(id){var pw=prompt('Nuova password:');if(!pw)return;try{await TurniApi.updateUser(id,{password:pw});toast('Password aggiornata');}catch(e){toast(e.message,'bad');}}

// ── Init: boot dashboard on start, handle hash ────────────────────
