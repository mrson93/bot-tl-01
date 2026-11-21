import {html,money} from './_site.js';
import {resolveProductLink} from './_product_link.js';
import {graficoPng} from './_price_chart.js';
import {VALIDADE_COMPARACAO,comparacao,sugestaoMaisBarata} from './_compare_stores.js';
import {contarIndicacao,limitePessoa,maxComBonus,mensagemConvite} from './_referral.js';

// Alertas de preço por produto do bot público (@TaBaratoAlertaDePrecoBot).
// A pessoa cola o link do produto (ou toca em "Avisar quando baixar" num post
// do canal) e escolhe os avisos num cartão com botões. A coleta do monitor
// (a cada 2 h, no GitHub) decide quem avisar e o site entrega a mensagem.
const TELEGRAM_API='https://api.telegram.org';
const HOSTS_LINK=['go.canaltabarato.com.br','mercadolivre.com.br','mercadolivre.com','meli.la','amazon.com.br','amzn.to','shopee.com.br','shope.ee','aliexpress.com'];
export const HOSTS_IMAGEM=['mlstatic.com','susercontent.com','shopee.com.br','media-amazon.com','alicdn.com','aliexpress-media.com'];
const MOTIVOS=new Set(['alvo','menor_preco','abaixo_media','queda','estoque']);
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee',amazon:'Amazon',aliexpress:'AliExpress'};
export const LOJA_DE={mercadolivre:'do Mercado Livre',shopee:'da Shopee',amazon:'da Amazon',aliexpress:'do AliExpress'};
const PREFIXO_OFERTA={mercadolivre:'mercadolivre_',shopee:'shopee_',amazon:'amazon_',aliexpress:'aliexpress_'};
export const PRAZOS=[[30,'1 mês'],[90,'3 meses'],[180,'6 meses'],[365,'1 ano']];
export const QUEDAS=[10,20,30];
const BLOCOS='▁▂▃▄▅▆▇█';

export const MENU_NOVO='➕ Novo alerta';
export const MENU_LISTA='📋 Meus alertas';
export const MENU_AJUDA='❓ Ajuda';
export const MENU_BUSCA='🔎 Buscar produto';
export const MENU={keyboard:[[{text:MENU_NOVO},{text:MENU_BUSCA}],[{text:MENU_LISTA},{text:MENU_AJUDA}]],resize_keyboard:true,is_persistent:true};
// Teclado do cadastro antigo: quem ainda tiver esses botões na tela continua atendido.
const ANTIGOS_MENOR=new Set(['🔥 Menor preço do histórico','🔥 Menor preço real']);
const ANTIGO_VALOR='💰 Definir um valor';

function limite(env,nome,padrao) {
  const valor=Number.parseInt(env?.[nome]||'',10);
  return Number.isInteger(valor)&&valor>0?valor:padrao;
}
export const maxPorPessoa=env=>limite(env,'ALERTA_MAX_PRODUTOS_POR_PESSOA',10);
export const maxTotal=env=>limite(env,'ALERTA_MAX_PRODUTOS_TOTAL',1000);
export const diasValidade=env=>limite(env,'ALERTA_DIAS_VALIDADE',365);

// "199,90", "R$ 1.299,90", "199.90" -> número; vazio ou inválido -> null.
export function parsePrice(valor='') {
  let texto=String(valor).replace(/r\$|\s/gi,'');
  if(!texto) return null;
  if(texto.includes(',')) texto=texto.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(texto)) texto=texto.replace(/\./g,'');
  if(!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const numero=Number(texto);
  return numero>0&&numero<1_000_000?Math.round(numero*100)/100:null;
}

export function parsePriceRequest(texto='') {
  const link=String(texto).match(/https?:\/\/\S+/i);
  if(!link) return null;
  const resto=String(texto).replace(link[0],' ').trim();
  return {link:link[0],alvo:resto?parsePrice(resto):null,precoInvalido:Boolean(resto)&&parsePrice(resto)===null};
}

export function urlPermitida(valor,hosts=HOSTS_LINK) {
  try {
    const url=new URL(String(valor||''));
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&hosts.some(h=>host===h||host.endsWith(`.${h}`))?url.toString():null;
  } catch { return null; }
}

function silencioso(now) {
  const hora=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now*1000)));
  return hora>=23||hora<7;
}

function data(epoch) {
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(epoch*1000));
}

function prazoTexto(dias) {
  const achado=PRAZOS.find(([d])=>d===dias);
  return achado?achado[1]:`${dias} dias`;
}

// Envia um arquivo (multipart): o gráfico vai direto, sem link público.
export async function telegramArquivo(env,metodo,campos,arquivo,fetcher=fetch) {
  const form=new FormData();
  for(const [chave,valor] of Object.entries(campos)) if(valor!==undefined) form.append(chave,typeof valor==='string'?valor:JSON.stringify(valor));
  form.append(arquivo.campo,new Blob([arquivo.bytes],{type:arquivo.tipo||'image/png'}),arquivo.nome||'grafico.png');
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/${metodo}`,{method:'POST',body:form});
  return resposta.status;
}

export async function telegram(env,metodo,corpo,fetcher=fetch) {
  const resposta=await fetcher(`${TELEGRAM_API}/bot${env.TELEGRAM_ALERTS_BOT_TOKEN}/${metodo}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo),
  });
  return resposta.status;
}

export function deleteStatements(env,chatId) {
  return [env.DB.prepare('DELETE FROM alerta_precos WHERE chat_id=?').bind(chatId),
    env.DB.prepare('DELETE FROM alerta_pessoas WHERE chat_id=?').bind(chatId)];
}

export function apagarPessoa(env,chatId) {
  return env.DB.batch([
    ...deleteStatements(env,chatId),
    env.DB.prepare('DELETE FROM alert_subscriptions WHERE chat_id=?').bind(chatId),
    env.DB.prepare('DELETE FROM alert_deliveries WHERE chat_id=?').bind(chatId),
  ]);
}

// --- Cartão do alerta (o "painel" de cada produto) ----------------------------

export async function lerAlerta(env,chatId,alertaId) {
  return env.DB.prepare(
    `SELECT a.*,p.loja,p.id_produto,p.nome,p.link_afiliado,p.imagem,p.preco_max,p.cupom_codigo,p.cupom_condicao,p.cupom_expira_em,p.comparacao,p.comparado_em
     FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id WHERE a.id=? AND a.chat_id=?`,
  ).bind(Number(alertaId),String(chatId)).first();
}

