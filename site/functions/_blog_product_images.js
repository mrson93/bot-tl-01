const BASE='https://canaltabarato.com.br/images/blog/produtos';

export const PRODUCT_IMAGES={
  'galaxy-a07':`${BASE}/galaxy-a07.png`,
  'galaxy-a07-5g':`${BASE}/galaxy-a07-5g.png`,
  'moto-g05':`${BASE}/moto-g05.png`,
  'moto-g56-5g':`${BASE}/moto-g56-5g.png`,
  'galaxy-a26-5g':`${BASE}/galaxy-a26-5g.png`,
  'galaxy-a17-5g':'https://images.samsung.com/is/image/samsung/p6pim/br/sm-a176bzaozto/gallery/br-galaxy-a17-5g-sm-a176-sm-a176bzaozto-548807141?$1164_776_PNG$',
  'galaxy-a36-5g':'https://images.samsung.com/is/image/samsung/p6pim/br/sm-a366elgbzto/gallery/br-galaxy-a36-5g-sm-a366-sm-a366elgbzto-545388452?$1164_776_PNG$',
  'galaxy-a56-5g':`${BASE}/galaxy-a56-5g.png`,
  'edge-60-fusion':`${BASE}/edge-60-fusion.png`,
  'redmi-note-14':`${BASE}/redmi-note-14.png`,
  'redmi-note-15-5g':`${BASE}/redmi-note-15-5g.png`,
  'galaxy-s26-ultra':`${BASE}/galaxy-s26-ultra.jpg`,
};

export function imageForProduct(product={}){
  return product.image_url||PRODUCT_IMAGES[product.id]||'';
}
