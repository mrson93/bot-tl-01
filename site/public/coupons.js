document.addEventListener('click',async event=>{
  const link=event.target.closest('.coupon-redeem[data-code]');
  if(!link) return;
  const label=link.querySelector('.coupon-action-label');
  const original=label.textContent;
  try {
    await navigator.clipboard.writeText(link.dataset.code||'');
    label.textContent='Código copiado ✓';
  } catch {
    label.textContent='Copie o código acima';
  }
  window.setTimeout(()=>{label.textContent=original;},2200);
});
