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

  function sendEditorialMetric(card,eventType,store=''){
    const data={post_slug:card.dataset.editorialPost,product_id:card.dataset.editorialProduct,
      placement:card.dataset.editorialPlacement,event_type:eventType,store,source:window.tbTrafficSource||'other'};
    fetch('/api/editorial-metric',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true}).catch(()=>{});
  }

  function trackEditorialViews(){
    if(!('IntersectionObserver'in window))return;
    const seen=new WeakSet(),observer=new IntersectionObserver(entries=>{
      for(const entry of entries){if(!entry.isIntersecting||entry.intersectionRatio<.5||seen.has(entry.target))continue;
        seen.add(entry.target);sendEditorialMetric(entry.target,'view');observer.unobserve(entry.target);}
    },{threshold:.5});
    document.querySelectorAll('[data-editorial-post][data-editorial-product]').forEach(card=>observer.observe(card));
  }

  function trackAffiliateClick(event){
    const link=event.target.closest('a[href]');if(!link)return;
    const editorialCard=link.closest('[data-editorial-post][data-editorial-product]'),store=link.dataset.editorialStore;
    if(editorialCard&&store){
      sendEditorialMetric(editorialCard,'click',store);
      if(window.gtag)window.gtag('event','affiliate_click',{post_slug:editorialCard.dataset.editorialPost,
        product_id:editorialCard.dataset.editorialProduct,placement:editorialCard.dataset.editorialPlacement,
        store,transport_type:'beacon'});
      return;
    }
    if(!window.gtag)return;
    const url=new URL(link.href,location.href);if(!/^\/(go|loja|cupom)\//.test(url.pathname))return;
    window.gtag('event','affiliate_click',{link_path:url.pathname,transport_type:'beacon'});
  }

  document.addEventListener('DOMContentLoaded',()=>{
    loadAnalytics();
    trackEditorialViews();
    document.addEventListener('click',trackAffiliateClick,{capture:true});
  });
})();
