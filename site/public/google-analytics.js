(()=>{
  const MEASUREMENT_ID='G-3LVTD2P52D';
  const CONSENT_KEY='tb:google-analytics-consent';

  function loadAnalytics(){
    if(window.__tbGoogleAnalyticsLoaded)return;
    window.__tbGoogleAnalyticsLoaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{
      analytics_storage:'granted',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    });
    window.gtag('js',new Date());
    window.gtag('config',MEASUREMENT_ID,{allow_google_signals:false});
    const script=document.createElement('script');
    script.async=true;
    script.src=`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  function saveConsent(value){
    try{localStorage.setItem(CONSENT_KEY,value);}catch{}
  }

  function showConsent(){
    const banner=document.createElement('section');
    banner.className='analytics-consent';
    banner.setAttribute('role','dialog');
    banner.setAttribute('aria-label','Preferências de medição');
    banner.innerHTML='<p><strong>Podemos medir sua visita?</strong><span>O Google Analytics ajuda a entender quais páginas e ofertas são mais úteis. Não usamos essa medição para publicidade personalizada. <a href="/privacidade">Saiba mais</a>.</span></p><div><button type="button" data-consent="denied">Agora não</button><button type="button" class="consent-accept" data-consent="granted">Aceitar medição</button></div>';
    banner.addEventListener('click',event=>{
      const choice=event.target.closest('[data-consent]')?.dataset.consent;
      if(!choice)return;
      saveConsent(choice);
      banner.remove();
      if(choice==='granted')loadAnalytics();
    });
    document.body.appendChild(banner);
  }

  function trackAffiliateClick(event){
    if(!window.gtag)return;
    const link=event.target.closest('a[href]');
    if(!link)return;
    const url=new URL(link.href,location.href);
    if(!/^\/(go|loja|cupom)\//.test(url.pathname))return;
    window.gtag('event','affiliate_click',{
      link_path:url.pathname,
      transport_type:'beacon'
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    let consent='';
    try{consent=localStorage.getItem(CONSENT_KEY)||'';}catch{}
    if(consent==='granted')loadAnalytics();
    else if(consent!=='denied')showConsent();
    document.addEventListener('click',trackAffiliateClick,{capture:true});
  });
})();
