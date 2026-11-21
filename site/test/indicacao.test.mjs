import assert from 'node:assert/strict';
import test from 'node:test';
import {codigoDe,contarIndicacao,limitePessoa,mensagemConvite,novoCodigo,registrarIndicacao} from '../functions/_referral.js';
import {handleCallback,handlePriceAlert} from '../functions/_price_alerts.js';
import {handleUpdate} from '../functions/_telegram_alerts.js';

// D1 de mentira com a tabela alerta_pessoas de verdade (o suficiente para estas regras).
function banco({alertas={}}={}) {
  const pessoas=new Map(), executados=[];
  const linha=id=>pessoas.get(String(id));
  const garantir=id=>{if(!pessoas.has(String(id))) pessoas.set(String(id),{chat_id:String(id),codigo:null,indicado_por:null,indicacao_contada_em:null});return linha(id);};
  const responder=(sql,a)=>{
    if(sql.startsWith('SELECT codigo FROM alerta_pessoas')) return linha(a[0])?{codigo:linha(a[0]).codigo}:null;
    if(sql.startsWith('SELECT chat_id FROM alerta_pessoas WHERE codigo=?')) return [...pessoas.values()].find(p=>p.codigo===a[0])||null;
    if(sql.startsWith('SELECT 1 AS sim FROM alerta_precos')) return (alertas[a[0]]||0)>0?{sim:1}:null;
    if(sql.startsWith('SELECT COUNT(*) AS total FROM alerta_pessoas WHERE indicado_por=?'))
      return {total:[...pessoas.values()].filter(p=>p.indicado_por===a[0]&&p.indicacao_contada_em).length};
    if(sql.includes('COUNT(*) AS total FROM alerta_precos WHERE chat_id=?')) return {total:alertas[a[0]]||0};
    return null;
  };
  return {
    pessoas,executados,
    prepare(sql){
      return {sql,args:[],bind(...a){this.args=a;return this;},
        async first(){
          executados.push([sql,this.args]);
          if(sql.startsWith('UPDATE alerta_pessoas SET indicacao_contada_em=?')){
            const p=linha(this.args[1]);
            if(!p||!p.indicado_por||p.indicacao_contada_em) return null;
            p.indicacao_contada_em=this.args[0];return {indicado_por:p.indicado_por};
          }
          return responder(sql,this.args);
        },
        async all(){executados.push([sql,this.args]);return {results:[]};},
        async run(){
          executados.push([sql,this.args]);
          if(sql.startsWith('INSERT INTO alerta_pessoas(chat_id,codigo)')){
            if([...pessoas.values()].some(p=>p.codigo===this.args[1])) throw new Error('UNIQUE');
            const p=garantir(this.args[0]);p.codigo=p.codigo||this.args[1];
          }
          if(sql.startsWith('INSERT INTO alerta_pessoas(chat_id,indicado_por)')){const p=garantir(this.args[0]);p.indicado_por=p.indicado_por||this.args[1];}
          return {meta:{changes:1}};
        }};
    },
    async batch(stmts){for(const s of stmts) executados.push([s.sql,s.args]);return [];},
  };
}
const AGORA=1_800_000_000;

test('código aleatório de 8 letras, sem caracteres confusos, e fixo por pessoa',async()=>{
  assert.match(novoCodigo(),/^[a-hjkmnp-z2-9]{8}$/);
  const db=banco();
  const codigo=await codigoDe({DB:db},'55');
  assert.equal(await codigoDe({DB:db},'55'),codigo);
  assert.notEqual(await codigoDe({DB:db},'66'),codigo);
});

