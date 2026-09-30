const metricRoot=document.getElementById('admin-metrics');
const metricNumber=value=>Number(value||0).toLocaleString('pt-BR');
const metricEscape=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function showMetrics(){
  const response=await fetch('/api/admin/metrics');
  if(!response.ok)throw new Error('Não foi possível carregar as métricas.');
  const data=await response.json(),posts=Object.entries(data.by_post||{}).sort((a,b)=>b[1].visits-a[1].visits).slice(0,10);
  const priorities=Object.entries(data.by_post||{}).filter(([,item])=>item.missing_links>0).sort((a,b)=>b[1].visits-a[1].visits).slice(0,5);
  const sum=key=>Object.values(data.by_post||{}).reduce((total,item)=>total+Number(item[key]||0),0);
  const searches=data.catalog_search||{};
  metricRoot.innerHTML=`<div class="admin-metric-grid">
    <div><strong>${metricNumber(sum('visits'))}</strong><span>leituras de matérias</span></div>
    <div><strong>${metricNumber(sum('card_views'))}</strong><span>cards exibidos</span></div>
    <div><strong>${metricNumber(sum('clicks'))}</strong><span>cliques nos links</span></div>
    <div><strong>${metricNumber(searches.empty)}</strong><span>buscas sem resultado</span></div>
  </div><p class="admin-metric-note">Buscas com resultado: ${metricNumber(searches.results)} · sem resultado no celular: ${metricNumber(searches.by_device?.mobile?.empty)} · no computador: ${metricNumber(searches.by_device?.desktop?.empty)}. Cada pessoa é contada no máximo uma vez por tipo de resultado a cada 30 minutos; exibições de card podem superar leituras de página.</p>
  ${priorities.length?`<h3>Prioridade: completar links afiliados</h3><p class="admin-metric-note">Matérias com modelos sem link, ordenadas pelo número de leituras. Cadastre apenas seus URLs de afiliado válidos.</p><ul class="admin-metric-priorities">${priorities.map(([slug,item])=>`<li><a href="/admin?post=${encodeURIComponent(slug)}">${metricEscape(item.title||slug)}</a><span>${metricNumber(item.visits)} leituras · ${metricNumber(item.missing_links)} modelo(s) sem link</span></li>`).join('')}</ul>`:''}
  <div class="admin-metric-table-wrap"><table class="admin-metric-table"><thead><tr><th>Matéria</th><th>Leituras</th><th>Cards exibidos</th><th>Cliques</th></tr></thead><tbody>${posts.map(([slug,metrics])=>`<tr><th><a href="/blog/${encodeURIComponent(slug)}" target="_blank" rel="noopener">${metricEscape(metrics.title||slug.replaceAll('-',' '))}</a></th><td>${metricNumber(metrics.visits)}</td><td>${metricNumber(metrics.card_views)}</td><td>${metricNumber(metrics.clicks)}</td></tr>`).join('')||'<tr><td colspan="4">Ainda não há dados de matérias.</td></tr>'}</tbody></table></div>`;
}
showMetrics().catch(error=>{metricRoot.textContent=error.message;});