export function sparkline(valores) {
  const numeros=valores.filter(v=>v>0);
  if(numeros.length<2) return '';
  const min=Math.min(...numeros), max=Math.max(...numeros);
  return numeros.map(v=>BLOCOS[max===min?3:Math.round((v-min)/(max-min)*(BLOCOS.length-1))]).join('');
}

// Termômetro: compara o preço com o menor preço de cada dia do último ano.
// Abaixo de 14 dias de histórico não dá selo (seria enganoso).
export const DIAS_TERMOMETRO=14;
export function termometro(atual,valores=[]) {
  const dias=valores.map(Number).filter(v=>v>0);
  const preco=Number(atual);
  if(!(preco>0)) return null;
  if(dias.length<DIAS_TERMOMETRO) return {nivel:'aprendendo',dias:dias.length,emoji:'⏳',
    texto:`Termômetro: juntando histórico (${dias.length} de ${DIAS_TERMOMETRO} dias)`};
  const maisCaros=dias.filter(v=>v>preco).length, iguais=dias.filter(v=>v===preco).length;
  const posicao=(dias.length-maisCaros-iguais/2)/dias.length; // 0 = o mais barato, 1 = o mais caro
  const periodo=`dos últimos ${dias.length} dias`;
  if(posicao<=0.25) return {nivel:'baixo',dias:dias.length,emoji:'🟢',
    texto:`Preço baixo: mais barato que em ${Math.round(maisCaros/dias.length*100)}% ${periodo}`};
  if(posicao>=0.75) return {nivel:'caro',dias:dias.length,emoji:'🔴',
    texto:`Preço alto: esteve mais barato em ${Math.round(dias.filter(v=>v<preco).length/dias.length*100)}% ${periodo}`};
  return {nivel:'medio',dias:dias.length,emoji:'🟡',texto:`Preço na média ${periodo}`};
}

const DIA_SQL="date(lido_em-10800,'unixepoch')";
const diaDe=epoch=>new Date((epoch-10800)*1000).toISOString().slice(0,10);

async function diarios(env,produtoId,desde) {
  const {results=[]}=await env.DB.prepare(
    `SELECT ${DIA_SQL} AS dia,MIN(preco) AS preco FROM monitor_leituras
     WHERE produto_id=? AND disponivel=1 AND preco>0 AND lido_em>=? GROUP BY dia ORDER BY dia`,
  ).bind(produtoId,desde).all();
  return results;
}

export async function historico(env,produtoId,now) {
  const resumo=await env.DB.prepare(
    `SELECT MIN(preco) AS minimo,MAX(preco) AS maximo,MIN(lido_em) AS desde,
       (SELECT preco FROM monitor_leituras WHERE produto_id=?1 ORDER BY lido_em DESC LIMIT 1) AS atual,
       (SELECT disponivel FROM monitor_leituras WHERE produto_id=?1 ORDER BY lido_em DESC LIMIT 1) AS disponivel
     FROM monitor_leituras WHERE produto_id=?1 AND disponivel=1 AND preco>0 AND lido_em>=?2`,
  ).bind(produtoId,now-365*86400).first();
  const ano=await diarios(env,produtoId,now-365*86400);
  const corte=diaDe(now-30*86400);
  const valores=ano.map(r=>Number(r.preco));
  return {...(resumo||{}),valores,
    linha:sparkline(ano.filter(r=>!r.dia||r.dia>=corte).map(r=>Number(r.preco))),
    termometro:termometro(resumo?.atual,valores)};
}

// Sem nome ainda (ex.: link curto da Shopee): o nome chega na primeira leitura.
function nomeSimples(alerta) {
  return alerta?.nome||`Produto ${LOJA_DE[alerta?.loja]||alerta?.id_produto||''} (nome na 1ª leitura)`;
}

function nomeDe(alerta,limiteTexto=120) {
  return html(String(nomeSimples(alerta)).slice(0,limiteTexto));
}

export async function cartao(env,chatId,alertaId,now=Math.floor(Date.now()/1000),titulo='') {
  const a=await lerAlerta(env,chatId,alertaId);
  if(!a) return {text:'Esse alerta não existe mais. Veja os seus em 📋 Meus alertas.'};
  const h=await historico(env,a.produto_id,now);
  const linhas=[];
  if(titulo) linhas.push(titulo,'');
  linhas.push(`🔔 <b>${nomeDe(a)}</b>`,`🛒 ${LOJA[a.loja]||a.loja}`);
  if(h.atual) linhas.push(`💰 Agora: ${precoComVariacoes(h.atual,a.preco_max)}${h.disponivel===0?' · sem estoque':''}`);
  else linhas.push('💰 Agora: aguardando a primeira leitura (até 2 horas)');
  const cupom=linhaCupom(a,now);
  if(cupom) linhas.push(cupom);
  const outraLoja=h.atual&&h.disponivel!==0&&a.nome?sugestaoMaisBarata(await comparacao(env,a,h.atual,now),h.atual):null;
  if(outraLoja) linhas.push(outraLoja.linha);
  if(h.minimo){
    const dias=Math.max(1,Math.round((now-h.desde)/86400));
    linhas.push(`📊 Em ${dias} dia(s): menor ${html(money(h.minimo))} · maior ${html(money(h.maximo))}`);
  }
  if(h.linha) linhas.push(`📈 30 dias: ${h.linha}`);
  if(h.atual&&h.disponivel!==0&&h.termometro) linhas.push(`${h.termometro.emoji} ${h.termometro.texto}`);
  const avisos=[];
  if(a.avisar_menor) avisos.push('✅ Menor preço do histórico');
  if(a.preco_alvo) avisos.push(`✅ Chegar a ${html(money(a.preco_alvo))} ou menos`);
  if(a.queda_percent) avisos.push(`✅ Cair ${Math.round(a.queda_percent)}%${a.preco_base?` (desde ${html(money(a.preco_base))})`:''}`);
  if(a.avisar_estoque) avisos.push('✅ Voltar ao estoque');
  linhas.push('','<b>Vou te avisar quando:</b>',...(avisos.length?avisos:['⚠️ Nenhum aviso ligado. Escolha um abaixo.']));
  linhas.push('',a.ativo?`⏳ Alerta vale até ${data(a.expira_em)}.`:'⏸ Alerta pausado. Toque em ⏳ Prazo para reativar.');
  const id=a.id;
  const teclado=[
    [{text:`${a.avisar_menor?'✅':'⬜'} Menor preço`,callback_data:`a:${id}:m`},
     {text:a.preco_alvo?`💰 Até ${money(a.preco_alvo)}`:'💰 Definir valor',callback_data:`a:${id}:v`}],
    [{text:a.queda_percent?`📉 Queda ${Math.round(a.queda_percent)}%`:'📉 Avisar queda %',callback_data:`a:${id}:q`}],
  ];
  if(a.loja==='mercadolivre') teclado[1].push({text:`${a.avisar_estoque?'✅':'⬜'} Voltar ao estoque`,callback_data:`a:${id}:e`});
  const loja=urlPermitida(a.link_afiliado);
  teclado.push([{text:'📈 Gráfico',callback_data:`a:${id}:g`},{text:'⏳ Prazo',callback_data:`a:${id}:p`}]);
  if(loja) teclado.push([{text:'🛒 Ver na loja',url:loja}]);
  if(outraLoja) teclado.push([outraLoja.botao]);
  teclado.push([{text:'🗑 Apagar alerta',callback_data:`a:${id}:x`},{text:'📋 Todos',callback_data:'l'}]);
  return {text:linhas.join('\n'),markup:{inline_keyboard:teclado}};
}

