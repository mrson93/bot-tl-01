import assert from 'node:assert/strict';
import test from 'node:test';
import {comparacao,palavrasChave,procurarEmOutrasLojas,semelhanca,sugestaoMaisBarata} from '../functions/_compare_stores.js';
import {cartao,deliverPriceAlerts} from '../functions/_price_alerts.js';

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
const AGORA=Math.floor(Date.UTC(2026,10,20,15)/1000);
const S25='Celular Samsung Galaxy S25 5G, 256GB, 12GB RAM, Câmera Tripla';

test('nomes parecidos: modelo, números e versão têm que bater',()=>{
  assert.deepEqual(palavrasChave('Kit 2 Fones De Ouvido Preto, Original!'),['2','fones','ouvido']);
  assert.ok(semelhanca(S25,'Samsung Galaxy S25 5g, 256gb, 12gb, Câmera Tripla - Prata')>=0.75);
  assert.equal(semelhanca(S25,'Samsung Galaxy S25 Ultra 5g 256gb 12gb Câmera Tripla'),0);   // versão diferente
  assert.equal(semelhanca(S25,'Samsung Galaxy S25 5g 128gb 12gb Câmera Tripla'),0);         // capacidade diferente
  assert.equal(semelhanca('Faqueiro Tramontina Búzios Inox 36 Peças','Faqueiro Tramontina Búzios Inox 24 Peças'),0);
  assert.equal(semelhanca('Ventilador portátil','Ventilador portátil turbo'),0);              // genérico demais
});

const PRODUTO={produto_id:3,loja:'mercadolivre',id_produto:'MLB111',nome:S25};
const CATALOGO=[
  {id:'amazon_B0S25',title:'Samsung Galaxy S25 5G 256GB 12GB RAM Câmera Tripla',price:3500,source:'Amazon'},
  {id:'shopee_9_9',title:'Capinha Samsung Galaxy S25 5G 256GB 12GB Câmera Tripla',price:30,source:'Shopee'}, // barata demais: acessório
  {id:'mercadolivre_MLB222',title:'Samsung Galaxy S25 5G 256GB 12GB Câmera Tripla',price:3000,source:'Mercado Livre'}, // mesma loja
];

test('procura nas outras lojas, ignora a mesma loja e preço absurdo, e usa a Shopee ao vivo',async()=>{
  const db=fakeDb({'FROM offers':CATALOGO});
  const pedidos=[];
  const fetcher=async(url,init)=>{pedidos.push(JSON.parse(init.body).query);return Response.json({data:{productOfferV2:{nodes:[
    {itemId:5,shopId:4,productName:'Galaxy S25 Samsung 5G 256GB 12GB Câmera Tripla Lacrado',priceMin:'3399',offerLink:'https://s.shopee.com.br/abc'},
    {itemId:6,shopId:4,productName:'Galaxy S25 Samsung 5G 256GB 12GB Câmera Tripla',priceMin:'3100',offerLink:'https://golpe.example/x'},
  ]}}});};
  const achado=await procurarEmOutrasLojas({DB:db,SHOPEE_APP_ID:'1',SHOPEE_SECRET:'s'},PRODUTO,3999,fetcher);
  assert.deepEqual(achado,{loja:'shopee',nome:'Galaxy S25 Samsung 5G 256GB 12GB Câmera Tripla Lacrado',preco:3399,link:'https://s.shopee.com.br/abc'});
  assert.match(pedidos[0],/keyword:"celular samsung galaxy s25 5g"/);
  const consulta=db.executados.find(([sql])=>sql.includes('FROM offers'));
  assert.equal(consulta[1][0],'mercadolivre_MLB111');
  // Sem a Shopee: o catálogo (Amazon) é a sugestão, pelo /go do site.
  const soCatalogo=await procurarEmOutrasLojas({DB:db},PRODUTO,3999);
  assert.deepEqual(soCatalogo,{loja:'amazon',nome:CATALOGO[0].title,preco:3500,link:'https://canaltabarato.com.br/go/amazon_B0S25'});
});

test('guarda por 12 h, inclusive "nada encontrado", e respeita buscar=false',async()=>{
  const db=fakeDb({'FROM offers':CATALOGO});
  const achado=await comparacao({DB:db},PRODUTO,3999,AGORA);
  assert.equal(achado.loja,'amazon');
  const gravado=db.executados.find(([sql])=>sql.startsWith('UPDATE monitor_produtos SET comparacao'));
  assert.deepEqual(gravado[1],[JSON.stringify(achado),AGORA,3]);
  // Guardado e válido: não procura de novo.
  const antes=db.executados.length;
  assert.deepEqual(await comparacao({DB:db},{...PRODUTO,comparacao:gravado[1][0],comparado_em:AGORA-3600},3999,AGORA),achado);
  assert.equal(await comparacao({DB:db},{...PRODUTO,comparacao:null,comparado_em:AGORA-3600},3999,AGORA),null);
  assert.equal(db.executados.length,antes);
  // Vencido e buscar=false: não procura.
  assert.equal(await comparacao({DB:db},{...PRODUTO,comparado_em:AGORA-13*3600},3999,AGORA,fetch,false),null);
  assert.equal(db.executados.length,antes);
});

test('sugestão só quando a outra loja está pelo menos 2% mais barata',()=>{
  const achado={loja:'shopee',preco:3399,link:'https://s.shopee.com.br/abc'};
  const s=sugestaoMaisBarata(achado,3999);
  assert.match(s.linha,/💡 Parecido na Shopee por <b>R\$\s?3\.399,00<\/b> \(15% menos\)\. Confira se é o mesmo modelo\./);
  assert.deepEqual(s.botao,{text:'💡 Ver na Shopee ↗',url:'https://s.shopee.com.br/abc'});
  assert.equal(sugestaoMaisBarata(achado,3450),null);
  assert.equal(sugestaoMaisBarata(null,3999),null);
});

test('cartão e aviso mostram a sugestão com botão',async()=>{
  const guardado=JSON.stringify({loja:'amazon',nome:'S25',preco:3500,link:'https://canaltabarato.com.br/go/amazon_B0S25'});
  const alerta={id:7,chat_id:'55',...PRODUTO,avisar_menor:1,ativo:1,expira_em:AGORA+9e6,link_afiliado:'https://www.mercadolivre.com.br/p/MLB111',
    comparacao:guardado,comparado_em:AGORA-60};
  const db=fakeDb({'SELECT a.*,p.loja':alerta,'MIN(preco) AS minimo':{minimo:3900,maximo:4200,desde:AGORA-86400*30,atual:3999,disponivel:1}});
  const c=await cartao({DB:db},'55',7,AGORA);
  assert.match(c.text,/💡 Parecido na Amazon por <b>R\$\s?3\.500,00<\/b> \(12% menos\)/);
  assert.ok(c.markup.inline_keyboard.some(l=>l[0].url==='https://canaltabarato.com.br/go/amazon_B0S25'));

  const chamadas=[];
  const fetcher=async(url,init)=>{chamadas.push(JSON.parse(init.body));return new Response('{}');};
  const entrega=fakeDb({'SELECT a.*,p.nome,p.imagem':alerta});
  await deliverPriceAlerts({DB:entrega,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:3999,link:'https://meli.la/x',motivo:'menor_preco'}],AGORA,fetcher);
  assert.match(chamadas[0].text,/Parecido na Amazon/);
  assert.equal(chamadas[0].reply_markup.inline_keyboard[1][0].text,'💡 Ver na Amazon ↗');
});
