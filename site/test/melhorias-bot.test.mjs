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
  assert.match(pagina,/href="\/alertas" aria-current="page">Alertas/);
  assert.doesNotMatch(pagina,/style=/);
  const {header}=await import('../functions/_site.js');
  assert.deepEqual([...header('offers').matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>m[2]),['Ofertas','Alertas','Preços','Cupons']);
});