// --- Cadastro ------------------------------------------------------------------

export async function handlePriceAlert(env,chatId,texto,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const pedido=parsePriceRequest(texto);
  if(!pedido) return null;
  if(pedido.precoInvalido) return 'Não entendi o preço. Mande o link e o valor assim: <code>https://… 199,90</code>';
  const produto=await resolveProductLink(pedido.link,fetcher);
  if(produto?.erro==='perfil_afiliado') return 'Esse link abre a página de perfil de afiliado do Mercado Livre, não a do produto, e nele não dá para saber qual é o produto. Abra o produto e copie o link da barra de endereços (ele tem /p/MLB… ou MLB-…).';
  if(!produto) return 'Não reconheci esse produto. Mande o link da página do produto do <b>Mercado Livre</b>, da <b>Shopee</b> ou do <b>AliExpress</b>.';
  if(produto.loja==='amazon'){
    return 'Por enquanto os alertas de preço funcionam com produtos do <b>Mercado Livre</b>, da <b>Shopee</b> ou do <b>AliExpress</b>. A Amazon entra em breve.';
  }
  return cadastrarAlerta(env,chatId,produto,pedido.alvo,now,'link');
}

// Botão "Avisar quando baixar" dos posts do canal: /start ml_MLB123, sp_LOJA_ITEM ou ae_ITEM.
// A busca pelo nome usa o mesmo caminho (origem 'busca'), às vezes já com nome e preço.
export async function handleStartProduct(env,chatId,payload,now=Math.floor(Date.now()/1000),origem='canal',extra=null) {
  const achado=String(payload||'').match(/^(ml|sp|ae)_([A-Za-z0-9_]{3,60})$/);
  if(!achado) return null;
  const produto=achado[1]==='ml'
    ?(/^MLB\d+$/i.test(achado[2])?{loja:'mercadolivre',id_produto:achado[2].toUpperCase(),tipo:null}:null)
    :achado[1]==='ae'
      ?(/^\d{6,20}$/.test(achado[2])?{loja:'aliexpress',id_produto:achado[2],tipo:null}:null)
      :(/^\d+_\d+$/.test(achado[2])?{loja:'shopee',id_produto:achado[2],tipo:null}:null);
  if(!produto) return null;
  const dados=extra&&extra.loja===produto.loja&&extra.id_produto===produto.id_produto
    ?{...produto,nome:extra.nome||null,preco:Number(extra.preco)>0?Number(extra.preco):null}:produto;
  return cadastrarAlerta(env,chatId,dados,null,now,origem);
}

async function cadastrarAlerta(env,chatId,produto,alvo,now,origem) {
  const ofertaId=PREFIXO_OFERTA[produto.loja]+produto.id_produto;
  if(!produto.nome){
    const oferta=await env.DB.prepare('SELECT title FROM offers WHERE id=?').bind(ofertaId).first();
    if(oferta?.title) produto={...produto,nome:String(oferta.title).slice(0,160)};
  }
  const existente=await env.DB.prepare('SELECT id,nome FROM monitor_produtos WHERE loja=? AND id_produto=?')
    .bind(produto.loja,produto.id_produto).first();
  const meus=await env.DB.prepare('SELECT COUNT(*) AS total FROM alerta_precos WHERE chat_id=? AND ativo=1 AND expira_em>? AND produto_id<>?')
    .bind(chatId,now,existente?.id||0).first();
  const limiteDaPessoa=await limitePessoa(env,chatId);
  if(Number(meus?.total||0)>=limiteDaPessoa){
    const podeGanhar=limiteDaPessoa<maxComBonus(env)&&!String(chatId).startsWith('-');
    return {text:`Você já tem ${limiteDaPessoa} produtos com alerta. Abra 📋 Meus alertas e apague um para criar outro`
      +(podeGanhar?', ou convide amigos para ganhar mais vagas.':'.'),
      markup:podeGanhar?{inline_keyboard:[[{text:'🎁 Convidar amigos',callback_data:'cv'}],[{text:'📋 Meus alertas',callback_data:'l'}]]}:MENU};
  }
  if(!existente){
    const total=await env.DB.prepare('SELECT COUNT(DISTINCT produto_id) AS total FROM alerta_precos WHERE ativo=1 AND expira_em>?').bind(now).first();
    if(Number(total?.total||0)>=maxTotal(env)) return 'Os alertas de preço estão lotados no momento. Tente de novo em alguns dias.';
  }
  const linha=existente||await env.DB.prepare(
    `INSERT INTO monitor_produtos(loja,id_produto,tipo,nome,ativo,canal,criado_em) VALUES(?,?,?,?,1,0,?)
     ON CONFLICT(loja,id_produto) DO UPDATE SET tipo=COALESCE(monitor_produtos.tipo,excluded.tipo) RETURNING id,nome`,
  ).bind(produto.loja,produto.id_produto,produto.tipo,produto.nome||null,now).first();
  if(existente&&!existente.nome&&produto.nome){
    await env.DB.prepare('UPDATE monitor_produtos SET nome=? WHERE id=? AND nome IS NULL').bind(produto.nome,existente.id).run();
  }
  // Produto que já passou pelo canal: o histórico diário do site vira o ponto
  // de partida, para comparar com meses de preço desde o primeiro dia.
  await env.DB.prepare(
    `INSERT INTO monitor_leituras(produto_id,preco,preco_antigo,disponivel,lido_em)
     SELECT ?1,price,NULL,1,observed_at FROM offer_prices
     WHERE offer_id=?2 AND observed_at>=?3 AND price>0 AND NOT EXISTS(SELECT 1 FROM monitor_leituras WHERE produto_id=?1)`,
  ).bind(linha.id,ofertaId,now-365*86400).run();
  // Veio da busca com preço lido agora: vira a primeira leitura (o cartão já mostra o preço).
  if(produto.preco>0){
    await env.DB.prepare(
      `INSERT INTO monitor_leituras(produto_id,preco,preco_antigo,disponivel,lido_em)
       SELECT ?1,?2,NULL,1,?3 WHERE NOT EXISTS(SELECT 1 FROM monitor_leituras WHERE produto_id=?1)`,
    ).bind(linha.id,produto.preco,now).run();
  }
  const ultima=await env.DB.prepare('SELECT preco FROM monitor_leituras WHERE produto_id=? AND disponivel=1 AND preco>0 ORDER BY lido_em DESC LIMIT 1')
    .bind(linha.id).first();
  const alerta=await env.DB.prepare(
    `INSERT INTO alerta_precos(chat_id,produto_id,preco_alvo,avisar_menor,preco_base,origem,ativo,criado_em,expira_em) VALUES(?,?,?,?,?,?,1,?,?)
     ON CONFLICT(chat_id,produto_id) DO UPDATE SET preco_alvo=excluded.preco_alvo,avisar_menor=excluded.avisar_menor,
       preco_base=excluded.preco_base,ativo=1,criado_em=excluded.criado_em,expira_em=excluded.expira_em,
       ultimo_aviso_em=NULL,ultimo_aviso_preco=NULL,lembrete_em=NULL,editando_em=NULL RETURNING id`,
  ).bind(chatId,linha.id,alvo,alvo?0:1,ultima?.preco||null,origem,now,now+diasValidade(env)*86400).first();
  try{ await contarIndicacao(env,chatId,now); }
  catch(error){ console.error(JSON.stringify({event:'indicacao',result:'failed',reason:String(error?.message||error).slice(0,60)})); }
  return cartao(env,chatId,alerta.id,now,'✅ <b>Alerta criado!</b> Toque nos botões para escolher os avisos.');
}

