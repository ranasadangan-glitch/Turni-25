const $ = (id) => document.getElementById(id);
if (TurniApi.isLoggedIn() && TurniApi.user()) location.replace('app.html');
const saved = localStorage.getItem('turnidsp_api_base'); if (saved) $('apiBase').value = saved;

$('f').addEventListener('submit', doLogin);

// ---- password dimenticata (pannello inline, due passaggi) ----
$('fpLink').addEventListener('click', () => {
  $('fpPanel').classList.toggle('hide');
  $('fpMsg').textContent = '';
});
$('fpReqBtn').addEventListener('click', async () => {
  const id = $('fpUser').value.trim();
  $('fpMsg').className = 'fp-msg';
  if (!id) { $('fpMsg').textContent = 'Inserisci username o email.'; $('fpMsg').className = 'fp-msg err'; return; }
  $('fpReqBtn').disabled = true;
  try {
    const r = await TurniApi.forgotPassword(id);
    $('fpMsg').textContent = r.message || 'Se l’account esiste, riceverai le istruzioni.';
    $('fpMsg').className = 'fp-msg ok';
    $('fpStep2').classList.remove('hide');
    // In sviluppo (o senza SMTP configurato) il server restituisce il codice
    // direttamente, per poter testare il flusso senza una casella email.
    if (r.dev_token) $('fpToken').value = r.dev_token;
  } catch (e) {
    $('fpMsg').textContent = e.message || 'Richiesta non riuscita.';
    $('fpMsg').className = 'fp-msg err';
  } finally {
    $('fpReqBtn').disabled = false;
  }
});
$('fpResetBtn').addEventListener('click', async () => {
  const tok = $('fpToken').value.trim();
  const pw = $('fpNewPass').value;
  $('fpMsg').className = 'fp-msg';
  if (!tok || !pw) { $('fpMsg').textContent = 'Inserisci il codice e la nuova password.'; $('fpMsg').className = 'fp-msg err'; return; }
  $('fpResetBtn').disabled = true;
  try {
    const r = await TurniApi.resetPassword(tok, pw);
    $('fpMsg').textContent = r.message || 'Password aggiornata. Accedi con la nuova password.';
    $('fpMsg').className = 'fp-msg ok';
    $('fpStep2').classList.add('hide');
    $('u').value = $('fpUser').value.trim();
    $('p').focus();
  } catch (e) {
    $('fpMsg').textContent = e.message || 'Reset non riuscito.';
    $('fpMsg').className = 'fp-msg err';
  } finally {
    $('fpResetBtn').disabled = false;
  }
});

async function doLogin(ev){
  ev.preventDefault();
  $('err').textContent = '';
  $('btn').disabled = true; $('btn').textContent = 'Accesso…';
  TurniApi.setApiBase($('apiBase').value.trim());
  try{
    await TurniApi.login($('u').value.trim(), $('p').value);
    location.replace('app.html');
  }catch(e){
    // Always surface *something*, even for raw network errors (e.g. offline,
    // blocked request, unexpected redirect) so the button never just sits there.
    $('err').textContent = (e && e.message) ? e.message : 'Accesso non riuscito. Controlla la connessione e riprova.';
  }finally{
    $('btn').disabled = false; $('btn').textContent = 'Accedi';
  }
}
