import {label,shorten,slugify} from './_site.js';
import {extractProductSpecs,SPEC_LABELS} from './_product_specs.js';

const TYPES=[
  {name:'power-bank',terms:['power bank','carregador portátil'],exclude:['capa','case','bolsa','suporte','cabo para']},
  {name:'fone de ouvido',terms:['fone','headphone','headset','earbud'],exclude:['capa','case','estojo','almofada','espuma','suporte para','cabo para']},
  {name:'smartphone',terms:['smartphone','celular'],exclude:['capa','capinha','pelicula','suporte','carregador','cabo','bolsa']},
  {name:'smartwatch',terms:['smartwatch','relógio inteligente'],exclude:['pulseira','capa','case','pelicula','carregador','suporte']},
  {name:'notebook',terms:['notebook','laptop'],exclude:['capa','case','bolsa','mochila','suporte','mesa','base','carregador','teclado']},
  {name:'tablet',terms:['tablet'],exclude:['capa','case','pelicula','suporte','teclado para','caneta para']},
  {name:'televisor',terms:['smart tv','televisor',' tv '],exclude:['suporte','painel','rack','controle','capa','antena']},
  {name:'caixa de som',terms:['caixa de som','speaker'],exclude:['capa','case','suporte','bolsa']},
  {name:'aspirador',terms:['aspirador'],exclude:['filtro','bico','mangueira','saco para','peça','peca']},
  {name:'air fryer',terms:['air fryer','fritadeira elétrica','fritadeira eletrica'],exclude:['forma','papel','forro','cesto','acessorio']},
  {name:'cafeteira',terms:['cafeteira'],exclude:['filtro','capsula','jarra','capa','suporte']},
  {name:'ventilador',terms:['ventilador'],exclude:['capa','hélice','helice','motor','grade','peça','peca']},
  {name:'parafusadeira',terms:['parafusadeira'],exclude:['broca','bit','bateria para','carregador','maleta']},
  {name:'furadeira',terms:['furadeira'],exclude:['broca','bateria para','carregador','maleta','suporte']},
  {name:'panela',terms:['panela'],exclude:['tampa','organizador','suporte','protetor']},
  {name:'tênis',terms:['tênis','tenis'],exclude:['sapateira','arara','cabideiro','porta tenis','organizador de tenis','caixa para tenis','cadarco','cadarço','palmilha para tenis','meia para tenis','limpador de tenis','forma para tenis','saco para tenis','bolsa para tenis','suporte para tenis']},
  {name:'creatina',terms:['creatina'],exclude:['coqueteleira','porta suplemento','kit sem creatina']},
  {name:'whey protein',terms:['whey'],exclude:['coqueteleira','porta suplemento','kit sem whey']},
];

const TYPE_GUIDES={
  'power-bank':['Capacidade em mAh e rendimento real','Potência e protocolos de carga','Portas, peso e proteções elétricas'],
  'fone de ouvido':['Formato e conforto','Codec, Bluetooth e cancelamento de ruído','Autonomia e resistência à água'],
  smartphone:['Processador e memória','Tela, câmeras e bateria','Atualizações, 5G e garantia'],smartwatch:['Compatibilidade com o celular','Sensores e GPS','Autonomia e resistência à água'],
  notebook:['Processador, RAM e armazenamento','Tela, bateria e peso','Portas, possibilidade de upgrade e garantia'],tablet:['Tela e desempenho','Armazenamento e acessórios compatíveis','Bateria e política de atualizações'],
  televisor:['Tamanho e distância de uso','Tipo de painel, resolução e frequência','Sistema, conexões e garantia'],'caixa de som':['Potência e qualidade sonora','Autonomia e conectividade','Resistência e portabilidade'],
  aspirador:['Potência de sucção','Capacidade, filtros e acessórios','Autonomia ou comprimento do cabo'],'air fryer':['Capacidade útil','Potência e faixa de temperatura','Facilidade de limpeza e segurança'],
  cafeteira:['Tipo de café e pressão','Capacidade e custo dos insumos','Limpeza e assistência'],ventilador:['Vazão, ruído e velocidades','Diâmetro e alcance','Consumo e segurança'],
  parafusadeira:['Torque e controle de velocidade','Bateria, voltagem e mandril','Acessórios e assistência'],furadeira:['Potência, impacto e rotação','Mandril e materiais suportados','Ergonomia e acessórios'],
  panela:['Material e revestimento','Capacidade e compatibilidade com fogão','Tampa, cabos e facilidade de limpeza'],'tênis':['Finalidade do calçado','Cabedal, ajuste e respirabilidade','Entressola, solado e durabilidade'],
  creatina:['Quantidade por dose e pureza','Laudos, procedência e registro','Preço por porção'],'whey protein':['Proteína por dose','Tipo de whey e ingredientes','Preço por grama de proteína'],
};

