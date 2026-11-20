import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestPost} from '../functions/api/monitor.js';
import {cartao,deliverPriceAlerts,formatPriceNotice,linhaCupom,precoComVariacoes} from '../functions/_price_alerts.js';
import {quedasDeHoje,paginaQuedasDeHoje} from '../functions/_price_drops.js';

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
const AGORA=Math.floor(Date.UTC(2026,10,20,15)/1000);

test('site grava o maior preço e o cupom só quando a leitura traz, e apaga o vencido',async()=>{
  const db=fakeDb();
  const corpo={leituras:[
    {produto_id:1,preco:89.9,disponivel:true},                                    // ML: nada a mais
    {produto_id:2,preco:89.9,disponivel:true,preco_max:129.9},                     // Shopee com variações
    {produto_id:3,preco:89.9,disponivel:true,preco_max:null},                      // Shopee sem variações
    {produto_id:4,preco:50,disponivel:true,cupom:{codigo:'APP20',condicao:'R$ 20 acima de R$ 150',expira_em:9_999_999_999}},
    {produto_id:5,preco:50,disponivel:true,cupom:{codigo:'VELHO',expira_em:1000}},  // vencido
    {produto_id:6,preco:50,disponivel:true,cupom:{codigo:'<script>'}},            // código inválido
    {produto_id:7,preco:50,disponivel:true,cupom:null},
  ]};
  const r=await onRequestPost({request:new Request('https://x/api/monitor',{method:'POST',
    headers:{Authorization:'Bearer certo','Content-Type':'application/json'},body:JSON.stringify(corpo)}),env:{DB:db,PUBLISH_TOKEN:'certo'}});
  assert.equal(r.status,201);
  const maximos=db.executados.filter(([sql])=>sql.startsWith('UPDATE monitor_produtos SET preco_max'));
  assert.deepEqual(maximos.map(([,a])=>a),[[129.9,2],[null,3]]);
  const cupons=db.executados.filter(([sql])=>sql.startsWith('UPDATE monitor_produtos SET cupom_codigo'));
  assert.deepEqual(cupons.map(([,a])=>a),[
    ['APP20','R$ 20 acima de R$ 150',9_999_999_999,4],[null,null,null,5],[null,null,null,6],[null,null,null,7]]);
});

test('textos de variação e cupom',()=>{
  assert.match(precoComVariacoes(89.9,129.9),/^a partir de <b>R\$\s?89,90<\/b> \(as opções vão até R\$\s?129,90\)$/);
  assert.match(precoComVariacoes(89.9,89.9),/^<b>R\$\s?89,90<\/b>$/);
  assert.match(precoComVariacoes(89.9,null),/^<b>R\$\s?89,90<\/b>$/);
  assert.equal(linhaCupom({cupom_codigo:'APP20',cupom_condicao:'R$ 20 <off>',cupom_expira_em:AGORA+10*86400},AGORA),
    '🎟 Cupom <code>APP20</code>: R$ 20 &lt;off&gt; · até 30/11');
  assert.equal(linhaCupom({cupom_codigo:'APP20',cupom_expira_em:AGORA-1},AGORA),'');
  assert.equal(linhaCupom({cupom_codigo:'a b'},AGORA),'');
  assert.equal(linhaCupom({},AGORA),'');
});

const ALERTA={id:7,chat_id:'55',produto_id:3,loja:'shopee',id_produto:'1_2',nome:'Tênis',avisar_menor:1,ativo:1,expira_em:AGORA+9e6,
  link_afiliado:'https://s.shopee.com.br/x',preco_max:129.9};

test('cartão e aviso mostram "a partir de" e o cupom; sem cupom do produto, o voucher da loja',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':{...ALERTA,loja:'aliexpress',cupom_codigo:'APP20',cupom_condicao:'R$ 20 off',cupom_expira_em:AGORA+86400},
    'MIN(preco) AS minimo':{minimo:89.9,maximo:120,desde:AGORA-86400*20,atual:89.9,disponivel:1}});
  const c=await cartao({DB:db},'55',7,AGORA);
  assert.match(c.text,/💰 Agora: a partir de <b>R\$\s?89,90<\/b> \(as opções vão até R\$\s?129,90\)/);
  assert.match(c.text,/🎟 Cupom <code>APP20<\/code>: R\$ 20 off · até 21\/11/);

  const texto=formatPriceNotice({motivo:'menor_preco',preco:89.9,nome:'Tênis'},ALERTA,{now:AGORA,
    voucher:{titulo:'Cupom de R$ 20 no app',destino:'https://shopee.com.br/m/cupons'}});
  assert.match(texto,/💰 a partir de <b>R\$\s?89,90<\/b>/);
  assert.match(texto,/🎟 Voucher da Shopee ativo: <a href="https:\/\/shopee.com.br\/m\/cupons">Cupom de R\$ 20 no app<\/a>/);

  // Na entrega: busca o voucher da loja só quando o produto não tem cupom, e descarta destino fora da loja.
  const chamadas=[];
  const fetcher=async(url,init)=>{chamadas.push(JSON.parse(init.body));return new Response('{}');};
  const entrega=fakeDb({'SELECT a.*,p.nome,p.imagem':ALERTA,
    'FROM coupons':{title:'Voucher frete',destination:'https://golpe.example/x'}});
  await deliverPriceAlerts({DB:entrega,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:89.9,link:'https://s.shopee.com.br/x',motivo:'menor_preco'}],AGORA,fetcher);
  assert.deepEqual(entrega.executados.find(([sql])=>sql.includes('FROM coupons'))[1],['Shopee',AGORA,AGORA]);
  assert.doesNotMatch(chamadas[0].text,/Voucher|golpe/);
  assert.match(chamadas[0].text,/a partir de/);
});

test('página de quedas mostra "a partir de" e o cupom',async()=>{
  const db=fakeDb({'FROM monitor_leituras l WHERE l.lido_em>=?1':[{id:3,loja:'aliexpress',id_produto:'1005',nome:'Relógio',
    link_afiliado:'https://s.click.aliexpress.com/e/_x',agora:80,antes:100,preco_max:120,cupom_codigo:'APP20',cupom_condicao:'R$ 20 off',cupom_expira_em:AGORA+86400}]});
  const [item]=await quedasDeHoje({DB:db},AGORA);
  assert.equal(item.preco_max,120);
  assert.deepEqual(item.cupom,{codigo:'APP20',condicao:'R$ 20 off',expira_em:AGORA+86400});
  const pagina=await (await paginaQuedasDeHoje({DB:db},AGORA)).text();
  assert.match(pagina,/a partir de R\$\s?80,00/);
  assert.match(pagina,/As opções vão até R\$\s?120,00/);
  assert.match(pagina,/Cupom APP20 · R\$ 20 off/);
});
