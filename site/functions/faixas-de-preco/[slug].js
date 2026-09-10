import {priceRangePage} from '../_discovery.js';
export function onRequestGet({params,env}){return priceRangePage(env,String(params.slug||''));}
