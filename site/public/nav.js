// Menu: esconde "Cupons" sem cupom ativo e, na temporada da Black Friday,
// mostra o atalho (a página inicial é um arquivo fixo, por isso vai por aqui).
(function(){
  var BF={inicio:'2026-11-20',dia:'2026-11-27',fim:'2026-12-02'};
  var hoje=new Date(Date.now()-3*3600*1000).toISOString().slice(0,10);
  var nav=document.querySelector('.main-nav');
  if(nav&&hoje>=BF.inicio&&hoje<=BF.fim&&!nav.querySelector('.nav-bf')){
    var a=document.createElement('a');a.className='nav-bf';a.href='/black-friday';a.textContent='🖤 Black Friday';
    nav.insertBefore(a,nav.querySelector('.nav-cta'));
    var home=document.querySelector('.home-page');
    if(home&&!document.querySelector('.bf-strip')){
      var faltam=Math.round((Date.parse(BF.dia+'T00:00:00Z')-Date.parse(hoje+'T00:00:00Z'))/86400000);
      var faixa=document.createElement('a');faixa.className='bf-strip';faixa.href='/black-friday';
      faixa.textContent=faltam>1?'🖤 Black Friday em '+faltam+' dias: veja só os descontos de verdade →':faltam===1?'🖤 A Black Friday é amanhã: veja só os descontos de verdade →':'🖤 Black Friday: veja só os descontos de verdade →';
      home.insertBefore(faixa,home.firstChild);
    }
  }
  var links=document.querySelectorAll('[data-coupons]');
  if(!links.length||!window.fetch)return;
  fetch('/api/coupons').then(function(r){return r.json();}).then(function(d){
    var vazio=!(d&&d.coupons&&d.coupons.length);
    for(var i=0;i<links.length;i++)links[i].hidden=vazio;
  }).catch(function(){});
})();