// --- Lista e comandos de texto ----------------------------------------------------

export async function listPriceAlerts(env,chatId,now=Math.floor(Date.now()/1000)) {
  const {results=[]}=await env.DB.prepare(
    `SELECT a.id,a.produto_id,a.preco_alvo,a.avisar_menor,a.queda_percent,a.avisar_estoque,p.nome,p.id_produto,p.loja,
       (SELECT preco FROM monitor_leituras l WHERE l.produto_id=p.id AND l.disponivel=1 AND l.preco>0 ORDER BY l.lido_em DESC LIMIT 1) AS atual
     FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE a.chat_id=? AND a.ativo=1 AND a.expira_em>? ORDER BY a.id`,
  ).bind(chatId,now).all();
  if(!results.length) return results;
  // Um só pedido para o termômetro de todos os produtos da lista.
  const {results:dias=[]}=await env.DB.prepare(
    `SELECT l.produto_id,${DIA_SQL.replace('lido_em','l.lido_em')} AS dia,MIN(l.preco) AS preco FROM monitor_leituras l
     WHERE l.produto_id IN (SELECT produto_id FROM alerta_precos WHERE chat_id=? AND ativo=1 AND expira_em>?)
       AND l.disponivel=1 AND l.preco>0 AND l.lido_em>=? GROUP BY l.produto_id,dia`,
  ).bind(chatId,now,now-365*86400).all();
  const porProduto=new Map();
  for(const d of dias){
    if(!porProduto.has(d.produto_id)) porProduto.set(d.produto_id,[]);
    porProduto.get(d.produto_id).push(Number(d.preco));
  }
  return results.map(a=>({...a,termometro:a.atual?termometro(a.atual,porProduto.get(a.produto_id)||[]):null}));
}

function resumoAvisos(a) {
  const partes=[];
  if(a.avisar_menor) partes.push('menor preço');
  if(a.preco_alvo) partes.push(`até ${money(a.preco_alvo)}`);
  if(a.queda_percent) partes.push(`queda ${Math.round(a.queda_percent)}%`);
  if(a.avisar_estoque) partes.push('estoque');
  return partes.join(' · ')||'nenhum aviso ligado';
}

export function formatPriceAlertList(alertas) {
  return alertas.map((a,i)=>{
    const selo=a.termometro&&a.termometro.nivel!=='aprendendo'?` ${a.termometro.emoji}`:'';
    const atual=a.atual?`agora ${html(money(a.atual))}${selo}`:'aguardando a primeira leitura';
    return `${i+1}. ${nomeDe(a,90)}\n   ${atual} · ${html(resumoAvisos(a))}`;
  }).join('\n');
}

export function listaComBotoes(alertas,resumo=null) {
  const linhas=alertas.map((a,i)=>[{
    text:`${i+1}. ${String(nomeSimples(a)).slice(0,40)}`,callback_data:`a:${a.id}:c`,
  }]);
  if(resumo!==null){
    linhas.unshift([{text:'📱 Abrir painel (gráficos e ajustes)',web_app:{url:'https://canaltabarato.com.br/app/alertas'}}]);
    linhas.push([{text:'🎁 Convidar amigos (mais vagas)',callback_data:'cv'}]);
    linhas.push([{text:`⚙️ Resumo semanal: ${resumo?'ligado':'desligado'}`,callback_data:`rs:${resumo?0:1}`}]);
  }
  return {inline_keyboard:linhas};
}

// Resumo semanal: ligado por padrão (sem linha = ligado).
export async function resumoLigado(env,chatId) {
  const linha=await env.DB.prepare('SELECT resumo_semanal FROM alerta_pessoas WHERE chat_id=?').bind(String(chatId)).first();
  return linha?Number(linha.resumo_semanal)===1:true;
}

export async function removePriceAlert(env,chatId,numero,now=Math.floor(Date.now()/1000)) {
  const alertas=await listPriceAlerts(env,chatId,now);
  const alvo=alertas[Number(numero)-1];
  if(!alvo) return 'Não achei esse número. Veja a lista em 📋 Meus alertas.';
  await env.DB.prepare('DELETE FROM alerta_precos WHERE id=? AND chat_id=?').bind(alvo.id,chatId).run();
  return `🗑 Alerta removido: ${nomeDe(alvo,70)}`;
}

