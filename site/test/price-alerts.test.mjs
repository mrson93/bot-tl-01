import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cartao, deliverPriceAlerts, expirePriceAlerts, formatPriceNotice, handleCallback, handlePriceAlert,
  handlePriceChoice, handleStartProduct, parsePrice, parsePriceRequest, sparkline,
} from '../functions/_price_alerts.js';
import {parseProductLink,resolveProductLink} from '../functions/_product_link.js';
import {handleUpdate} from '../functions/_telegram_alerts.js';
import {responderBotao} from '../functions/api/telegram-alerts.js';

// D1 de mentira: responde pela primeira regra cujo trecho aparece no SQL.
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
const semRede=async()=>{throw new Error('sem rede');};
const LINK='https://www.mercadolivre.com.br/fone/p/MLB123';
const ALERTA={id:7,chat_id:'55',produto_id:3,loja:'mercadolivre',id_produto:'MLB123',nome:'Power Bank Anker',
  avisar_menor:1,preco_alvo:null,queda_percent:null,avisar_estoque:0,preco_base:699,ativo:1,expira_em:40_000_000,
  link_afiliado:'https://www.mercadolivre.com.br/p/MLB123?matt_tool=1'};
const HISTORICO={'MIN(preco) AS minimo':{minimo:649,maximo:799,desde:1000,atual:699,disponivel:1},
  'GROUP BY dia':[{preco:799},{preco:720},{preco:699}]};
const enviar=()=>{const chamadas=[];const fetcher=async(url,init)=>{chamadas.push({metodo:url.split('/').pop(),corpo:JSON.parse(init.body)});return new Response('{}',{status:200});};return {chamadas,fetcher};};

test('entende o preço do jeito que as pessoas escrevem',()=>{
  assert.equal(parsePrice('199,90'),199.9);
  assert.equal(parsePrice('R$ 1.299,90'),1299.9);
  assert.equal(parsePrice('199.90'),199.9);
  assert.equal(parsePrice('abc'),null);
  assert.deepEqual(parsePriceRequest(`${LINK} 199,90`),{link:LINK,alvo:199.9,precoInvalido:false});
  assert.equal(parsePriceRequest('air fryer'),null);
});

test('reconhece links do Mercado Livre e da Shopee, com nome',async()=>{
  assert.equal(parseProductLink('https://www.mercadolivre.com.br/carregador-portatil-anker/p/MLB1').nome,'Carregador portatil anker');
  assert.equal(parseProductLink('https://produto.mercadolivre.com.br/MLB-123-fone-bluetooth-jbl-_JM').id_produto,'MLB123');
  assert.deepEqual(parseProductLink('https://shopee.com.br/Fone-Bluetooth-JBL-i.123456.987654321?sp_atk=x'),
    {loja:'shopee',id_produto:'123456_987654321',tipo:null,nome:'Fone Bluetooth JBL'});
  assert.equal(parseProductLink('https://shopee.com.br/opaanlp/1791562791/23894195354?__mobile__=1').id_produto,'1791562791_23894195354');
  // meli.la do "compartilhar": perfil de afiliado com o produto como 1º link.
  const pagina='<meta property="og:title" content="Power Bank Anker - R$ 689"/><a href="https://www.mercadolivre.com.br/pb/p/MLB48692416">x</a>';
  const pedidos=[];
  const fetcher=async(url,init)=>{
    pedidos.push(init.headers['User-Agent']);
    return url.startsWith('https://meli.la')
      ?new Response(null,{status:301,headers:{Location:'https://www.mercadolivre.com.br/social/fulano?ref=abc'}})
      :new Response(pagina,{status:200});
  };
  assert.deepEqual(await resolveProductLink('https://meli.la/1e8sTgB',fetcher),
    {loja:'mercadolivre',id_produto:'MLB48692416',tipo:'catalogo',nome:'Power Bank Anker'});
  assert.match(pedidos[0],/TaBaratoAlertaBot/);
});

