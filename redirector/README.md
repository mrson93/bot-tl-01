# Redirecionador próprio de cliques

Este Worker cria links curtos, registra somente o identificador público da oferta,
canal, loja e horário do clique, e redireciona para o link oficial de afiliado.
Não registra IP, comprador, pedido ou parâmetros pessoais.

Ele permanece desativado no bot enquanto `SHORTLINK_API_URL`,
`SHORTLINK_BASE_URL` e `SHORTLINK_API_TOKEN` estiverem vazios.

Antes de implantar:

1. cadastre e aprove o domínio como mídia nos programas de afiliados;
2. confira o D1 e o domínio em `wrangler.jsonc`;
3. crie o banco D1 e aplique `schema.sql`;
4. configure `ADMIN_TOKEN` e `ABUSE_HASH_SECRET` como secrets do Worker; ambos
   devem ter pelo menos 32 caracteres aleatórios e valores diferentes;
5. valide os hosts permitidos e faça um teste de atribuição de cada loja;
6. somente então configure os três secrets `SHORTLINK_*` no GitHub.

Em produção, use `https://go.canaltabarato.com.br` como base pública e
`https://go.canaltabarato.com.br` como API. O mesmo Worker separa os cliques
por canal, loja e oferta sem armazenar IP ou identificadores de visitantes.
Para impedir contagens repetidas, o Worker mantém apenas um HMAC temporário e
não reversível. O binding `CLICK_RATE_LIMITER` adiciona o limite por cliente no edge.

Se o serviço falhar, o bot publica o link oficial de afiliado sem interromper a oferta.

## O que conta como clique

Só acessos `GET` vindos do Brasil (`CLICK_COUNTRIES`, padrão `BR`) e de
navegador que não se identifica como robô. Em 13/11/2026, 21 de 21 acessos
observados em 9 minutos vinham de datacenters fora do Brasil, vários com
user-agent de navegador comum; antes disso cada post do Bluesky "recebia" de 6
a 13 cliques que não eram de pessoas.