// Alerta em edição (tocou em "Valor" há pouco) ou, sem isso, o mais recente.
async function alertaEmFoco(env,chatId,now) {
  return env.DB.prepare(
    `SELECT a.id FROM alerta_precos a WHERE a.chat_id=? AND a.expira_em>?
     ORDER BY CASE WHEN a.editando_em>=? THEN a.editando_em ELSE 0 END DESC,a.criado_em DESC,a.id DESC LIMIT 1`,
  ).bind(chatId,now,now-15*60).first();
}

export async function definirValor(env,chatId,alertaId,alvo,now) {
  await env.DB.prepare(
    'UPDATE alerta_precos SET preco_alvo=?,ativo=1,editando_em=NULL,ultimo_aviso_em=NULL,ultimo_aviso_preco=NULL WHERE id=? AND chat_id=?',
  ).bind(alvo,alertaId,chatId).run();
  return cartao(env,chatId,alertaId,now,alvo?`✅ Combinado! Aviso quando chegar a <b>${html(money(alvo))}</b> ou menos.`:'✅ Valor removido.');
}

// Mensagens que não são link nem palavra: valor solto, /preco, /menor e o
// teclado antigo do cadastro.
export async function handlePriceChoice(env,chatId,texto,now=Math.floor(Date.now()/1000)) {
  const valor=String(texto||'').trim();
  const comando=valor.match(/^\/(preco|menor)(?:@\w+)?\s*(\d{1,2})?\s*(.*)$/i);
  if(comando){
    const lista=comando[2]?await listPriceAlerts(env,chatId,now):null;
    const alerta=lista?lista[Number(comando[2])-1]:await alertaEmFoco(env,chatId,now);
    if(!alerta) return 'Não achei esse alerta. Veja os números em 📋 Meus alertas.';
    if(comando[1].toLowerCase()==='menor'){
      await env.DB.prepare('UPDATE alerta_precos SET avisar_menor=1,ativo=1 WHERE id=? AND chat_id=?').bind(alerta.id,chatId).run();
      return cartao(env,chatId,alerta.id,now,'✅ Aviso de menor preço do histórico ligado.');
    }
    const alvo=parsePrice(comando[3]);
    if(!alvo) return 'Use assim: <code>/preco 1 599,90</code> (o número vem de 📋 Meus alertas).';
    return definirValor(env,chatId,alerta.id,alvo,now);
  }
  if(ANTIGOS_MENOR.has(valor)){
    const alerta=await alertaEmFoco(env,chatId,now);
    if(!alerta) return null;
    await env.DB.prepare('UPDATE alerta_precos SET avisar_menor=1,ativo=1 WHERE id=? AND chat_id=?').bind(alerta.id,chatId).run();
    return cartao(env,chatId,alerta.id,now,'✅ Aviso de menor preço do histórico ligado.');
  }
  if(valor===ANTIGO_VALOR){
    const alerta=await alertaEmFoco(env,chatId,now);
    if(!alerta) return null;
    await env.DB.prepare('UPDATE alerta_precos SET editando_em=? WHERE id=?').bind(now,alerta.id).run();
    return {text:'Quanto você quer pagar? Mande só o valor, por exemplo: <code>599,90</code>',markup:MENU};
  }
  const alvo=parsePrice(valor);
  if(!alvo) return null;
  const alerta=await alertaEmFoco(env,chatId,now);
  if(!alerta) return {text:'Primeiro cole o link de um produto do Mercado Livre, da Shopee ou do AliExpress. Depois você escolhe o valor.',markup:MENU};
  return definirValor(env,chatId,alerta.id,alvo,now);
}

// --- Gráfico -------------------------------------------------------------------------

export const PERIODOS_GRAFICO=[[30,'30 dias'],[90,'90 dias'],[365,'1 ano']];

// Devolve {answer, photo:{png,caption}, markup, edit}; edit troca a foto do
// próprio gráfico (botões de período) em vez de mandar outra.
async function grafico(env,a,dias,now,edit) {
  const pontos=await diarios(env,a.produto_id,now-dias*86400);
  const desenho=await graficoPng(pontos,{alvo:a.preco_alvo});
  if(!desenho) return {answer:'Pouco histórico ainda',
    text:`📈 Ainda não tenho histórico suficiente de <b>${nomeDe(a,90)}</b>. O gráfico aparece a partir do 2º dia de acompanhamento.`,
    markup:{inline_keyboard:[[{text:'⚙️ Ajustar alerta',callback_data:`a:${a.id}:c`}]]}};
  const dia=n=>data(n*86400+43200);
  const ano=dias>=365?pontos:await diarios(env,a.produto_id,now-365*86400);
  const selo=termometro(desenho.atual,ano.map(p=>Number(p.preco)));
  const periodo=PERIODOS_GRAFICO.find(([d])=>d===dias)[1];
  const desde=desenho.inicio*86400>now-(dias-2)*86400?` (acompanhado desde ${dia(desenho.inicio)})`:'';
  const legenda=[`📈 <b>${nomeDe(a,120)}</b>`,`Últimos ${periodo}${desde}`,'',
    `💰 Último preço: <b>${html(money(desenho.atual))}</b>`,
    `🟢 Menor: ${html(money(desenho.minimo))} em ${dia(desenho.diaMenor)}`,
    ...(desenho.diaMaior!==null?[`🔴 Maior: ${html(money(desenho.maximo))} em ${dia(desenho.diaMaior)}`]:[]),
    ...(selo?['',`${selo.emoji} ${selo.texto}`]:[])];
  const botoes=PERIODOS_GRAFICO.map(([d,t])=>d===dias?{text:`• ${t} •`,callback_data:'-'}:{text:t,callback_data:`a:${a.id}:gt:${d}`});
  return {answer:`Gráfico de ${periodo}`,edit,photo:{png:desenho.png,caption:legenda.join('\n')},
    markup:{inline_keyboard:[botoes,[{text:'⚙️ Ajustar alerta',callback_data:`a:${a.id}:c`}]]}};
}

// --- Botões dentro das mensagens (callback_query) -----------------------------------

