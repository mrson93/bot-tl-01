import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestPost} from '../functions/api/monitor.js';
import {botaoEncaminhar,cartao,deliverPriceAlerts,formatPriceNotice,linkDaLoja,promocaoMaquiada} from '../functions/_price_alerts.js';
import {ajustar,semHtml} from '../functions/_webapp_api.js';

function fakeDb(regras={}) {
  const executados=[];
  const responder=(sql,args,tipo)=>{
    for(const [trecho,resposta] of Object.entries(regras)){
      if(sql.includes(trecho)) return typeof resposta==='function'?resposta(args,tipo):resposta;
    }
    return tipo==='all'?[]:null;
  };
  return {
    executados,
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){executados.push([sql,this.args]);return responder(sql,this.args,'first');},
        async all(){executados.push([sql,this.args]);return {results:responder(sql,this.args,'all')||[]};},
        async run(){executados.push([sql,this.args]);return {meta:{changes:1}};},
      };
    },
    async batch(stmts){for(const s of stmts) executados.push([s.sql,s.args]);return stmts.map(()=>({results:[]}));},
  };
}
const AGORA=Math.floor(Date.UTC(2026,10,27,15)/1000);  // Black Friday
const dia=n=>new Date((AGORA-10800-n*86400)*1000).toISOString().slice(0,10);
// n dias atrás -> preço
const serie=f=>Array.from({length:90},(_,i)=>({dia:dia(90-i),preco:f(90-i)}));

test('desconto maquiado: subiu nas últimas semanas e "caiu" para o preço de antes',()=>{
  const maquiado=serie(n=>n<=14?260:200);
  assert.deepEqual(promocaoMaquiada(199,maquiado,AGORA),{antes:200,pico:260});
  // Queda de verdade: bem abaixo do preço típico.
  assert.equal(promocaoMaquiada(160,maquiado,AGORA),null);
  // Sem alta recente: nada.
  assert.equal(promocaoMaquiada(199,serie(()=>200),AGORA),null);
  // Pouco histórico: não arrisca.
  assert.equal(promocaoMaquiada(199,maquiado.slice(-20),AGORA),null);
  // A leitura de hoje não conta como "alta recente".
  assert.equal(promocaoMaquiada(199,[...serie(()=>200),{dia:dia(0),preco:300}],AGORA),null);
  const texto=formatPriceNotice({motivo:'queda',preco:199,nome:'TV'},{queda_percent:20,preco_base:260},{maquiada:{antes:200,pico:260}});
  assert.match(texto,/Desconto maquiado\?<\/b> Subiu para R\$\s?260,00/);
});

const ALERTA=id=>({id,chat_id:'55',produto_id:id,loja:'mercadolivre',nome:`Produto ${id}`,avisar_menor:1,ativo:1,expira_em:AGORA+9e6,comparado_em:AGORA});
const aviso=id=>({alerta_id:id,produto_id:id,preco:100+id,link:'https://go.canaltabarato.com.br/abcd1234',motivo:'menor_preco'});

test('três avisos para a mesma pessoa viram uma mensagem; dois saem separados com botão de encaminhar',async()=>{
  const chamadas=[];
  const fetcher=async(url,init)=>{chamadas.push({metodo:String(url).split('/').pop(),corpo:JSON.parse(init.body)});return new Response('{}');};
  const db=fakeDb({'SELECT a.*,p.nome,p.imagem':args=>ALERTA(args[0])});
  const env={DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'};
  assert.equal(await deliverPriceAlerts(env,[aviso(1),aviso(2),aviso(3)],AGORA,fetcher),3);
  assert.equal(chamadas.length,1);
  assert.match(chamadas[0].corpo.text,/3 produtos da sua lista/);
  assert.match(chamadas[0].corpo.text,/1\. <b>Produto 1<\/b>[\s\S]*3\. <b>Produto 3<\/b>/);
  assert.deepEqual(chamadas[0].corpo.reply_markup.inline_keyboard[2].map(b=>b.text),['🛒 3. Comprar','⚙️ 3. Ajustar']);
  assert.equal(db.executados.filter(([sql])=>sql.startsWith('INSERT INTO alerta_avisos')).length,3);

  chamadas.length=0;
  assert.equal(await deliverPriceAlerts(env,[aviso(1),aviso(2)],AGORA,fetcher),2);
  assert.equal(chamadas.length,2);
  const encaminhar=chamadas[0].corpo.reply_markup.inline_keyboard.flat().find(b=>b.text==='📤 Mandar para alguém');
  const url=new URL(encaminhar.url);
  assert.equal(url.origin+url.pathname,'https://t.me/share/url');
  assert.equal(url.searchParams.get('url'),'https://go.canaltabarato.com.br/abcd1234');
  assert.match(url.searchParams.get('text'),/Produto 1 por R\$\s?101,00 \(achei pelo @TaBaratoAlertaDePrecoBot\)/);
});

test('quem bloqueou o bot no meio do pacote tem os dados apagados uma vez só',async()=>{
  const fetcher=async()=>new Response('{}',{status:403});
  const db=fakeDb({'SELECT a.*,p.nome,p.imagem':args=>ALERTA(args[0])});
  assert.equal(await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[1,2,3,4,5,6,7,8,9].map(aviso),AGORA,fetcher),0);
  assert.equal(db.executados.filter(([sql])=>sql.startsWith('DELETE FROM alerta_precos WHERE chat_id')).length,1);
});

