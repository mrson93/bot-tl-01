// Mini app do bot de alertas, aberto dentro do Telegram. A página em si não tem
// dados: o script pede tudo à API com o initData assinado pelo Telegram.
export const VERSAO='20261120-1';
export const CSP=["default-src 'self'","script-src 'self' https://telegram.org","style-src 'self'","img-src 'self' https: data: blob:",
  "connect-src 'self'","frame-ancestors https://web.telegram.org","object-src 'none'","base-uri 'self'","form-action 'none'"].join('; ');

export function paginaMiniApp() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>Meus alertas | Tá Barato</title>
<link rel="stylesheet" href="/miniapp/alertas.css?v=${VERSAO}">
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="/miniapp/alertas.js?v=${VERSAO}" defer></script></head>
<body><main id="app" aria-live="polite"><p class="carregando">Carregando seus alertas…</p></main></body></html>`;
}

export function onRequestGet() {
  return new Response(paginaMiniApp(),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'}});
}
