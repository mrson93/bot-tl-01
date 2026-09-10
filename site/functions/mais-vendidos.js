import {discoveryPage} from './_discovery.js';
export function onRequestGet({env}){return discoveryPage(env,'sellers');}
