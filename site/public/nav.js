// Esconde o atalho "Cupons" do menu enquanto não houver cupom ativo
// (as lojas não mandam cupons pela API; eles entram pelo painel).
(function(){
  var links=document.querySelectorAll('[data-coupons]');
  if(!links.length||!window.fetch)return;
  fetch('/api/coupons').then(function(r){return r.json();}).then(function(d){
    var vazio=!(d&&d.coupons&&d.coupons.length);
    for(var i=0;i<links.length;i++)links[i].hidden=vazio;
  }).catch(function(){});
})();
