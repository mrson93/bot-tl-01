import {paginaQuedasDeHoje} from './_price_drops.js';
export function onRequestGet({env}){return paginaQuedasDeHoje(env);}
