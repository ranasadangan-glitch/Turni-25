/* TurniDSP — Modal/overlay condivisi
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
function closeAll(){document.querySelectorAll(".overlay").forEach(o=>o.classList.remove("on"));}
document.querySelectorAll(".overlay").forEach(o=>o.addEventListener("click",e=>{if(e.target===o)closeAll();}));