test('cadastro cria produto só do público, alerta de 1 ano e mostra o cartão',async()=>{
  const db=fakeDb({
    ...HISTORICO,
    'INSERT INTO monitor_produtos':{id:3,nome:null},
    'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
    'COUNT(DISTINCT produto_id)':{total:0},
    'SELECT preco FROM monitor_leituras':{preco:699},
    'INSERT INTO alerta_precos':{id:7},
    'SELECT a.*,p.loja':ALERTA,
  });
  const resposta=await handlePriceAlert({DB:db},'55',`${LINK} 599,90`,1000,semRede);
  assert.match(resposta.text,/Alerta criado/);
  assert.match(resposta.text,/📈 30 dias: █▂▁/);
  assert.match(resposta.text,/Agora: <b>R\$\s?699,00/);
  const produto=db.executados.find(([sql])=>sql.includes('INSERT INTO monitor_produtos'));
  assert.match(produto[0],/VALUES\(\?,\?,\?,\?,1,0,\?\)/);
  const alerta=db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'));
  assert.deepEqual(alerta[1],['55',3,599.9,0,699,'link',1000,1000+365*86400]);
  const botoes=resposta.markup.inline_keyboard.flat().map(b=>b.callback_data||b.url);
  assert.ok(botoes.includes('a:7:v')&&botoes.includes('a:7:p')&&botoes.includes('a:7:e'));
});

test('respeita o limite por pessoa e recusa a Amazon por enquanto',async()=>{
  const cheio=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:10}});
  assert.match((await handlePriceAlert({DB:cheio},'55',LINK,1000,semRede)).text,/já tem 10 produtos/);
  const amazon=await handlePriceAlert({DB:fakeDb()},'55','https://www.amazon.com.br/dp/B0C1234567',1000,semRede);
  assert.match(amazon,/<b>Mercado Livre<\/b>, da <b>Shopee<\/b> ou do <b>AliExpress<\/b>\. A Amazon/);
});

test('botão do canal cria o alerta e copia o histórico do site',async()=>{
  const db=fakeDb({
    'SELECT title FROM offers':{title:'Power Bank Anker'},
    'INSERT INTO monitor_produtos':{id:21,nome:'Power Bank Anker'},
    'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
    'COUNT(DISTINCT produto_id)':{total:0},
    'INSERT INTO alerta_precos':{id:9},
    'SELECT a.*,p.loja':{...ALERTA,id:9,loja:'shopee'},
  });
  const resposta=await handleStartProduct({DB:db},'55','sp_1791562791_23894195354',1000);
  assert.match(resposta.text,/Power Bank Anker/);
  assert.ok(!resposta.markup.inline_keyboard.flat().some(b=>b.callback_data==='a:9:e'),'Shopee não tem aviso de estoque');
  const copia=db.executados.find(([sql])=>sql.includes('FROM offer_prices'));
  assert.deepEqual(copia[1].slice(0,2),[21,'shopee_1791562791_23894195354']);
  const alerta=db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'));
  assert.equal(alerta[1][5],'canal');
  assert.equal(await handleStartProduct({DB:db},'55','xx_123',1000),null);
});

test('botões do cartão ligam avisos, escolhem queda, prazo e apagam',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':ALERTA,...HISTORICO});
  const menor=await handleCallback({DB:db},'55','a:7:m',1000);
  assert.equal(menor.edit,true);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET avisar_menor'))[1],[0,7,'55']);
  const opcoes=await handleCallback({DB:db},'55','a:7:q',1000);
  assert.deepEqual(opcoes.markup.inline_keyboard[0].map(b=>b.text),['10%','20%','30%']);
  await handleCallback({DB:db},'55','a:7:q:20',1000);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET queda_percent=?'))[1],[20,699,7,'55']);
  await handleCallback({DB:db},'55','a:7:p:30',1000);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET expira_em'))[1],[1000+30*86400,7,'55']);
  await handleCallback({DB:db},'55','a:7:v',1000);
  assert.ok(db.executados.some(([sql,args])=>sql.startsWith('UPDATE alerta_precos SET editando_em')&&args[0]===1000));
  assert.match((await handleCallback({DB:db},'55','a:7:x',1000)).text,/Apagar o alerta/);
  await handleCallback({DB:db},'55','a:7:xx',1000);
  assert.ok(db.executados.some(([sql])=>sql.startsWith('DELETE FROM alerta_precos WHERE id=?')));
  assert.equal((await handleCallback({DB:fakeDb()},'55','a:7:m',1000)).answer,'Esse alerta não existe mais');
  assert.equal((await handleCallback({DB:db},'55','qualquer',1000)).answer,'Opção inválida');
});

