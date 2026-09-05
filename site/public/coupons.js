document.addEventListener('click',async event=>{
  const button=event.target.closest('.copy-coupon');
  if(!button) return;
  const original=button.textContent;
  try {
    await navigator.clipboard.writeText(button.dataset.code||'');
    button.textContent='Código copiado';
  } catch {
    button.textContent='Selecione o código acima';
  }
  window.setTimeout(()=>{button.textContent=original;},1800);
});