test('"Ver na loja" usa o link rastreado do cartão quando existe',async()=>{
  assert.equal(linkDaLoja({link_cartao:'https://go.canaltabarato.com.br/abcd1234',link_afiliado:'https://meli.la/x'}),'https://go.canaltabarato.com.br/abcd1234');
  assert.equal(linkDaLoja({link_cartao:'https://golpe.example/x',link_afiliado:'https://meli.la/x'}),'https://meli.la/x');
  const db=fakeDb({'SELECT a.*,p.loja':{...ALERTA(7),link_cartao:'https://go.canaltabarato.com.br/abcd1234',link_afiliado:'https://meli.la/x'}});
  const c=await cartao({DB:db},'55',7,AGORA);
  assert.equal(c.markup.inline_keyboard[0][0].url,'https://go.canaltabarato.com.br/abcd1234');
  assert.ok(botaoEncaminhar({},'x',1,'https://meli.la/x').url.startsWith('https://t.me/share/url?'));
});

test('coleta grava o link do cartão (só do redirecionador) e os cliques do dia',async()=>{
  const db=fakeDb();
  const corpo={produtos:[{id:3,link_cartao:'https://go.canaltabarato.com.br/abcd1234'},{id:4,link_cartao:'https://golpe.example/x'}],
    cliques:{dia:'2026-11-27',alerta:12,alerta_cartao:4,outro:99}};
  const r=await onRequestPost({request:new Request('https://x/api/monitor',{method:'POST',
    headers:{Authorization:'Bearer certo','Content-Type':'application/json'},body:JSON.stringify(corpo)}),env:{DB:db,PUBLISH_TOKEN:'certo'}});
  assert.equal(r.status,201);
  assert.deepEqual(db.executados.filter(([sql])=>sql.startsWith('UPDATE monitor_produtos SET link_cartao')).map(([,a])=>a),
    [['https://go.canaltabarato.com.br/abcd1234',3]]);
  assert.deepEqual(db.executados.filter(([sql])=>sql.startsWith('INSERT INTO alerta_cliques_diarios')).map(([,a])=>a),
    [['2026-11-27','alerta',12],['2026-11-27','alerta_cartao',4]]);
  // Dia em formato estranho: ignora.
  const db2=fakeDb();
  await onRequestPost({request:new Request('https://x/api/monitor',{method:'POST',
    headers:{Authorization:'Bearer certo','Content-Type':'application/json'},body:JSON.stringify({cliques:{dia:"x'; DROP",alerta:1}})}),env:{DB:db2,PUBLISH_TOKEN:'certo'}});
  assert.ok(!db2.executados.some(([sql])=>sql.includes('alerta_cliques_diarios')));
});

test('mini app cria alerta colando o link, pelo mesmo caminho do chat',async()=>{
  assert.equal((await ajustar({DB:fakeDb()},'55',{acao:'adicionar',link:'oi'},AGORA)).erro,'link_invalido');
  const db=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},'COUNT(DISTINCT produto_id)':{total:0},
    'INSERT INTO monitor_produtos':{id:3,nome:'Fone'},'INSERT INTO alerta_precos':{id:70},
    'SELECT a.*,p.loja':{...ALERTA(70),produto_id:3}});
  const r=await ajustar({DB:db},'55',{acao:'adicionar',link:'https://www.mercadolivre.com.br/fone/p/MLB123'},AGORA,async()=>{throw new Error('sem rede');});
  assert.equal(r.ok,true);
  assert.equal(db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'))[1][0],'55');
  const cheio=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:10}});
  const recusado=await ajustar({DB:cheio},'55',{acao:'adicionar',link:'https://www.mercadolivre.com.br/fone/p/MLB123'},AGORA,async()=>{throw new Error('sem rede');});
  assert.equal(recusado.erro,'nao_criado');
  assert.match(recusado.mensagem,/Você já tem 10 produtos/);
  assert.equal(semHtml('<b>a</b> &amp; &lt;b&gt;'),'a & <b>');
});

test('página /comecar: quatro caminhos, redes e aviso de comissão',async()=>{
  const {onRequestGet}=await import('../functions/comecar.js');
  const r=onRequestGet({env:{}});
  assert.equal(r.status,200);
  const pagina=await r.text();
  for(const t of ['Receber ofertas','Avisar quando baixar','Ver se o preço é bom','Cupons de hoje']) assert.match(pagina,new RegExp(t));
  assert.match(pagina,/https:\/\/t\.me\/TaBaratoAlertaDePrecoBot\?start=comecar/);
  assert.match(pagina,/Podemos ganhar comissão, sem custo para você/);
  assert.doesNotMatch(pagina,/style=/);   // CSP: style-src 'self'
});

