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
- Só funciona com o Chrome aberto e logado no Mercado Livre. Se a leitura em
  segundo plano cair na verificação, ela tenta de dentro de uma aba do
  Mercado Livre aberta.

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
