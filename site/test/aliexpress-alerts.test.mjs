import assert from 'node:assert/strict';
import test from 'node:test';
import {parseProductLink,resolveProductLink} from '../functions/_product_link.js';
import {cartao,handlePriceAlert,handleStartProduct} from '../functions/_price_alerts.js';
import {buscarProdutos,formatarResultados} from '../functions/_product_search.js';

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
    async batch(stmts){for(const s of stmts) executados.push([s.sql,s.args]);return [];},
  };
}
const AE={loja:'aliexpress',id_produto:'1005003214550744',tipo:null};

test('reconhece os links de produto do AliExpress',()=>{
  for(const link of [
    'https://pt.aliexpress.com/item/1005003214550744.html?spm=a2g0o&gatewayAdapt=glo2bra',
    'https://www.aliexpress.com/item/1005003214550744.html',
    'https://m.aliexpress.com/item/1005003214550744.html',
    'https://pt.aliexpress.com/i/1005003214550744.html',
    'https://star.aliexpress.com/share/share.htm?redirectUrl=https%3A%2F%2Fpt.aliexpress.com%2Fitem%2F1005003214550744.html%3Fsrc%3Dx',
  ]) assert.deepEqual(parseProductLink(link),AE,link);
  assert.equal(parseProductLink('https://pt.aliexpress.com/store/123'),null);
  assert.equal(parseProductLink('https://aliexpress.com.golpe.example/item/1005003214550744.html'),null);
  // Destino fora do AliExpress no parâmetro não vale.
  assert.equal(parseProductLink('https://star.aliexpress.com/share/share.htm?redirectUrl=https%3A%2F%2Fgolpe.example%2Fitem%2F1005003214550744.html'),null);
});

test('segue os links curtos do AliExpress só entre endereços do AliExpress',async()=>{
  const pedidos=[];
  const fetcher=async url=>{
    pedidos.push(url);
    if(url.startsWith('https://s.click.aliexpress.com')) return new Response(null,{status:302,headers:{Location:'https://star.aliexpress.com/share/share.htm?redirectUrl=https%3A%2F%2Fpt.aliexpress.com%2Fitem%2F1005003214550744.html'}});
    if(url.startsWith('https://a.aliexpress.com/_js')) return new Response('<script>location.href="https://m.aliexpress.com/item/1005003214550744.html"</script>',{status:200});
    if(url.startsWith('https://a.aliexpress.com/_fora')) return new Response(null,{status:302,headers:{Location:'https://golpe.example/item/1005003214550744.html'}});
    return new Response('',{status:404});
  };
  assert.deepEqual(await resolveProductLink('https://s.click.aliexpress.com/e/_DmkLs0P',fetcher),AE);
  assert.deepEqual(await resolveProductLink('https://a.aliexpress.com/_js123',fetcher),AE);
  assert.equal(await resolveProductLink('https://a.aliexpress.com/_fora1',fetcher),null);
  assert.ok(!pedidos.some(u=>u.includes('golpe.example')));
});

const REGRAS={
  'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
  'COUNT(DISTINCT produto_id)':{total:0},
  'INSERT INTO monitor_produtos':{id:12,nome:null},
  'INSERT INTO alerta_precos':{id:90},
  'SELECT a.*,p.loja':{id:90,produto_id:12,loja:'aliexpress',id_produto:'1005003214550744',nome:null,avisar_menor:1,ativo:1,expira_em:9e9,
    link_afiliado:'https://s.click.aliexpress.com/e/_abc'},
};

test('link do AliExpress cria o alerta, sem o aviso de estoque, e o cartão mostra a loja',async()=>{
  const db=fakeDb(REGRAS);
  const r=await handlePriceAlert({DB:db},'55','https://pt.aliexpress.com/item/1005003214550744.html 99,90',1000,async()=>{throw new Error('sem rede');});
  const produto=db.executados.find(([sql])=>sql.includes('INSERT INTO monitor_produtos'));
  assert.deepEqual(produto[1].slice(0,2),['aliexpress','1005003214550744']);
  // Histórico do canal: a oferta do catálogo é aliexpress_<id>.
  assert.ok(db.executados.some(([sql,args])=>sql.includes('FROM offer_prices')&&args[1]==='aliexpress_1005003214550744'));
  assert.match(r.text,/Produto do AliExpress \(nome na 1ª leitura\)/);
  assert.match(r.text,/🛒 AliExpress/);
  const botoes=r.markup.inline_keyboard.flat();
  assert.ok(!botoes.some(b=>/estoque/i.test(b.text)));
  assert.ok(botoes.some(b=>b.url==='https://s.click.aliexpress.com/e/_abc'));
  const c=await cartao({DB:db},'55',90,1000);
  assert.match(c.text,/AliExpress/);
});

test('botão do canal ae_ e busca pelo catálogo incluem o AliExpress',async()=>{
  const db=fakeDb(REGRAS);
  assert.match((await handleStartProduct({DB:db},'55','ae_1005003214550744',1000)).text,/Alerta criado/);
  assert.equal(await handleStartProduct({DB:db},'55','ae_12',1000),null);
  const busca=fakeDb({'FROM offers':[{id:'aliexpress_1005003214550744',title:'Smartwatch',price:120,sales:900},{id:'aliexpress_abc',title:'Inválido',price:1}]});
  const itens=await buscarProdutos({DB:busca},'smartwatch',fetch,1000);
  assert.deepEqual(itens.map(i=>[i.loja,i.id_produto]),[['aliexpress','1005003214550744']]);
  assert.match(busca.executados[0][0],/id LIKE 'aliexpress\\_%'/);
  const r=formatarResultados('smartwatch',itens);
  assert.match(r.text,/AliExpress/);
  assert.equal(r.markup.inline_keyboard[0][0].callback_data,'b:ae:1005003214550744');
});
