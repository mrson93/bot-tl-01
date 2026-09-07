const favorite=document.querySelector('[data-favorite]'),share=document.querySelector('[data-share]'),report=document.querySelector('.report-expired');
const saved=()=>{try{const value=JSON.parse(localStorage.getItem('tb:favorites')||'[]');return new Set(Array.isArray(value)?value:[]);}catch{return new Set();}};
function updateFavorite(){if(!favorite)return;const active=saved().has(favorite.dataset.favorite);favorite.classList.toggle('active',active);favorite.textContent=active?'♥ Salva':'♥ Salvar';}
favorite?.addEventListener('click',()=>{const ids=saved(),id=favorite.dataset.favorite;ids.has(id)?ids.delete(id):ids.add(id);localStorage.setItem('tb:favorites',JSON.stringify([...ids]));updateFavorite();});
share?.addEventListener('click',async()=>{try{if(navigator.share)await navigator.share({title:share.dataset.title,text:`${share.dataset.title} por ${share.dataset.price}`,url:location.href});else await navigator.clipboard.writeText(location.href);share.textContent='Link copiado ✓';}catch{}});
const reported=()=>{try{return new Set(JSON.parse(localStorage.getItem('tb:reported')||'[]'));}catch{return new Set();}};
report?.addEventListener('click',async()=>{report.disabled=true;try{const response=await fetch('/api/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({offer_id:report.dataset.offerId,kind:'expired'})});if(!response.ok)throw new Error();const ids=reported();ids.add(report.dataset.offerId);localStorage.setItem('tb:reported',JSON.stringify([...ids]));report.textContent='Obrigado pelo aviso ✓';}catch{report.textContent='Não foi possível enviar. Tente novamente.';report.disabled=false;}});
if(report&&reported().has(report.dataset.offerId)){report.disabled=true;report.textContent='Aviso já enviado ✓';}
updateFavorite();