test('valor digitado vale para o alerta em edição',async()=>{
  const db=fakeDb({'ORDER BY CASE WHEN a.editando_em':{id:7},'SELECT a.*,p.loja':{...ALERTA,preco_alvo:599.9},...HISTORICO});
  const resposta=await handlePriceChoice({DB:db},'55','599,90',1000);
  assert.match(resposta.text,/R\$\s?599,90/);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET preco_alvo'))[1],[599.9,7,'55']);
  assert.equal(await handlePriceChoice({DB:db},'55','air fryer',1000),null);
  assert.match((await handlePriceChoice({DB:fakeDb()},'55','599,90',1000)).text,/Primeiro cole o link/);
});

test('menu, lista com botões e tela inicial',async()=>{
  const db=fakeDb({
    'WHERE a.chat_id=? AND a.ativo=1 AND a.expira_em>? ORDER BY a.id':[{id:7,nome:'Power Bank Anker',id_produto:'MLB1',avisar_menor:1,atual:699}],
  });
  const lista=await handleUpdate({DB:db},{message:{text:'📋 Meus alertas',chat:{id:55,type:'private'}}},1000);
  assert.match(lista.text,/Power Bank Anker/);
  assert.equal(lista.markup.inline_keyboard[0][0].web_app.url,'https://canaltabarato.com.br/app/alertas');
  assert.equal(lista.markup.inline_keyboard[1][0].callback_data,'a:7:c');
  const novo=await handleUpdate({DB:db},{message:{text:'➕ Novo alerta',chat:{id:55,type:'private'}}},1000);
  assert.match(novo.text,/Copiar link/);
  const inicio=await handleUpdate({DB:db},{message:{text:'/start',chat:{id:55,type:'private'}}},1000);
  assert.equal(inicio[1].markup.inline_keyboard[0][0].callback_data,'ex');
});

test('toque de outra pessoa no botão é ignorado',async()=>{
  const {chamadas,fetcher}=enviar();
  const db=fakeDb({'SELECT a.*,p.loja':ALERTA});
  await responderBotao({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},{id:'q1',data:'a:7:xx',from:{id:99},message:{chat:{id:55,type:'private'}}},fetcher);
  assert.deepEqual(chamadas.map(c=>c.metodo),['answerCallbackQuery']);
  assert.equal(db.executados.length,0);
  await responderBotao({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},{id:'q2',data:'a:7:m',from:{id:55},message:{message_id:4,text:'cartão',chat:{id:55,type:'private'}}},fetcher);
  assert.deepEqual(chamadas.slice(1).map(c=>c.metodo),['answerCallbackQuery','editMessageText']);
});

test('aviso com valor pausa só quando era o único aviso e registra a entrega',async()=>{
  const {chamadas,fetcher}=enviar();
  const so={...ALERTA,avisar_menor:0,preco_alvo:200,imagem:'https://http2.mlstatic.com/a.jpg'};
  const db=fakeDb({'SELECT a.*,p.nome,p.imagem':so,...HISTORICO});
  const total=await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[
    {alerta_id:7,produto_id:3,preco:189.9,link:'https://go.canaltabarato.com.br/x',nome:'Fone',motivo:'alvo'},
    {alerta_id:7,produto_id:3,preco:189.9,link:'https://golpe.example/x',nome:'Fone',motivo:'alvo'},
  ],1000,fetcher);
  assert.equal(total,1);
  assert.equal(chamadas[0].metodo,'sendPhoto');
  assert.match(chamadas[0].corpo.caption,/você pediu até R\$\s?200,00/);
  assert.match(chamadas[0].corpo.caption,/foi pausado/);
  const update=db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET ultimo_aviso_em'));
  assert.match(update[0],/preco_alvo=NULL,ativo=\?/);
  assert.deepEqual(update[1],[1000,189.9,0,7]);
  assert.ok(db.executados.some(([sql])=>sql.startsWith('INSERT INTO alerta_avisos')));
  // Com outro aviso ligado, o alerta continua ativo.
  const db2=fakeDb({'SELECT a.*,p.nome,p.imagem':{...so,avisar_menor:1},...HISTORICO});
  await deliverPriceAlerts({DB:db2,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:189.9,link:'https://meli.la/x',motivo:'alvo'}],1000,fetcher);
  assert.equal(db2.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET ultimo_aviso_em'))[1][2],1);
});