const fold=value=>` ${String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ')} `;
const clean=value=>String(value||'').replace(/[\r\n]+/g,' ').replace(/[\\*_{}\[\]#]/g,'').replace(/\s+/g,' ').trim();
export function brazilDateKey(date=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function comparisonType(title='') {
  const text=fold(title);
  for(const rule of TYPES)if(rule.terms.some(term=>text.includes(fold(term)))&&!rule.exclude.some(term=>text.includes(fold(term))))return rule.name;
  return null;
}

function score(offer) {
  const technicalFields=Object.keys(extractProductSpecs(offer.title)).length;
  return technicalFields*20+Math.max(0,Number(offer.rating)||0);
}

export function selectComparableOffers(candidates=[],size=3) {
  const groups=new Map();
  for(const offer of candidates){
    const type=comparisonType(offer.title);if(!type)continue;
    const group=groups.get(type)||[];
    if(!group.some(item=>fold(item.title)===fold(offer.title)))group.push(offer);
    groups.set(type,group);
  }
  return [...groups.entries()].filter(([,offers])=>offers.length>=size)
    .map(([type,offers])=>({type,offers:offers.sort((a,b)=>score(b)-score(a)).slice(0,size),freshness:Math.max(...offers.map(item=>Number(item.last_checked_at||item.published_at)||0))}))
    .sort((a,b)=>b.freshness-a.freshness)[0]||null;
}

function facts(offer) {
  const entries=Object.entries(extractProductSpecs(offer.title));
  const pros=entries.slice(0,3).map(([key,value])=>`A descrição informa ${SPEC_LABELS[key].toLowerCase()}: ${clean(value)}.`);
  if(!pros.length)pros.push('O produto está identificado por categoria, mas a descrição resumida traz poucos dados técnicos.');
  const attention=[];
  if(entries.length<2)attention.push('A ficha disponível no catálogo não detalha características suficientes para avaliar o produto por completo.');
  attention.push('Materiais, compatibilidade, medidas e garantia devem ser confirmados com a loja ou o fabricante.');
  return {pros,attention};
}

function technicalAnalysis(offer) {
  const specs=extractProductSpecs(offer.title),entries=Object.entries(specs);
  if(!entries.length)return '- O título não informa especificações técnicas suficientes para uma comparação segura. Confirme ficha técnica, materiais, medidas, compatibilidade e garantia no anúncio.';
  return entries.map(([key,value])=>`- **${SPEC_LABELS[key]}:** ${clean(value)}.`).join('\n')+"\n- As características acima foram extraídas do título do anúncio e ainda devem ser confirmadas na página da loja.";
}

function buyingGuide(type) {
  const factors=TYPE_GUIDES[type]||['Especificações adequadas ao uso','Compatibilidade, dimensões e materiais','Garantia, procedência e custo total'];
  return factors.map(item=>`- **${item}:** compare este ponto entre os anúncios e confirme a informação na ficha do fabricante.`).join('\n');
}

function recommendationReason(offer) {
  const labels=Object.keys(extractProductSpecs(offer.title)).map(key=>SPEC_LABELS[key]).slice(0,3);
  return labels.length?`sua descrição informa ${labels.join(', ').toLowerCase()}`:'é o produto mais bem documentado entre os dados disponíveis';
}

export function buildComparisonDraft(type,offers,date=new Date()) {
  if(!type||!Array.isArray(offers)||offers.length<3)throw new Error('not_enough_offers');
  const day=brazilDateKey(date),winner=[...offers].sort((a,b)=>score(b)-score(a))[0];
  const plurals={'power-bank':'power banks','fone de ouvido':'fones de ouvido',smartphone:'smartphones',smartwatch:'smartwatches',notebook:'notebooks',tablet:'tablets',televisor:'televisores','caixa de som':'caixas de som',aspirador:'aspiradores','air fryer':'air fryers',cafeteira:'cafeteiras',ventilador:'ventiladores',parafusadeira:'parafusadeiras',furadeira:'furadeiras',panela:'panelas','tênis':'tênis',creatina:'creatinas','whey protein':'whey proteins'};
  const typeLabel=plurals[type]||type;
  const title=`Comparativo de 3 ${typeLabel}: diferenças e qual escolher`;
  const sections=offers.map((offer,index)=>{
    const {pros,attention}=facts(offer);
    return `## ${index+1}. ${shorten(clean(offer.title),120)}\n\nA análise deste produto considera sua proposta de uso e as características técnicas disponíveis no catálogo.\n\n### Análise das especificações técnicas\n\n${technicalAnalysis(offer)}\n\n### Pontos fortes informados\n\n${pros.map(item=>`- ${item}`).join('\n')}\n\n### Limitações da ficha\n\n${attention.map(item=>`- ${item}`).join('\n')}\n\n{{offer:${offer.id}}}`;
  }).join('\n\n');
  const reason=recommendationReason(winner);
  const category=label(offers[0].category||'outros');
  const excerpt=`Comparamos três ${typeLabel} pelas características técnicas, diferenças de uso, pontos fortes e limitações.`;
  const body=`Este comparativo analisa os produtos de forma geral, usando as características disponíveis no catálogo. Não realizamos teste físico; informações incompletas são sinalizadas no texto.\n\n## Resumo rápido\n\n- **Produto com ficha mais completa:** ${shorten(clean(winner.title),110)}.\n- **Critério principal:** características técnicas e adequação ao uso.\n- **Importante:** confirme a ficha completa com a loja ou o fabricante.\n\n## Como escolher ${typeLabel}\n\n${buyingGuide(type)}\n\n${sections}\n\n## Qual produto se destaca?\n\nPelos dados disponíveis, **${shorten(clean(winner.title),110)}** é o produto mais bem documentado porque ${reason}. Isso não comprova desempenho superior: a escolha final depende do perfil de uso e da confirmação da ficha técnica completa.\n\n## Tabela comparativa\n\n{{comparison-table}}\n\n## Como fizemos este comparativo\n\nSelecionamos produtos da mesma categoria, eliminamos acessórios conhecidos e organizamos as características técnicas disponíveis no catálogo. O destaque editorial considera a ficha e a adequação ao uso. Não há teste físico, e descrições comerciais não são tratadas como certificação independente.\n\n## Perguntas frequentes\n\n### O produto com mais especificações é necessariamente melhor?\n\nNão. Ele apenas permite uma análise mais completa. Desempenho, durabilidade e qualidade exigem documentação confiável ou testes independentes.\n\n### As especificações foram testadas pelo Tá Barato?\n\nNão. Elas são organizadas a partir do catálogo e precisam ser confirmadas com a loja ou o fabricante.\n\n### Como escolher entre os modelos?\n\nDefina primeiro o uso principal e compare as características que realmente interferem nesse uso, além de compatibilidade, garantia e assistência.`;
  return {id:`auto-comparativo-${day}`,slug:slugify(`${typeLabel}-comparativo-produtos-${day}`),title,excerpt,body_markdown:body,cover_image_url:offers[0].image_url,category:`Comparativo · ${category}`,status:'draft',meta_title:shorten(title,70),meta_description:shorten(excerpt,170),offer_ids:offers.map(item=>item.id)};
}

export async function generateDailyDraft(env,now=Math.floor(Date.now()/1000)) {
  const day=brazilDateKey(new Date(now*1000)),id=`auto-comparativo-${day}`;
  const existing=await env.DB.prepare('SELECT id,slug,title,status FROM blog_posts WHERE id=?').bind(id).first();
  if(existing)return {created:false,reason:'already_exists',post:existing};
  const result=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,o.published_at,o.last_checked_at
    FROM offers o WHERE o.availability!='unavailable' AND o.price>0 AND o.image_url LIKE 'https://%'
    AND COALESCE(o.last_checked_at,o.published_at)>=? AND NOT EXISTS (
      SELECT 1 FROM blog_post_offers b JOIN blog_posts p ON p.id=b.post_id
      WHERE b.offer_id=o.id AND p.created_at>=?
    ) ORDER BY COALESCE(o.last_checked_at,o.published_at) DESC LIMIT 240`).bind(now-7*86400,now-30*86400).all();
  const selected=selectComparableOffers(result.results||[]);
  if(!selected)return {created:false,reason:'no_comparable_offers'};
  const draft=buildComparisonDraft(selected.type,selected.offers,new Date(now*1000));
  const statements=[env.DB.prepare(`INSERT INTO blog_posts(id,slug,title,excerpt,body_markdown,cover_image_url,category,status,meta_title,meta_description,published_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(draft.id,draft.slug,draft.title,draft.excerpt,draft.body_markdown,draft.cover_image_url,draft.category,'draft',draft.meta_title,draft.meta_description,null,now,now),...draft.offer_ids.map((offerId,index)=>env.DB.prepare('INSERT INTO blog_post_offers(post_id,offer_id,position) VALUES(?,?,?)').bind(draft.id,offerId,index))];
  try{await env.DB.batch(statements);}catch(error){
    if(String(error?.message||'').toLowerCase().includes('unique'))return {created:false,reason:'already_exists'};
    throw error;
  }
  return {created:true,post:{id:draft.id,slug:draft.slug,title:draft.title,status:'draft',offer_ids:draft.offer_ids}};
}