test('só gente nova entra por indicação, e ninguém indica a si mesmo',async()=>{
  const db=banco({alertas:{'77':2}});
  const env={DB:db};
  const codigo=await codigoDe(env,'55');
  assert.equal(await registrarIndicacao(env,'55',codigo),false);         // a si mesmo
  assert.equal(await registrarIndicacao(env,'77',codigo),false);         // já tinha alerta
  assert.equal(await registrarIndicacao(env,'66','zzzzzzzz'),false);     // código que não existe
  assert.equal(await registrarIndicacao(env,'66',codigo),true);
  assert.equal(db.pessoas.get('66').indicado_por,'55');
  // Segundo convite não troca quem indicou.
  const outro=await codigoDe(env,'88');
  await registrarIndicacao(env,'66',outro);
  assert.equal(db.pessoas.get('66').indicado_por,'55');
});

test('amigo conta no primeiro alerta, uma vez, com aviso a quem indicou e teto de 30',async()=>{
  const db=banco();
  const enviados=[];
  const fetcher=async(url,init)=>{enviados.push(JSON.parse(init.body));return new Response('{}');};
  const env={DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'};
  const codigo=await codigoDe(env,'55');
  assert.equal(await limitePessoa(env,'55'),10);
  const AMIGOS=['700001','700002','700003','700004','700005'];
  for(const amigo of AMIGOS){
    await registrarIndicacao(env,amigo,codigo);
    await contarIndicacao(env,amigo,AGORA,fetcher);
    await contarIndicacao(env,amigo,AGORA,fetcher);  // segundo alerta do mesmo amigo: nada
  }
  assert.equal(enviados.length,5);
  assert.equal(enviados[0].chat_id,'55');
  assert.match(enviados[0].text,/\+5 vagas<\/b>\. Agora você pode acompanhar até <b>15 produtos/);
  assert.match(enviados[3].text,/até <b>30 produtos/);
  assert.match(enviados[4].text,/já está no máximo de 30/);
  for(const amigo of AMIGOS) assert.ok(!enviados.some(e=>e.text.includes(amigo)));  // não diz quem foi
  assert.equal(await limitePessoa(env,'55'),30);
  // Quem não veio por indicação não dispara nada.
  assert.equal(await contarIndicacao(env,'99',AGORA,fetcher),null);
});

test('limite cheio sugere convidar; /convidar, botão e /start r_ funcionam',async()=>{
  const db=banco({alertas:{'55':10}});
  const env={DB:db,TELEGRAM_ALERTS_BOT_USERNAME:'TaBaratoAlertaDePrecoBot'};
  const cheio=await handlePriceAlert(env,'55','https://www.mercadolivre.com.br/x/p/MLB123',AGORA,async()=>{throw new Error('sem rede');});
  assert.match(cheio.text,/Você já tem 10 produtos.*convide amigos/);
  assert.equal(cheio.markup.inline_keyboard[0][0].callback_data,'cv');

  const convite=await handleUpdate(env,{message:{chat:{id:55,type:'private'},text:'/convidar'}},AGORA);
  const codigo=db.pessoas.get('55').codigo;
  assert.match(convite.text,new RegExp(`https://t\\.me/TaBaratoAlertaDePrecoBot\\?start=r_${codigo}`));
  assert.match(convite.text,/seu limite: <b>10 de 30 produtos/);
  const compartilhar=new URL(convite.markup.inline_keyboard[0][0].url);
  assert.equal(compartilhar.origin+compartilhar.pathname,'https://t.me/share/url');
  assert.equal(compartilhar.searchParams.get('url'),`https://t.me/TaBaratoAlertaDePrecoBot?start=r_${codigo}`);
  assert.equal((await handleCallback(env,'55','cv',AGORA)).answer,'Seu convite');

  const chegada=await handleUpdate(env,{message:{chat:{id:66,type:'private'},text:`/start r_${codigo}`}},AGORA);
  assert.match(chegada[0].text,/convite de um amigo/);
  assert.equal(db.pessoas.get('66').indicado_por,'55');
  const invalido=await handleUpdate(env,{message:{chat:{id:67,type:'private'},text:'/start r_xxxxxxxx'}},AGORA);
  assert.doesNotMatch(invalido[0].text,/convite de um amigo/);
});
