import assert from 'node:assert/strict';
import test from 'node:test';
import {lerCupons,valorEmReais} from '../../extensao-mercadolivre/cupons.js';
import {cleanCoupon,onRequestGet,onRequestPost} from '../functions/api/ml-coupons.js';

const cupom=(id,titulo,sub,minimo,limite,fim='2026-12-01T02:59Z',extra={})=>({campaign_id:id,title:{text:titulo},
  initial_subtitle:{text:sub},amount:{min_amount:minimo,cap_amount:limite},
  future_coupon_info:{start_date:'2026-11-05T14:15Z',expiration_date:fim},code:'TOKENSECRETO',...extra});
const pagina=grupos=>`<script>x=1</script><script>_n.ctx.r=${JSON.stringify({appProps:{pageProps:{landingData:{groupings:grupos}}}})};</script>`;

test('extensão: lê só os cupons públicos de campanha, sem repetir',()=>{
  const html=pagina([
    {key:'my_page',rawCoupons:[cupom('111111','R$ 20 OFF','Em produtos selecionados','Compra mínima R$ 100','Limite de R$ 20')]},
    {key:'ce_vertical',rawCoupons:[
      cupom('14034559','20% OFF em LIQUIDA','Em produtos selecionados','Sem compra mínima.','Limite de R$ 1.000'),
      cupom('222222','R$20 OFF Seguidor','Em produtos selecionados','Compra mínima R$ 220','Limite de R$ 20'),
      cupom('333333','20% OFF','Em produtos de Atr Essências','Compra mínima R$ 30','Limite de R$ 5.000'),
    ]},
    {key:'price',rawCoupons:[
      cupom('14034559','20% OFF em LIQUIDA','Em produtos selecionados','Sem compra mínima.','Limite de R$ 1.000'),
      cupom('444444','R$ 190 OFF MÓVEIS PARA CASA','Em produtos selecionados','Compra mínima R$ 1.100,01','Limite de R$ 190'),
    ]},
  ]);
  const cupons=lerCupons(html);
  assert.deepEqual(cupons.map(c=>c.id),['14034559','444444']);
  assert.deepEqual(cupons[0],{id:'14034559',title:'20% OFF em LIQUIDA',min_text:'Sem compra mínima.',cap_text:'Limite de R$ 1.000',
    min_value:0,cap_value:1000,starts_at:Date.parse('2026-11-05T14:15Z')/1000,expires_at:Date.parse('2026-12-01T02:59Z')/1000,group:'ce_vertical'});
  assert.equal(cupons[1].min_value,1100.01);
  assert.equal(JSON.stringify(cupons).includes('TOKENSECRETO'),false);   // o token pessoal não sai
  assert.equal(valorEmReais('Limite de R$ 10.000'),10000);
  assert.deepEqual(lerCupons('<html></html>'),[]);
});

function fakeDb(){
  const state={row:null};
  return {state,prepare(sql){return {args:[],bind(...a){this.args=a;return this;},
    async run(){if(sql.startsWith('INSERT')){const [coupons,captured_at]=this.args;state.row={coupons,captured_at};}return {};},
    async first(){return state.row;}};}};
}
const env=()=>({DB:fakeDb(),ML_LIST_TOKEN:'token-da-extensao-ml',PUBLISH_TOKEN:'token-do-bot'});
const req=(metodo,token,body)=>new Request('https://canaltabarato.com.br/api/ml-coupons',{method:metodo,
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const bom={id:'14034559',title:'20% OFF em LIQUIDA',min_text:'Sem compra mínima.',cap_text:'Limite de R$ 1.000',min_value:0,cap_value:1000,expires_at:2_000_000_000};

test('site: extensão grava os cupons e o bot lê',async()=>{
  const ambiente=env();
  assert.equal((await onRequestPost({request:req('POST','token-do-bot',{coupons:[bom]}),env:ambiente})).status,401);
  assert.equal((await onRequestPost({request:req('POST','token-da-extensao-ml',{coupons:[bom,{...bom},{id:'x',title:'oi'}]}),env:ambiente})).status,201);
  const lido=await (await onRequestGet({request:req('GET','token-do-bot'),env:ambiente})).json();
  assert.deepEqual(lido.coupons.map(c=>c.id),['14034559']);
  assert.equal((await onRequestGet({request:req('GET','token-da-extensao-ml'),env:ambiente})).status,401);
});

test('site: cupom vencido ou sem "OFF" fica de fora',()=>{
  assert.ok(cleanCoupon(bom,1_900_000_000));
  assert.equal(cleanCoupon({...bom,expires_at:1_800_000_000},1_900_000_000),null);
  assert.equal(cleanCoupon({...bom,title:'Frete grátis'},1_900_000_000),null);
  assert.equal(cleanCoupon({...bom,id:'abc'},1_900_000_000),null);
});
