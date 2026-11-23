import {html,money} from './_site.js';

// Ficha de preço da página da oferta: resumo junto do preço, régua
// menor · média · maior e gráfico com abas (30 dias, 90 dias, tudo).
// Tudo em SVG/HTML com atributos: o site não aceita estilo embutido (CSP).
const pct=v=>Math.abs(v).toLocaleString('pt-BR',{maximumFractionDigits:0});

export function resumoPreco(valores,atual,minimoDias) {
  const v=valores.map(Number).filter(x=>x>0);
  const preco=Number(atual);
  if(v.length<minimoDias||!(preco>0)) return {pronto:false,dias:v.length};
  const media=v.reduce((s,x)=>s+x,0)/v.length, minimo=Math.min(...v), maximo=Math.max(...v);
  return {pronto:true,dias:v.length,media,minimo,maximo,diferenca:(preco-media)/media*100};
}

// Linha logo abaixo do preço.
export function linhaResumo(r) {
  if(!r.pronto) return `<p class="price-sheet forming">📊 Histórico em formação: ${r.dias} ${r.dias===1?'dia':'dias'} registrados.</p>`;
  const abaixo=r.diferenca<=-1, acima=r.diferenca>=1;
  const destaque=abaixo?`<strong class="sheet-good">🔥 ${pct(r.diferenca)}% abaixo da média</strong>`:acima?`<strong class="sheet-high">${pct(r.diferenca)}% acima da média</strong>`:'<strong>Na média</strong>';
  return `<p class="price-sheet">Média de ${r.dias} dias: <b>${html(money(r.media))}</b> · ${destaque}</p>`;
}

// Régua: barra do menor ao maior preço, com a média e o preço de agora marcados.
export function regua(r,atual) {
  if(!r.pronto||r.maximo-r.minimo<0.005) return '';
  const L=16,R=584,W=R-L, x=v=>L+Math.max(0,Math.min(1,(v-r.minimo)/(r.maximo-r.minimo)))*W;
  const xa=x(Number(atual)).toFixed(1), xm=x(r.media).toFixed(1);
  return `<figure class="price-ruler"><svg viewBox="0 0 600 64" role="img" aria-label="Preço de agora ${html(money(atual))} entre o menor ${html(money(r.minimo))} e o maior ${html(money(r.maximo))}">
<defs><linearGradient id="regua-cor" x1="0" x2="1"><stop offset="0" stop-color="#16865c"/><stop offset=".5" stop-color="#ffd84a"/><stop offset="1" stop-color="#e5484d"/></linearGradient></defs>
<rect x="${L}" y="26" width="${W}" height="10" rx="5" fill="url(#regua-cor)"/>
<line x1="${xm}" x2="${xm}" y1="20" y2="42" class="ruler-avg"/>
<circle cx="${xa}" cy="31" r="10" class="ruler-now"/>
</svg><figcaption><span>Menor<b>${html(money(r.minimo))}</b></span><span>Média<b>${html(money(r.media))}</b></span><span>Maior<b>${html(money(r.maximo))}</b></span></figcaption></figure>`;
}

// Gráfico de linha (um ponto por dia). Compacto quando há muitos dias: só o
// menor e o último preço ganham rótulo, e o passo entre os dias diminui.
export function graficoLinha(rows,periodo) {
  const valores=rows.map(r=>Number(r.price));
  if(valores.length<2) return '';
  const compacto=valores.length>31, passo=compacto?Math.max(14,Math.min(88,1100/valores.length)):88;
  const largura=Math.max(360,72+(valores.length-1)*passo), L=36, R=largura-36, step=(R-L)/(valores.length-1);
  const min=Math.min(...valores), max=Math.max(...valores), faixa=Math.max(.01,max-min), varia=max-min>=.005;
  const pontos=rows.map((row,i)=>{const v=Number(row.price),d=new Date(Number(row.observed_at)*1000);
    const ehMin=Math.abs(v-min)<.005, ultimo=i===rows.length-1;
    return {x:L+step*i,y:varia?142-((v-min)/faixa)*92:96,v,ehMin,ultimo,rotulo:!compacto||ultimo||(ehMin&&valores.indexOf(v)===i),
      dia:d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}),data:d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})};});
  const linha=pontos.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const datas=compacto?pontos.filter((p,i)=>i===0||p.ultimo||i%Math.ceil(pontos.length/8)===0):pontos;
  return `<svg class="price-line-chart" width="${largura}" height="210" viewBox="0 0 ${largura} 210" role="img" aria-label="Evolução do preço em ${valores.length} dias (${html(periodo)})"><line class="line-axis" x1="${L}" y1="160" x2="${R}" y2="160"></line><polygon class="line-area" points="${L},160 ${linha} ${R},160"></polygon><polyline class="line-path" points="${linha}"></polyline>${pontos.map(p=>`<g class="line-point${p.ehMin?' is-min':''}${p.ultimo?' is-latest':''}${compacto?' is-compact':''}" aria-label="${html(money(p.v))} em ${html(p.data)}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${compacto?3.5:6}"></circle>${p.rotulo?`<text class="line-value" x="${p.x.toFixed(1)}" y="${(p.y-14).toFixed(1)}" text-anchor="middle">${html(money(p.v))}</text>`:''}</g>`).join('')}${datas.map(p=>`<text class="line-date" x="${p.x.toFixed(1)}" y="187" text-anchor="middle">${html(p.dia)}</text>`).join('')}</svg>`;
}

// Abas de período: só aparecem quando há histórico além de 30 dias.
export function graficoComAbas(todas,agora) {
  const dentro=dias=>todas.filter(r=>Number(r.observed_at)>=agora-dias*86400);
  const periodos=[['30','30 dias',dentro(30)],['90','90 dias',dentro(90)],['tudo','Tudo',todas]];
  const usados=periodos.filter(([, ,rows],i)=>i===0||rows.length>periodos[i-1][2].length);
  const graficos=usados.map(([chave,nome,rows],i)=>`<div class="price-chart-scroll" data-periodo="${chave}" tabindex="0"${i?' hidden':''} aria-label="Gráfico de ${html(nome)}; deslize para ver outros dias">${graficoLinha(rows,nome)}</div>`).join('');
  if(usados.length<2) return graficos;
  return `<div class="chart-tabs" role="tablist" aria-label="Período do gráfico">${usados.map(([chave,nome],i)=>`<button type="button" role="tab" data-periodo="${chave}" aria-selected="${i===0}">${html(nome)}</button>`).join('')}</div>${graficos}`;
}
