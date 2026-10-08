import {collectionPage} from '../_collection.js';
import {responseHead} from '../_site.js';

export function onRequestGet({params,env}) {
  return collectionPage(env,'shop',String(params.slug||''));
}

export async function onRequestHead(context) {
  return responseHead(await onRequestGet(context));
}
