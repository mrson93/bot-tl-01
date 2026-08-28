# Crescimento orientado por dados

## Resultado implementado

- Backup remoto da versão estável antes das mudanças.
- Conversões agregadas por produto, canal, horário, categoria, preço e desconto.
- Alertas de dez ou mais posts em sete dias sem conversão.
- SQLite armazena somente oferta pública e agregados; não há pedido ou comprador.
- Shopee, AliExpress e Amazon são buscadas em paralelo e comparadas numa fila única.
- O histórico dá bônus limitado à pontuação para não promover uma oferta ruim.
- Cupons e preço de aplicativo aparecem somente quando a API devolve esses campos.
- Chamada humana por categoria, reputação no Bluesky e um único CTA no Telegram.
- Redirecionador Cloudflare Worker + D1 preparado, desativado por padrão e com
  fallback automático para o link oficial.

## Limites externos

- A consulta atual da Shopee não fornece cupom nem todos os cliques.
- O domínio do redirecionador precisa ser propriedade do usuário e mídia aprovada.
- A implantação exige conta Cloudflare, banco D1, domínio e secrets próprios.
- O intervalo de 12–18 minutos exige que o cron-job.org dispare a cada 5 minutos;
  essa configuração não pode ser feita sem entrar na conta do agendador.

## Segurança

- O redirecionador aceita somente HTTPS e uma lista explícita de hosts de destino.
- A API administrativa exige bearer token e nunca o inclui em URL.
- Cliques guardam somente slug e horário; não armazenam IP, comprador ou pedido.
- Falha do redirecionador, relatório ou de uma loja não bloqueia as demais entregas.
