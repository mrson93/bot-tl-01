export const CELLULAR_GUIDES_COVER='https://canaltabarato.com.br/images/blog/guia-celulares-2026.jpg';

export function coverForPost(post={}){
  if(post.cover_image_url)return post.cover_image_url;
  return String(post.category||'').toLocaleLowerCase('pt-BR').includes('celular')?CELLULAR_GUIDES_COVER:'';
}
