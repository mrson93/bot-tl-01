for(const unit of document.querySelectorAll('ins.adsbygoogle')){
  if(unit.dataset.adInitialized)continue;
  unit.dataset.adInitialized='true';
  (window.adsbygoogle=window.adsbygoogle||[]).push({});
}