test('queda atualiza a referência e quem bloqueou é apagado',async()=>{
  const {fetcher}=enviar();
  const db=fakeDb({'SELECT a.*,p.nome,p.imagem':{...ALERTA,queda_percent:20},...HISTORICO});
  await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:540,link:'https://meli.la/x',motivo:'queda'}],1000,fetcher);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET ultimo_aviso_em'))[1],[1000,540,540,7]);
  const bloqueado=fakeDb({'SELECT a.*,p.nome,p.imagem':ALERTA,...HISTORICO});
  await deliverPriceAlerts({DB:bloqueado,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:90,link:'https://meli.la/x',motivo:'menor_preco'}],1000,
    async()=>new Response('{}',{status:403}));
  assert.ok(bloqueado.executados.some(([sql])=>sql==='DELETE FROM alerta_precos WHERE chat_id=?'));
});

test('texto dos avisos e mini gráfico',()=>{
  assert.equal(sparkline([10,20,30]),'▁▅█');
  assert.equal(sparkline([5]),'');
  const texto=formatPriceNotice({motivo:'menor_preco',dias_janela:45,nome:'Fone <X>',preco:90,media:120,dias_media:30,abaixo:25},{},{minimo:90,maximo:130,linha:'▇▅▁'});
  assert.match(texto,/Menor preço em 45 dias/);
  assert.match(texto,/Fone &lt;X&gt;/);
  assert.match(texto,/25% abaixo da média/);
  assert.match(texto,/📈 30 dias: ▇▅▁/);
  assert.match(formatPriceNotice({motivo:'estoque',preco:90},{}),/Voltou ao estoque/);
  assert.match(formatPriceNotice({motivo:'queda',preco:80},{queda_percent:20,preco_base:100}),/Caiu 20% desde/);
});

test('lembra 7 dias antes de vencer e pausa quando vence',async()=>{
  const {chamadas,fetcher}=enviar();
  const db=fakeDb({
    'a.lembrete_em IS NULL':[{id:7,chat_id:'55',expira_em:1000+3*86400,nome:'Fone'}],
    'a.expira_em<=? LIMIT 50':[{id:8,chat_id:'55',nome:'Lanterna'}],
  });
  await expirePriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},1000,fetcher);
  assert.match(chamadas[0].corpo.text,/vence em/);
  assert.equal(chamadas[0].corpo.reply_markup.inline_keyboard[0][0].callback_data,'a:7:r');
  assert.match(chamadas[1].corpo.text,/venceu/);
  assert.ok(db.executados.some(([sql,args])=>sql.startsWith('UPDATE alerta_precos SET ativo=0')&&args[0]===8));
});

test('cartão sem leitura ainda explica a espera',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':{...ALERTA,avisar_menor:0}});
  const r=await cartao({DB:db},'55',7,1000);
  assert.match(r.text,/aguardando a primeira leitura/);
  assert.match(r.text,/Nenhum aviso ligado/);
});

