import {SITE} from './_site.js';

const INDEXNOW_KEY='6b821dc1235f4fd38d7b9b203617c731';

export async function notifyIndexNow(paths) {
  try {
    const response=await fetch('https://api.indexnow.org/indexnow',{
      method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},
      body:JSON.stringify({host:'canaltabarato.com.br',key:INDEXNOW_KEY,
        keyLocation:`${SITE}/${INDEXNOW_KEY}.txt`,
        urlList:paths.map(path=>`${SITE}${path}`)})
    });
    if(!response.ok&&response.status!==202) console.warn('IndexNow recusou atualização',{status:response.status});
  } catch(error) {
    console.warn('IndexNow indisponível',{error:String(error&&error.name||'erro')});
  }
}
