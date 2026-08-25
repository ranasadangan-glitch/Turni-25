/* TurniDSP — Analytics/Reports charts
   Estratto dal monolite app.html: stesso scope globale, stesso comportamento.
   Ordine di caricamento definito in app.html (vedi fondo pagina). */
async function renderReportCharts() {
  var d;
  try { d = await TurniApi.kpi({ date: new Date().toISOString().slice(0,10) }); } catch(e) { return; }
  function destroy(id){ if(_rptCharts[id]){_rptCharts[id].destroy();delete _rptCharts[id];} }
  var opts = { responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false}},
    scales:{x:{grid:{display:false},ticks:{maxTicksLimit:8,font:{size:11}}},
            y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{font:{size:11}}}}
  };
  if(d.attendance_trend && d.attendance_trend.length){
    destroy('rptChartAtt');
    _rptCharts.rptChartAtt = new Chart(document.getElementById('rptChartAtt'),{
      type:'bar',
      data:{labels:d.attendance_trend.map(r=>r.d.slice(5)),
            datasets:[{label:'Presenti',data:d.attendance_trend.map(r=>r.present),backgroundColor:'rgba(5,150,105,.75)',borderRadius:4},
                      {label:'Assenti', data:d.attendance_trend.map(r=>r.absent), backgroundColor:'rgba(220,38,38,.55)',borderRadius:4}]},
      options:{...opts,plugins:{...opts.plugins,legend:{display:true,position:'top',labels:{font:{size:12}}}}}
    });
  }
  if(d.forecast_trend && d.forecast_trend.length){
    destroy('rptChartFc');
    _rptCharts.rptChartFc = new Chart(document.getElementById('rptChartFc'),{
      type:'line',
      data:{labels:d.forecast_trend.map(r=>r.d.slice(5)),
            datasets:[{label:'Forecast',data:d.forecast_trend.map(r=>r.forecast),borderColor:'var(--brand)',backgroundColor:'rgba(79,70,229,.1)',tension:.4,fill:true,pointRadius:3},
                      {label:'Pianif.', data:d.forecast_trend.map(r=>r.planned), borderColor:'var(--ok)',  backgroundColor:'rgba(5,150,105,.05)',tension:.4,fill:false,pointRadius:3}]},
      options:{...opts,plugins:{...opts.plugins,legend:{display:true,position:'top',labels:{font:{size:12}}}}}
    });
  }
  if(d.absence_types && d.absence_types.length){
    destroy('rptChartAbs');
    _rptCharts.rptChartAbs = new Chart(document.getElementById('rptChartAbs'),{
      type:'doughnut',
      data:{labels:d.absence_types.map(r=>r.absence_type),
            datasets:[{data:d.absence_types.map(r=>r.cnt),backgroundColor:['var(--brand)','var(--ok)','var(--warn)','var(--bad)','var(--purple)','var(--teal)','#F59E0B','#6B7280'],borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:12},padding:10}}}}
    });
  }
  if(d.employee_growth && d.employee_growth.length){
    destroy('rptChartGrow');
    _rptCharts.rptChartGrow = new Chart(document.getElementById('rptChartGrow'),{
      type:'bar',
      data:{labels:d.employee_growth.map(r=>r.month),
            datasets:[{label:'Nuovi',data:d.employee_growth.map(r=>r.added),backgroundColor:'rgba(79,70,229,.75)',borderRadius:6}]},
      options:opts
    });
  }
  // Wire export links
  var ym = new Date().toISOString().slice(0,7);
  var rptExpEmp = document.getElementById('rptExpEmp'); if(rptExpEmp) rptExpEmp.href = TurniApi.xlsxExportUrl('employees');
  var rptExpFc  = document.getElementById('rptExpFc');  if(rptExpFc)  rptExpFc.href  = TurniApi.xlsxExportUrl('forecast',{month:ym});
  var rptExpSch = document.getElementById('rptExpSch'); if(rptExpSch) rptExpSch.href = TurniApi.xlsxExportUrl('schedule',{month:ym});
  var addDays=(iso,n)=>{const d=new Date(iso);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  var rptPdfMonth = document.getElementById('rptPdfMonth'); if(rptPdfMonth) rptPdfMonth.href = TurniApi.pdfUrl('schedule/monthly',{month:ym});
  var rptPdfAbs   = document.getElementById('rptPdfAbs');   if(rptPdfAbs)   rptPdfAbs.href   = TurniApi.pdfUrl('absences',{month:ym});
}

// ── Global search ─────────────────────────────────────────────────
var _gSearchTimer = null;