// Devolve {answer, text?, markup?, edit?}: answer é o aviso rápido do toque;
// edit troca a própria mensagem (cartão) em vez de mandar outra.
export async function handleCallback(env,chatId,dados,now=Math.floor(Date.now()/1000)) {
  const texto=String(dados||'');
  if(texto==='l'){
    const alertas=await listPriceAlerts(env,chatId,now);
    if(!alertas.length) return {answer:'Nenhum alerta',text:'Você não tem alertas de produto. Toque em ➕ Novo alerta.'};
    return {answer:'Seus alertas',text:`<b>Seus alertas de produto</b>\n\n${formatPriceAlertList(alertas)}\n\nToque em um para ver e ajustar.`,
      markup:String(chatId).startsWith('-')?listaComBotoes(alertas):listaComBotoes(alertas,await resumoLigado(env,chatId))};
  }
  const resumo=texto.match(/^rs:([01])$/);
  if(resumo){
    const ligar=Number(resumo[1]);
    await env.DB.prepare(`INSERT INTO alerta_pessoas(chat_id,resumo_semanal) VALUES(?,?)
      ON CONFLICT(chat_id) DO UPDATE SET resumo_semanal=excluded.resumo_semanal`).bind(chatId,ligar).run();
    return {answer:ligar?'Resumo semanal ligado':'Resumo semanal desligado',
      text:ligar?'🔔 Resumo semanal ligado: toda segunda, por volta das 10h, mando como estão os seus produtos.'
        :'🔕 Resumo semanal desligado. Os avisos de preço continuam normalmente.',
      markup:{inline_keyboard:[[{text:ligar?'🔕 Desligar resumo':'🔔 Ligar resumo',callback_data:`rs:${ligar?0:1}`},{text:'📋 Meus alertas',callback_data:'l'}]]}};
  }
  if(texto==='ex') return {answer:'Exemplo',text:exemploDeAviso(),markup:null};
  if(texto==='cv') return {answer:'Seu convite',...await mensagemConvite(env,chatId)};
  if(texto==='-') return {answer:'Este período já está aberto'};
  const achado=texto.match(/^a:(\d{1,12}):([a-z]{1,2})(?::(\d{1,4}))?$/);
  if(!achado) return {answer:'Opção inválida'};
  const [,id,acao,arg]=achado;
  const a=await lerAlerta(env,chatId,id);
  if(!a) return {answer:'Esse alerta não existe mais',text:'Esse alerta não existe mais. Veja os seus em 📋 Meus alertas.'};
  const atualizar=async(sql,...valores)=>env.DB.prepare(`UPDATE alerta_precos SET ${sql} WHERE id=? AND chat_id=?`).bind(...valores,a.id,chatId).run();
  const editar=async(answer,titulo='')=>({answer,edit:true,...await cartao(env,chatId,a.id,now,titulo)});
  switch(acao){
    case 'c': return {answer:'Alerta',...await cartao(env,chatId,a.id,now)};
    case 'g': return grafico(env,a,90,now,false);
    case 'gt': return grafico(env,a,PERIODOS_GRAFICO.some(([d])=>d===Number(arg))?Number(arg):90,now,true);
    case 'm':
      await atualizar('avisar_menor=?,ativo=1',a.avisar_menor?0:1);
      return editar(a.avisar_menor?'Menor preço desligado':'Menor preço ligado');
    case 'e':
      await atualizar('avisar_estoque=?,ativo=1',a.avisar_estoque?0:1);
      return editar(a.avisar_estoque?'Estoque desligado':'Vou avisar quando voltar ao estoque');
    case 'v':
      await atualizar('editando_em=?',now);
      return {answer:'Mande o valor',text:`Quanto você quer pagar por <b>${nomeDe(a,90)}</b>?\nMande só o valor, por exemplo: <code>599,90</code>`,
        markup:a.preco_alvo?{inline_keyboard:[[{text:'Tirar o valor',callback_data:`a:${a.id}:vr`}]]}:null};
    case 'vr': return {answer:'Valor removido',...await definirValor(env,chatId,a.id,null,now)};
    case 'q':
      if(arg!==undefined){
        const percentual=Number(arg);
        if(percentual===0) await atualizar('queda_percent=NULL');
        else if(QUEDAS.includes(percentual)){
          const base=a.preco_base||(await historico(env,a.produto_id,now)).atual||null;
          await atualizar('queda_percent=?,preco_base=?,ativo=1',percentual,base);
        }
        return editar(percentual?`Aviso de queda de ${percentual}%`:'Aviso de queda desligado');
      }
      return {answer:'Escolha a queda',edit:true,text:`📉 Avisar quando <b>${nomeDe(a,90)}</b> cair quanto, a partir do preço de agora?`,
        markup:{inline_keyboard:[QUEDAS.map(p=>({text:`${p}%`,callback_data:`a:${a.id}:q:${p}`})),
          [{text:'Desligar',callback_data:`a:${a.id}:q:0`},{text:'↩️ Voltar',callback_data:`a:${a.id}:c`}]]}};
    case 'p':
      if(arg!==undefined&&PRAZOS.some(([d])=>d===Number(arg))){
        await atualizar('expira_em=?,ativo=1,lembrete_em=NULL',now+Number(arg)*86400);
        return editar(`Prazo: ${prazoTexto(Number(arg))}`);
      }
      return {answer:'Escolha o prazo',edit:true,text:`⏳ Por quanto tempo acompanhar <b>${nomeDe(a,90)}</b>? (a partir de hoje)`,
        markup:{inline_keyboard:[PRAZOS.slice(0,2).map(([d,t])=>({text:t,callback_data:`a:${a.id}:p:${d}`})),
          PRAZOS.slice(2).map(([d,t])=>({text:t,callback_data:`a:${a.id}:p:${d}`})),
          [{text:'↩️ Voltar',callback_data:`a:${a.id}:c`}]]}};
    case 'r':
      await atualizar('expira_em=?,ativo=1,lembrete_em=NULL',now+365*86400);
      return {answer:'Renovado por 1 ano',...await cartao(env,chatId,a.id,now,'🔁 Alerta renovado por mais 1 ano.')};
    case 'f':{
      const referencia=a.ultimo_aviso_preco||a.preco_alvo;
      if(!referencia) return {answer:'Ainda não houve aviso'};
      const novo=Math.round(referencia*0.95*100)/100;
      await atualizar('preco_alvo=?,ativo=1,ultimo_aviso_em=NULL',novo);
      return {answer:'Combinado',...await cartao(env,chatId,a.id,now,`🔁 Aviso de novo se cair para <b>${html(money(novo))}</b> ou menos (5% abaixo).`)};
    }
    case 's':
      await atualizar('ativo=0');
      return {answer:'Alerta pausado',text:`⏸ Pausei o alerta de <b>${nomeDe(a,90)}</b>.`,
        markup:{inline_keyboard:[[{text:'▶️ Reativar por 1 ano',callback_data:`a:${a.id}:r`}]]}};
    case 'x':
      return {answer:'Confirme',edit:true,text:`🗑 Apagar o alerta de <b>${nomeDe(a,90)}</b>?`,
        markup:{inline_keyboard:[[{text:'Sim, apagar',callback_data:`a:${a.id}:xx`},{text:'Não',callback_data:`a:${a.id}:c`}]]}};
    case 'xx':
      await env.DB.prepare('DELETE FROM alerta_precos WHERE id=? AND chat_id=?').bind(a.id,chatId).run();
      return {answer:'Alerta apagado',edit:true,text:`🗑 Alerta apagado: ${nomeDe(a,90)}`,markup:{inline_keyboard:[[{text:'📋 Meus alertas',callback_data:'l'}]]}};
    default: return {answer:'Opção inválida'};
  }
}

