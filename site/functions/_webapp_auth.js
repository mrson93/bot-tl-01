// Login do mini app sem senha: o Telegram entrega à página o initData assinado
// com o token do bot. Regra oficial: chave = HMAC_SHA256("WebAppData", token);
// hash = HMAC_SHA256(chave, campos em ordem alfabética "k=v" unidos por \n, sem o hash).
export const VALIDADE_INITDATA=24*3600;

const encoder=new TextEncoder();

async function hmac(chave,texto) {
  const key=await crypto.subtle.importKey('raw',chave,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(texto)));
}

const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');

function iguais(a,b) {
  if(a.length!==b.length) return false;
  let diferenca=0;
  for(let i=0;i<a.length;i++) diferenca|=a.charCodeAt(i)^b.charCodeAt(i);
  return diferenca===0;
}

// Devolve {chatId, nome} ou null. chatId = id da pessoa (no privado é o mesmo do chat).
export async function validarInitData(initData,token,now=Math.floor(Date.now()/1000),validade=VALIDADE_INITDATA) {
  if(!token||typeof initData!=='string'||!initData||initData.length>4096) return null;
  const params=new URLSearchParams(initData);
  const hash=params.get('hash')||'';
  if(!/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const verificacao=[...params.entries()].sort(([a],[b])=>(a<b?-1:a>b?1:0)).map(([k,v])=>`${k}=${v}`).join('\n');
  const chave=await hmac(encoder.encode('WebAppData'),token);
  if(!iguais(hex(await hmac(chave,verificacao)),hash)) return null;
  const quando=Number(params.get('auth_date'));
  if(!Number.isInteger(quando)||quando>now+60||now-quando>validade) return null;
  let usuario;
  try{ usuario=JSON.parse(params.get('user')||''); }catch{ return null; }
  const id=String(usuario?.id||'');
  if(!/^\d{1,20}$/.test(id)||usuario?.is_bot) return null;
  return {chatId:id,nome:String(usuario.first_name||'').slice(0,60)};
}

// Assina como o Telegram (só para testes e para conferir a regra).
export async function assinarInitData(campos,token) {
  const params=new URLSearchParams(campos);
  const verificacao=[...params.entries()].sort(([a],[b])=>(a<b?-1:a>b?1:0)).map(([k,v])=>`${k}=${v}`).join('\n');
  const chave=await hmac(encoder.encode('WebAppData'),token);
  params.set('hash',hex(await hmac(chave,verificacao)));
  return params.toString();
}
