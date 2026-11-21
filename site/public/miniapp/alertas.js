// Mini app "Meus alertas" (Tá Barato). Tudo vem da API com o initData do
// Telegram; o texto entra sempre por textContent (nada de HTML vindo de dados).
(function(){
  'use strict';
  const tg=window.Telegram&&window.Telegram.WebApp;
  const app=document.getElementById('app');
  const initData=tg&&tg.initData||'';
  const PERIODOS=[[30,'30 dias'],[90,'90 dias'],[365,'1 ano']];
  const QUEDAS=[[0,'Desligado'],[10,'10%'],[20,'20%'],[30,'30%']];
  const PRAZOS=[[30,'1 mês'],[90,'3 meses'],[180,'6 meses'],[365,'1 ano']];
  let graficoUrl=null;

  const moeda=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const data=s=>new Date(s*1000).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});

  function el(tag,props,...filhos){
    const n=document.createElement(tag);
    for(const [k,v] of Object.entries(props||{})){
      if(k==='class') n.className=v;
      else if(k==='texto') n.textContent=v;
      else if(k.startsWith('on')) n.addEventListener(k.slice(2),v);
      else if(v!==null&&v!==undefined&&v!==false) n.setAttribute(k,v===true?'':v);
    }
    for(const f of filhos.flat()) if(f!==null&&f!==undefined&&f!==false) n.append(f instanceof Node?f:document.createTextNode(String(f)));
    return n;
  }
  const tela=(...filhos)=>{app.replaceChildren(...filhos.flat().filter(Boolean));window.scrollTo(0,0);};
  const aviso=(msg,classe='vazio')=>tela(el('p',{class:classe,texto:msg}));
  const vibrar=()=>{try{tg.HapticFeedback.selectionChanged();}catch(e){}};

  async function api(caminho,opcoes){
    const r=await fetch(caminho,{...opcoes,headers:{'X-Telegram-Init-Data':initData,'Content-Type':'application/json',...((opcoes||{}).headers||{})}});
    if(r.status===401) throw new Error('login');
    return r;
  }

  function nome(a){return a.nome||`Produto ${a.lojaNome} (o nome chega na 1ª leitura)`;}
  function chips(av){
    const lista=[];
    if(av.menor) lista.push('Menor preço');
    if(av.valor) lista.push(`Até ${moeda(av.valor)}`);
    if(av.queda) lista.push(`Queda ${Math.round(av.queda)}%`);
    if(av.estoque) lista.push('Estoque');
    return el('div',{class:'chips'},(lista.length?lista:['Nenhum aviso ligado']).map(t=>el('span',{class:'chip',texto:t})));
  }

  // Quanto falta para o valor pedido (ou se já chegou).
  function falta(a){
    if(!a.avisos.valor||!a.atual) return null;
    const d=a.atual-a.avisos.valor;
    return d<=0?el('div',{class:'selo ok',texto:'✅ Já está no valor que você pediu'})
      :el('div',{class:'selo',texto:`🎯 Faltam ${moeda(d)} para ${moeda(a.avisos.valor)}`});
  }
  // Mais perto do valor pedido primeiro; quem não tem valor vem depois, na ordem de sempre.
  const proximidade=a=>a.avisos.valor&&a.atual?a.atual/a.avisos.valor:Infinity;

  function formNovo(){
    const campo=el('input',{class:'link',type:'url',inputmode:'url',placeholder:'Cole o link do produto',autocomplete:'off'});
    const botao=el('button',{class:'botao',type:'button',texto:'Criar alerta'});
    botao.addEventListener('click',async()=>{
      const link=campo.value.trim();
      if(!/^https?:\/\//i.test(link)){tg&&tg.showAlert('Cole o link do produto do Mercado Livre, da Shopee ou do AliExpress.');return;}
      botao.disabled=true;botao.textContent='Criando…';
      try{
        const r=await api('/api/app/alertas',{method:'POST',body:JSON.stringify({acao:'adicionar',link})});
        const corpo=await r.json();
        tg?tg.showAlert(corpo.mensagem||(r.ok?'Alerta criado!':'Não deu certo. Tente de novo.')):null;
        if(r.ok) return mostrarLista();
      }catch(e){tg&&tg.showAlert('Não deu certo. Tente de novo.');}
      botao.disabled=false;botao.textContent='Criar alerta';
    });
    return el('div',{class:'cartao'},el('h2',{texto:'➕ Novo alerta'}),
      el('small',{class:'loja',texto:'Mercado Livre, Shopee ou AliExpress'}),
      el('div',{class:'botoes'},campo),el('div',{class:'botoes'},botao));
  }

  async function mostrarLista(){
    if(tg){tg.BackButton.hide();}
    aviso('Carregando…','carregando');
    let dados;
    try{ dados=await (await api('/api/app/alertas')).json(); }
    catch(e){ return aviso(e.message==='login'?'Abra este painel pelo bot @TaBaratoAlertaDePrecoBot.':'Não consegui carregar agora. Tente de novo.','erro'); }
    const ordenados=(dados.alertas||[]).map((a,i)=>[a,i]).sort(([a,i],[b,j])=>proximidade(a)-proximidade(b)||i-j).map(([a])=>a);
    const cartoes=ordenados.map(a=>el('button',{class:'cartao',type:'button',onclick:()=>mostrarAlerta(a.id)},
      el('div',{class:'linha'},el('h2',{texto:nome(a)})),
      el('div',{class:'linha'},el('span',{class:'preco',texto:a.atual?moeda(a.atual):'Aguardando leitura'}),el('span',{class:'loja',texto:a.lojaNome})),
      falta(a),
      a.termometro&&a.termometro.nivel!=='aprendendo'?el('div',{class:'selo',texto:`${a.termometro.emoji} ${a.termometro.texto}`}):null,
      chips(a.avisos)));
    const resumo=el('div',{class:'cartao'},el('div',{class:'opcao'},
      el('div',{},'Resumo semanal',el('small',{texto:'Segunda, por volta das 10h'})),
      chave(Boolean(dados.resumo),async ligado=>{await api('/api/app/alertas',{method:'POST',body:JSON.stringify({acao:'resumo',ligado})});})));
    tela(el('h1',{texto:'Meus alertas'}),
      formNovo(),
      cartoes.length?cartoes:el('p',{class:'vazio',texto:'Você ainda não tem alertas. Cole acima o link de um produto ou, no chat, toque em 🔎 Buscar produto.'}),
      resumo);
  }

  function chave(ligado,aoMudar){
    const b=el('button',{class:'chave',type:'button',role:'switch','aria-checked':String(ligado)});
    b.addEventListener('click',async()=>{
      const novo=b.getAttribute('aria-checked')!=='true';
      b.setAttribute('aria-checked',String(novo));vibrar();
      try{await aoMudar(novo);}catch(e){b.setAttribute('aria-checked',String(!novo));}
    });
    return b;
  }

  async function carregarGrafico(img,id,dias){
    try{
      const r=await api(`/api/app/grafico?id=${id}&dias=${dias}`);
      if(!r.ok){img.replaceWith(el('p',{class:'vazio',texto:'O gráfico aparece a partir do 2º dia de acompanhamento.'}));return;}
      if(graficoUrl) URL.revokeObjectURL(graficoUrl);
      graficoUrl=URL.createObjectURL(await r.blob());
      img.src=graficoUrl;
    }catch(e){img.alt='Gráfico indisponível';}
  }

  async function ajustar(id,pedido){
    const r=await api('/api/app/alertas',{method:'POST',body:JSON.stringify({id,...pedido})});
    const corpo=await r.json();
    if(!r.ok) throw new Error(corpo.erro||'erro');
    return corpo;
  }

  async function mostrarAlerta(id,dias=90,recarregando=false){
    if(tg){tg.BackButton.show();}
    if(!recarregando) aviso('Carregando…','carregando');
    let a;
    try{ a=(await (await api(`/api/app/alertas?id=${id}`)).json()).alerta; }catch(e){ a=null; }
    if(!a) return mostrarLista();
    const img=el('img',{class:'grafico',alt:'Gráfico do preço'});
    const abas=el('div',{class:'abas'},PERIODOS.map(([d,t])=>el('button',{type:'button','aria-pressed':String(d===dias),texto:t,
      onclick:ev=>{for(const b of abas.children) b.setAttribute('aria-pressed',String(b===ev.currentTarget));carregarGrafico(img,id,d);}})));
    const recarregar=()=>mostrarAlerta(id,dias,true);
    const selecao=(opcoes,atual,aoMudar)=>{
      const s=el('select',{},opcoes.map(([v,t])=>el('option',{value:String(v),selected:Number(atual)===v||(!atual&&v===0),texto:t})));
      s.addEventListener('change',async()=>{vibrar();try{await aoMudar(Number(s.value));}catch(e){tg&&tg.showAlert('Não deu certo. Tente de novo.');recarregar();}});
      return s;
    };
    const valor=el('input',{type:'text',inputmode:'decimal',placeholder:'Ex.: 199,90',value:a.avisos.valor?Number(a.avisos.valor).toFixed(2).replace('.',','):''});
    const salvarValor=el('button',{class:'botao secundario',type:'button',texto:'Salvar valor',onclick:async()=>{
      try{await ajustar(id,{acao:'valor',valor:valor.value.trim()||null});tg&&tg.showAlert(valor.value.trim()?'Combinado! Aviso quando chegar a esse valor.':'Valor removido.');recarregar();}
      catch(e){tg&&tg.showAlert('Não entendi o valor. Use, por exemplo, 199,90.');}
    }});
    const opcoes=el('div',{class:'cartao'},
      el('div',{class:'opcao'},el('div',{},'Menor preço do histórico',el('small',{texto:'Aviso quando bater o recorde'})),
        chave(a.avisos.menor,ligado=>ajustar(id,{acao:'menor',ligado}))),
      el('div',{class:'opcao'},el('div',{},'Avisar abaixo de',el('small',{texto:'O valor que você quer pagar'})),valor),
      el('div',{class:'botoes'},salvarValor),
      el('div',{class:'opcao'},el('div',{},'Queda de preço',el('small',{texto:'A partir do preço de agora'})),
        selecao(QUEDAS,a.avisos.queda||0,v=>ajustar(id,{acao:'queda',valor:v}))),
      a.podeEstoque?el('div',{class:'opcao'},el('div',{},'Voltar ao estoque'),chave(a.avisos.estoque,ligado=>ajustar(id,{acao:'estoque',ligado}))):null,
      el('div',{class:'opcao'},el('div',{},'Acompanhar por',el('small',{texto:a.ativo&&a.expiraEm?`Hoje vale até ${data(a.expiraEm)}`:'Alerta pausado'})),
        selecao([[0,'Escolher…'],...PRAZOS],0,async v=>{if(v){await ajustar(id,{acao:'prazo',valor:v});recarregar();}})));
    const infos=[
      a.minimo?el('div',{class:'loja',texto:`Menor ${moeda(a.minimo)} · maior ${moeda(a.maximo)}${a.desde?` desde ${data(a.desde)}`:''}`}):null,
      a.precoMax?el('div',{class:'loja',texto:`As opções vão até ${moeda(a.precoMax)}`}):null,
      falta(a),
      a.termometro&&a.termometro.nivel!=='aprendendo'?el('div',{class:'selo',texto:`${a.termometro.emoji} ${a.termometro.texto}`}):null,
      a.maquiada?el('div',{class:'selo alerta',texto:`⚠️ Desconto maquiado? Subiu para ${moeda(a.maquiada.pico)} nas últimas semanas e agora voltou perto do preço de antes (${moeda(a.maquiada.antes)}).`}):null,
      a.cupom?el('div',{class:'selo'},'🎟 Cupom ',el('span',{class:'cupom',texto:a.cupom.codigo}),a.cupom.condicao?`: ${a.cupom.condicao}`:''):null,
    ];
    const acoes=el('div',{class:'botoes'},
      a.link?el('button',{class:'botao',type:'button',texto:'🛒 Ver na loja',onclick:()=>tg?tg.openLink(a.link):window.open(a.link,'_blank')}):null,
      el('button',{class:'botao perigo',type:'button',texto:'Apagar',onclick:()=>{
        const apagar=async ok=>{if(!ok) return;await ajustar(id,{acao:'apagar'});mostrarLista();};
        tg?tg.showConfirm('Apagar este alerta?',apagar):apagar(window.confirm('Apagar este alerta?'));
      }}));
    tela(tg?null:el('button',{class:'voltar',type:'button',texto:'← Meus alertas',onclick:mostrarLista}),
      el('div',{class:'cartao'},el('h2',{texto:nome(a)}),
        el('div',{class:'linha'},el('span',{class:'preco',texto:a.atual?`${a.precoMax?'a partir de ':''}${moeda(a.atual)}`:'Aguardando leitura'}),el('span',{class:'loja',texto:a.lojaNome})),
        infos,abas,img,acoes),
      opcoes);
    carregarGrafico(img,id,dias);
  }

  if(tg){
    tg.ready();tg.expand();
    tg.BackButton.onClick(mostrarLista);
  }
  if(!initData) aviso('Abra este painel pelo bot @TaBaratoAlertaDePrecoBot, no botão “📱 Meus alertas”.');
  else mostrarLista();
})();