export function exemploDeAviso() {
  return [
    '🧪 <b>Exemplo de aviso</b> (assim chega quando o preço baixar):','',
    '🔔 <b>Bateu o preço que você pediu!</b>','',
    '<b>Fone de Ouvido Bluetooth</b>',
    '💰 <b>R$ 189,90</b> (você pediu até R$ 199,90)',
    '📉 Caiu 24% desde que você criou o alerta',
    '📈 30 dias: ▇▇▆▆▇▅▅▄▃▂▁',
    '🟢 Preço baixo: mais barato que em 92% dos últimos 120 dias','',
    'Para criar o seu, cole o link de um produto do Mercado Livre, da Shopee ou do AliExpress.',
  ].join('\n');
}

// --- Avisos decididos pela coleta ---------------------------------------------------

function tituloAviso(aviso,alerta) {
  switch(aviso.motivo){
    case 'alvo': return '🔔 <b>Bateu o preço que você pediu!</b>';
    case 'queda': return `📉 <b>Caiu ${Math.round(alerta.queda_percent||0)}% ou mais!</b>`;
    case 'estoque': return '📦 <b>Voltou ao estoque!</b>';
    case 'menor_preco': return `🔥 <b>Menor preço em ${Number(aviso.dias_janela)||90} dias!</b>`;
    default: return '🔥 <b>Preço bem abaixo da média!</b>';
  }
}

// Shopee com variações (cor, tamanho): o alerta segue a mais barata.
export function precoComVariacoes(preco,maximo) {
  const base=`<b>${html(money(preco))}</b>`;
  return Number(maximo)>Number(preco)*1.005?`a partir de ${base} (as opções vão até ${html(money(maximo))})`:base;
}

// Cupom do produto (AliExpress), guardado na última leitura; some quando vence.
export function linhaCupom(p,now=Math.floor(Date.now()/1000)) {
  const codigo=String(p?.cupom_codigo||'');
  if(!/^[A-Za-z0-9_-]{2,40}$/.test(codigo)) return '';
  const expira=Number(p.cupom_expira_em)||0;
  if(expira&&expira<=now) return '';
  const condicao=p.cupom_condicao?`: ${html(String(p.cupom_condicao).slice(0,120))}`:'';
  return `🎟 Cupom <code>${codigo}</code>${condicao}${expira?` · até ${html(data(expira).slice(0,5))}`:''}`;
}

// Voucher geral da loja (campanhas oficiais na tabela coupons), se houver um válido.
const FONTE_CUPOM={shopee:'Shopee',aliexpress:'AliExpress',mercadolivre:'Mercado Livre'};
export async function voucherDaLoja(env,loja,now) {
  if(!FONTE_CUPOM[loja]) return null;
  try{
    const v=await env.DB.prepare(
      `SELECT title,code,destination FROM coupons WHERE source=? AND (active_at IS NULL OR active_at<=?)
       AND (expires_at IS NULL OR expires_at>?) ORDER BY published_at DESC LIMIT 1`,
    ).bind(FONTE_CUPOM[loja],now,now).first();
    const destino=urlPermitida(v?.destination,[...HOSTS_LINK,'s.shopee.com.br']);
    return v&&destino?{titulo:String(v.title||v.code||'Voucher').slice(0,80),destino}:null;
  }catch{ return null; }
}

export function formatPriceNotice(aviso,alerta={},extra={}) {
  const preco=Number(aviso.preco);
  const linhas=[tituloAviso(aviso,alerta),'',`<b>${html(String(aviso.nome||alerta.nome||'Produto').slice(0,160))}</b>`];
  let detalhe='';
  if(aviso.motivo==='alvo'&&alerta.preco_alvo) detalhe=` (você pediu até ${html(money(alerta.preco_alvo))})`;
  else if(aviso.media>0) detalhe=` (média ${Number(aviso.dias_media)||30} dias: ${html(money(aviso.media))})`;
  linhas.push(`💰 ${precoComVariacoes(preco,alerta.preco_max)}${detalhe}`);
  const cupom=linhaCupom(alerta,extra.now);
  if(cupom) linhas.push(cupom);
  else if(extra.voucher) linhas.push(`🎟 Voucher da ${html(FONTE_CUPOM[alerta.loja]||'loja')} ativo: <a href="${html(extra.voucher.destino)}">${html(extra.voucher.titulo)}</a>`);
  if(extra.outraLoja) linhas.push(extra.outraLoja.linha);
  if(alerta.preco_base>preco) linhas.push(`📉 Caiu ${Math.round((1-preco/alerta.preco_base)*100)}% desde ${html(money(alerta.preco_base))}`);
  else if(Number(aviso.abaixo)>=1) linhas.push(`📉 ${Math.round(Number(aviso.abaixo))}% abaixo da média`);
  if(extra.minimo) linhas.push(`📊 Menor já visto: ${html(money(extra.minimo))} · maior: ${html(money(extra.maximo))}`);
  if(extra.linha) linhas.push(`📈 30 dias: ${extra.linha}`);
  const selo=extra.valores?termometro(preco,extra.valores):null;
  if(selo) linhas.push(`${selo.emoji} ${selo.texto}`);
  linhas.push('');
  if(extra.pausado) linhas.push('Este alerta foi pausado. Toque em 🔁 se quiser outro aviso.');
  linhas.push('<i>Preço pode mudar a qualquer momento. Link de afiliado.</i>');
  return linhas.join('\n');
}

function estadoDepoisDoAviso(motivo,alerta,preco) {
  if(motivo==='alvo'){
    const outros=alerta.avisar_menor||alerta.queda_percent||alerta.avisar_estoque;
    return {sql:'preco_alvo=NULL,ativo=?',valores:[outros?1:0],pausado:!outros};
  }
  if(motivo==='queda') return {sql:'preco_base=?',valores:[preco],pausado:false};
  return {sql:'ativo=1',valores:[],pausado:false};
}