test('página /alertas: três passos, botão para o bot e menu com Alertas ativo',async()=>{
  const {onRequestGet}=await import('../functions/alertas.js');
  const pagina=await onRequestGet({env:{}}).text();
  assert.match(pagina,/Escolha o produto\.<br>A gente avisa quando baixar\./);
  assert.equal((pagina.match(/class="alerts-num"/g)||[]).length,3);
  assert.match(pagina,/https:\/\/t\.me\/TaBaratoAlertaDePrecoBot\?start=site_alertas/);
  assert.match(pagina,/href="\/alertas" class="nav-cta" aria-current="page">🔔 Alertas/);
  assert.doesNotMatch(pagina,/style=/);
  const {header}=await import('../functions/_site.js');
  assert.deepEqual([...header('offers').matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>m[2]),['Ofertas','Preços','Cupons','🔔 Alertas']);
});

test('selo de preço da vitrine e dados do topo da página inicial',async()=>{
  const {priceLevel,withPriceLevel}=await import('../functions/api/offers.js');
  assert.equal(priceLevel(90,10,90,100),'baixo');
  assert.equal(priceLevel(100,10,90,100),'medio');
  assert.equal(priceLevel(110,10,90,100),'alto');
  assert.equal(priceLevel(90,3,90,100),null);   // menos de 4 dias: sem selo
  assert.equal(priceLevel(90,4,90,100),'baixo');
  assert.deepEqual(withPriceLevel({id:'x',price:90,history_days:10,history_min:90,history_avg:100}),{id:'x',price:90,price_level:'baixo'});
  const {dadosInicio}=await import('../functions/api/inicio.js');
  const agora=Math.floor(Date.UTC(2026,10,22,15)/1000);
  const linha=(id,preco,antes,quando,extra={})=>({id,title:`Produto ${id}`,price:preco,previous_price:antes,price_changed_at:quando,source:'Shopee',observations:9,min_price:preco,discount:10,...extra});
  const DB={prepare(sql){return {bind(){return this;},
    async all(){return {results:sql.includes('previous_price>price')?[linha('a',80,100,agora-3600),linha('b',90,100,agora-86400),linha('c',95,100,agora-3600),linha('d',99,100,agora-3600)]
      :[linha('e',50,null,0,{discount:40,original_price:90}),linha('f',60,null,0,{discount:20})]};},
    async first(){return {total:4};}};}};
  const d=await dadosInicio({DB},agora);
  assert.deepEqual(d.caiuAgora.map(o=>[o.titulo,o.queda]),[['Produto a',20],['Produto b',10],['Produto c',5]]);
  assert.match(d.caiuAgora[0].caminho,/^\/oferta\//);
  assert.equal(d.ofertaDoDia.titulo,'Produto e');
  assert.equal(d.quedas.hoje,3);
  assert.equal(d.quedas.semana.length,7);
  assert.equal(d.quedas.semana[5],1);
  assert.equal(d.cupons,4);
});

test('oferta ganha "Avise-me quando baixar" com o produto certo; Amazon não',async()=>{
  const {payloadAlerta}=await import('../functions/oferta/[id].js');
  assert.equal(payloadAlerta('mercadolivre_MLB53768796'),'ml_MLB53768796');
  assert.equal(payloadAlerta('shopee_333156228_58215216165'),'sp_333156228_58215216165');
  assert.equal(payloadAlerta('aliexpress_1005006123456789'),'ae_1005006123456789');
  assert.equal(payloadAlerta('amazon_B0C1234567'),null);
  assert.equal(payloadAlerta('shopee_x'),null);
});

test('cupom com link comum da Shopee vira link de afiliado no clique e fica guardado',async()=>{
  const {onRequestGet}=await import('../functions/cupom/[id].js');
  const updates=[];
  const DB={prepare(sql){return {bind(...a){this.a=a;return this;},async first(){return {destination:'https://shopee.com.br/m/black-friday'};},async run(){updates.push([sql,this.a]);}};}};
  const pendentes=[];
  const fetcher=async()=>Response.json({data:{generateShortLink:{shortLink:'https://s.shopee.com.br/AbC123'}}});
  const env={DB,SHOPEE_APP_ID:'1',SHOPEE_SECRET:'s',ALLOWED_DESTINATION_HOSTS:'shopee.com.br,s.shopee.com.br'};
  const r=await onRequestGet({params:{id:'painel_abc123'},env,fetcher,waitUntil:p=>pendentes.push(p),request:new Request('https://canaltabarato.com.br/cupom/painel_abc123')});
  await Promise.allSettled(pendentes);
  assert.equal(r.status,302);
  assert.equal(r.headers.get('Location'),'https://s.shopee.com.br/AbC123');
  assert.ok(updates.some(([sql,a])=>sql.startsWith('UPDATE coupons SET destination')&&a[0]==='https://s.shopee.com.br/AbC123'));
});

test('menu marca o atalho de Cupons para esconder quando não houver cupom',async()=>{
  const {header,head}=await import('../functions/_site.js');
  assert.match(header('offers'),/href="\/cupons" data-coupons>Cupons/);
  assert.match(head({title:'x',description:'y',canonical:'https://x'}),/\/nav\.js/);
});
