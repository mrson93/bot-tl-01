import {collectionPage} from '../_collection.js';

export function onRequestGet({params,env}) {
  return collectionPage(env,'category',String(params.slug||''));
}