test('site liga os toques nos botões no webhook e atualiza o perfil (com foto) só quando falta',async()=>{
  const {garantirConfiguracao,DESCRICAO,FOTO_URL,ATUALIZACOES}=await import('../functions/_alert_bot_setup.js');
  const env={TELEGRAM_ALERTS_BOT_TOKEN:'t',TELEGRAM_ALERTS_WEBHOOK_SECRET:'segredo'};
  const WEBHOOK={url:'https://canaltabarato.com.br/api/telegram-alerts',allowed_updates:ATUALIZACOES};
  const {BOTAO_MENU,COMANDOS}=await import('../functions/_alert_bot_setup.js');
  let chamadas=[];
  let menu=BOTAO_MENU, comandos=COMANDOS;
  const fetcher=(info,descricao,fotoStatus=200)=>async(url,init)=>{
    if(url===FOTO_URL) return new Response(new Uint8Array([255,216,255]),{status:200});
    const metodo=url.split('/').pop();
    if(metodo==='getWebhookInfo'){chamadas.push(metodo);return Response.json({ok:true,result:info});}
    if(metodo==='getMyDescription'){chamadas.push(metodo);return Response.json({ok:true,result:{description:descricao}});}
    if(metodo==='getChatMenuButton'){chamadas.push(metodo);return Response.json({ok:true,result:menu});}
    if(metodo==='getMyCommands'){chamadas.push(metodo);return Response.json({ok:true,result:comandos});}
    chamadas.push(metodo,init.body instanceof FormData?init.body:JSON.parse(init.body));
    return new Response('{}',{status:metodo==='setMyProfilePhoto'?fotoStatus:200});
  };
  // Tudo em dia: só as duas leituras.
  assert.equal(await garantirConfiguracao(env,fetcher(WEBHOOK,DESCRICAO)),false);
  assert.deepEqual(chamadas,['getWebhookInfo','getMyCommands','getChatMenuButton','getMyDescription']);
  // Comandos desatualizados (sem /convidar): só os comandos mudam.
  chamadas=[];comandos=COMANDOS.filter(c=>c.command!=='convidar');
  assert.equal(await garantirConfiguracao(env,fetcher(WEBHOOK,DESCRICAO)),true);
  assert.ok(chamadas[chamadas.indexOf('setMyCommands')+1].commands.some(c=>c.command==='convidar'));
  assert.ok(!chamadas.includes('setMyProfilePhoto'));
  comandos=COMANDOS;
  // Botão de menu ainda padrão: vira o mini app.
  chamadas=[];menu={type:'commands'};
  assert.equal(await garantirConfiguracao(env,fetcher(WEBHOOK,DESCRICAO)),true);
  assert.deepEqual(chamadas[chamadas.indexOf('setChatMenuButton')+1],{menu_button:BOTAO_MENU});
  menu=BOTAO_MENU;
  // Webhook sem os botões: corrige só o webhook.
  chamadas=[];
  assert.equal(await garantirConfiguracao(env,fetcher({...WEBHOOK,allowed_updates:['message']},DESCRICAO)),true);
  const webhook=chamadas[chamadas.indexOf('setWebhook')+1];
  assert.equal(webhook.secret_token,'segredo');
  assert.deepEqual(webhook.allowed_updates,['message','callback_query','inline_query']);
  assert.ok(!chamadas.includes('setMyProfilePhoto'));
  // Descrição antiga: comandos, foto e, por último, a descrição nova.
  chamadas=[];
  assert.equal(await garantirConfiguracao(env,fetcher(WEBHOOK,'texto antigo')),true);
  const metodos=chamadas.filter(c=>typeof c==='string');
  assert.deepEqual(metodos,['getWebhookInfo','getMyCommands','getChatMenuButton','getMyDescription','setMyCommands','setMyShortDescription','setMyProfilePhoto','setMyDescription']);
  assert.ok(chamadas[chamadas.indexOf('setMyCommands')+1].commands.some(c=>c.command==='buscar'));
  const foto=chamadas[chamadas.indexOf('setMyProfilePhoto')+1];
  assert.deepEqual(JSON.parse(foto.get('photo')),{type:'static',photo:'attach://foto'});
  assert.equal(foto.get('foto').type,'image/jpeg');
  assert.match(chamadas.at(-1).description,/AliExpress/);
  // Foto recusada: não grava a descrição, para tentar de novo na próxima coleta.
  chamadas=[];
  await garantirConfiguracao(env,fetcher(WEBHOOK,'texto antigo',400));
  assert.ok(!chamadas.includes('setMyDescription'));
});

test('produto ainda sem nome não mostra código',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':{...ALERTA,nome:null,loja:'shopee',id_produto:'1127030290_22597720651'}});
  const r=await cartao({DB:db},'55',7,1000);
  assert.match(r.text,/Produto da Shopee \(nome na 1ª leitura\)/);
  assert.doesNotMatch(r.text,/1127030290/);
});