// Entrega os avisos decididos pela coleta. Confere de novo se o alerta ainda
// existe (a pessoa pode ter apagado entre a leitura e o aviso).
export async function deliverPriceAlerts(env,avisos,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  if(!env.TELEGRAM_ALERTS_BOT_TOKEN) return 0;
  let enviados=0, buscasNovas=0;  // até 5 comparações novas por coleta; o resto usa o que estiver guardado
  for(const aviso of (Array.isArray(avisos)?avisos:[]).slice(0,500)){
    const alertaId=Number(aviso?.alerta_id), preco=Number(aviso?.preco);
    const link=urlPermitida(aviso?.link);
    if(!Number.isInteger(alertaId)||!(preco>0)||!link||!MOTIVOS.has(aviso?.motivo)) continue;
    const alerta=await env.DB.prepare(
      `SELECT a.*,p.nome,p.imagem,p.loja,p.preco_max,p.cupom_codigo,p.cupom_condicao,p.cupom_expira_em,p.comparacao,p.comparado_em FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
       WHERE a.id=? AND a.produto_id=? AND a.ativo=1 AND a.expira_em>?`,
    ).bind(alertaId,Number(aviso.produto_id),now).first();
    if(!alerta) continue;
    if(aviso.motivo==='alvo'&&(!alerta.preco_alvo||preco>alerta.preco_alvo)) continue;
    const estado=estadoDepoisDoAviso(aviso.motivo,alerta,preco);
    const extra={...await historico(env,alerta.produto_id,now),pausado:estado.pausado,now,
      voucher:alerta.cupom_codigo?null:await voucherDaLoja(env,alerta.loja,now),
      outraLoja:alerta.nome?sugestaoMaisBarata(await comparacao(env,alerta,preco,now,fetch,
        Number(alerta.comparado_em)>now-VALIDADE_COMPARACAO||buscasNovas++<5),preco):null};
    const teclado={inline_keyboard:[
      [{text:'🛒 Comprar',url:link},{text:'📈 Gráfico',callback_data:`a:${alertaId}:g`}],
      ...(extra.outraLoja?[[extra.outraLoja.botao]]:[]),
      [{text:'🔁 Avisar se cair mais',callback_data:`a:${alertaId}:f`},{text:'⚙️ Ajustar',callback_data:`a:${alertaId}:c`}],
      [{text:'✋ Parar este alerta',callback_data:`a:${alertaId}:s`}],
    ]};
    const texto=formatPriceNotice({...aviso,preco},alerta,extra);
    const imagem=urlPermitida(alerta.imagem,HOSTS_IMAGEM);
    try{
      let status=imagem&&texto.length<=1000
        ?await telegram(env,'sendPhoto',{chat_id:alerta.chat_id,photo:imagem,caption:texto,parse_mode:'HTML',
          reply_markup:teclado,disable_notification:silencioso(now)},fetcher)
        :0;
      if(status!==403&&!(status>=200&&status<300)){
        status=await telegram(env,'sendMessage',{chat_id:alerta.chat_id,text:texto,parse_mode:'HTML',reply_markup:teclado,
          disable_web_page_preview:true,disable_notification:silencioso(now)},fetcher);
      }
      if(status===403){
        await apagarPessoa(env,alerta.chat_id);  // a pessoa bloqueou o bot
      }else if(status>=200&&status<300){
        await env.DB.batch([
          env.DB.prepare(`UPDATE alerta_precos SET ultimo_aviso_em=?,ultimo_aviso_preco=?${estado.sql?`,${estado.sql}`:''} WHERE id=?`)
            .bind(now,preco,...estado.valores,alertaId),
          env.DB.prepare('INSERT INTO alerta_avisos(alerta_id,chat_id,produto_id,motivo,preco,enviado_em) VALUES(?,?,?,?,?,?)')
            .bind(alertaId,alerta.chat_id,alerta.produto_id,aviso.motivo,preco,now),
        ]);
        enviados++;
      }
    }catch(error){
      console.error(JSON.stringify({event:'price_alert',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  return enviados;
}

// Lembra 7 dias antes de vencer e, ao vencer, pausa o alerta (liberando a vaga).
export async function expirePriceAlerts(env,now=Math.floor(Date.now()/1000),fetcher=fetch) {
  const {results:vencendo=[]}=await env.DB.prepare(
    `SELECT a.id,a.chat_id,a.expira_em,p.nome,p.id_produto FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE a.ativo=1 AND a.lembrete_em IS NULL AND a.expira_em>? AND a.expira_em<=? LIMIT 50`,
  ).bind(now,now+7*86400).all();
  for(const alerta of vencendo){
    await env.DB.prepare('UPDATE alerta_precos SET lembrete_em=? WHERE id=?').bind(now,alerta.id).run();
    if(!env.TELEGRAM_ALERTS_BOT_TOKEN) continue;
    try{
      await telegram(env,'sendMessage',{chat_id:alerta.chat_id,parse_mode:'HTML',
        text:`⏳ Seu alerta de <b>${nomeDe(alerta,100)}</b> vence em ${data(alerta.expira_em)}.`,
        reply_markup:{inline_keyboard:[[{text:'🔁 Renovar por 1 ano',callback_data:`a:${alerta.id}:r`}]]}},fetcher);
    }catch{ /* lembrete é cortesia */ }
  }
  const {results=[]}=await env.DB.prepare(
    `SELECT a.id,a.chat_id,p.nome,p.id_produto FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id
     WHERE a.ativo=1 AND a.expira_em<=? LIMIT 50`,
  ).bind(now).all();
  for(const alerta of results){
    await env.DB.prepare('UPDATE alerta_precos SET ativo=0 WHERE id=?').bind(alerta.id).run();
    if(!env.TELEGRAM_ALERTS_BOT_TOKEN) continue;
    try{
      await telegram(env,'sendMessage',{chat_id:alerta.chat_id,parse_mode:'HTML',
        text:`⌛ Seu alerta de <b>${nomeDe(alerta,100)}</b> venceu.`,
        reply_markup:{inline_keyboard:[[{text:'▶️ Reativar por 1 ano',callback_data:`a:${alerta.id}:r`}]]}},fetcher);
    }catch{ /* o alerta já foi pausado; o aviso é só cortesia */ }
  }
  return results.length;
}
