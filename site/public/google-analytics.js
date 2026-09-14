(()=>{
  const MEASUREMENT_ID='G-3LVTD2P52D';

  function loadAnalytics(){
    if(window.__tbGoogleAnalyticsLoaded)return;
    window.__tbGoogleAnalyticsLoaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{
      analytics_storage:'denied',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    });
    window.gtag('set','ads_data_redaction',true);
    window.gtag('js',new Date());
    window.gtag('config',MEASUREMENT_ID,{
      allow_google_signals:false,
      allow_ad_personalization_signals:false
    });
    const script=document.createElement('script');
    script.async=true;
    script.src=`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(script);
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
    loadAnalytics();
    document.addEventListener('click',trackAffiliateClick,{capture:true});
  });
})();
