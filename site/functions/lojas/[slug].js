import {collectionPage} from '../_collection.js';

export function onRequestGet({params,env}) {
  return collectionPage(env,'shop',String(params.slug||''));
}
