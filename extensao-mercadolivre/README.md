# Extensão: Tá Barato · Mercado Livre

Desde 23/11/2026 o Mercado Livre recusa o preço de produtos de catálogo à API
do bot (403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) e mostra uma verificação
anti-robô a quem abre as páginas sem login. Esta extensão lê as páginas de
**mais vendidos** no seu navegador, logado, e envia uma cópia ao site. O bot
usa essa cópia quando a API não traz ofertas (até 3 h de idade,
`MERCADOLIVRE_COPIA_MAX_HORAS`), sempre com o link de afiliado.

- A cada hora, lê 4 categorias (revezando as mesmas do bot), com pausa de
  4 s entre elas, como uma pessoa navegando.
- Envia só nome, preço, preço "de", foto e link de cada produto.
- Só funciona com o Chrome aberto e logado no Mercado Livre. A leitura roda
  de dentro de uma aba do Mercado Livre (sem ela, o site não recebe o login e
  devolve a página vazia): usa uma aba já aberta ou abre uma em segundo plano
  e fecha no fim.

## Cupons

A cada 6 h a extensão também lê https://www.mercadolivre.com.br/cupons e
envia ao site (`/api/ml-coupons`) só os cupons públicos de campanha ("Em
produtos selecionados"). Os de seguidor, de loja e da aba "Meus cupons" são
pessoais e ficam de fora. O bot publica os melhores em /cupons e nos canais
(no máximo `CUPOM_ALERTAS_POR_DIA` alertas por dia), com o link de afiliado da
página de cupons. O botão "Enviar cupons agora" faz o envio na hora.

## Instalar (Chrome ou Brave)

1. Crie o token do site (uma vez). No terminal, na pasta do projeto:

   ```bash
   T=$(openssl rand -hex 32); printf %s "$T" | (cd site && npx wrangler pages secret put ML_LIST_TOKEN --project-name canaltabarato) && printf %s "$T" | pbcopy; unset T
   ```

   O token fica copiado (Cmd+V) e não aparece na tela.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** e clique em
   **Carregar sem compactação**, escolhendo a pasta `extensao-mercadolivre`.
3. Clique no ícone da extensão, cole o token e clique em **Salvar token**.
   Ela já faz o primeiro envio e mostra quantos produtos leu.

## Conferir

O ícone mostra o último envio. No log do bot aparece
`Mercado Livre (extensão): N mais vendido(s) da cópia de X min`.
