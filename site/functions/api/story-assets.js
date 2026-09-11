import {authorized,json} from '../_lib.js';

const MAX_REQUEST_BYTES=1_200_000;
const MAX_IMAGE_BYTES=850_000;

async function readJsonLimited(request) {
  if(!request.body) throw new Error('empty_body');
  const reader=request.body.getReader(), chunks=[];
  let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done) break;
    total+=value.byteLength;
    if(total>MAX_REQUEST_BYTES){await reader.cancel();throw new Error('too_large');}
    chunks.push(value);
  }
  const joined=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(joined));
}

function decodeJpeg(value) {
  if(typeof value!=='string'||value.length<4) return null;
  let raw;try{raw=atob(value);}catch{return null;}
  if(raw.length>MAX_IMAGE_BYTES||raw.length<4) return null;
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  if(bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff) return null;
  return bytes;
}

export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;try{body=await readJsonLimited(request);}catch(error){
    const tooLarge=error instanceof Error&&error.message==='too_large';
    return json({error:tooLarge?'too_large':'invalid_json'},tooLarge?413:400);
  }
  const image=decodeJpeg(body.image_base64);
  if(!image) return json({error:'invalid_image'},400);
  const now=Math.floor(Date.now()/1000), id=crypto.randomUUID().replaceAll('-','');
  // A implantação do Pages é automática pelo Git. Este bootstrap idempotente
  // mantém o primeiro upload funcional mesmo antes da migração operacional.
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS story_assets(id TEXT PRIMARY KEY,image BLOB NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO story_assets(id,image,created_at,expires_at) VALUES(?,?,?,?)').bind(id,image,now,now+108000).run();
  context.waitUntil(env.DB.prepare('DELETE FROM story_assets WHERE expires_at<?').bind(now).run());
  return json({ok:true,url:new URL(`/story-assets/${id}.jpg`,request.url).href},201);
}
