# Extensão: Tá Barato · Lista de Ofertas

Coloca um checkbox amarelo **"Adicionar às Ofertas"** em cada produto das
páginas de listagem da Amazon (Ofertas do Dia, busca, mais vendidos...). Ao
marcar, a extensão faz a mesma chamada que o botão **Adicionar à Lista** da
Amazon faz para a lista de ideias "Ofertas" (código `2ZUSMM2BR8LVZ`, a mesma
que o bot lê), sem abrir abas. O checkbox fica verde quando a Amazon responde
`updateSuccessful`.

- Um produto por vez, com pausa curta entre eles, como um clique humano.
- Os produtos marcados só vão para a Amazon. O único outro envio é a cópia
  da lista para o site do canal (seção abaixo), e só depois que você salva o
  token.
- Só funciona em `www.amazon.com.br`, logado na sua conta.
- Na página de um produto, use o botão normal da Amazon.

## Instalar (Chrome ou Brave)

1. Abra `chrome://extensions` (no Brave, `brave://extensions`).
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao-amazon`
   deste projeto.
4. Abra as Ofertas do Dia da Amazon e marque os produtos.

Para usar outra lista, clique no ícone da extensão e troque o código.

No ícone da extensão também dá para escolher um **mínimo de compras no mês
passado** e ligar **Ordenar pelos mais comprados**. Os dois usam o selo "Mais de
X compras no mês passado" que a Amazon mostra nos cartões; produto sem o selo vai
para o fim da página (ou some, se houver mínimo).

## Limpeza automática da lista

A Amazon aceita no máximo **400 produtos** numa lista de ideias; cheia, ela
recusa qualquer item novo (até pelo botão dela) e o checkbox fica vermelho.

Por isso, a cada 3 dias, na primeira página da Amazon aberta neste navegador, a
extensão remove da lista:

- produtos que saíram de promoção (sem preço riscado e sem selo de oferta);
- produtos com desconto abaixo de 20% que também não são populares (menos de
  1.000 avaliações e menos de 500 compras no mês).

Produtos adicionados pela extensão nas últimas 24 h nunca são removidos. O
intervalo e o desconto mínimo ficam no ícone da extensão, que também mostra o
resultado da última limpeza e tem o botão para limpar na próxima página.

## Enviar a lista para o bot

A Amazon recusa com 503 boa parte das leituras feitas do GitHub (IP de
datacenter). Por isso, a cada 30 minutos, com o navegador aberto, a extensão lê
a lista pública (e as páginas do "Carregar mais") daqui e guarda uma cópia em
`canaltabarato.com.br/api/amazon-list`. O bot usa essa cópia quando ela tem
até 90 minutos (`AMAZON_LISTA_SITE_MINUTOS`); se não houver, lê a Amazon direto
como antes.

Para ligar:

1. Gere um token longo e aleatório (por exemplo, `openssl rand -hex 32` no Terminal).
2. Na Cloudflare, em Pages → canaltabarato → Configurações → Variáveis e
   segredos, crie o segredo `AMAZON_LIST_TOKEN` com esse valor e refaça a
   implantação.
3. No ícone da extensão, cole o mesmo valor em **Token do site**, clique em
   **Salvar token** e depois em **Enviar agora**. A linha abaixo do botão mostra
   o resultado do último envio.

Esse token só permite gravar a cópia da lista; ele não publica nada no site.

## Se parar de funcionar

A extensão usa a chamada interna `/create/api/addToList` (a mesma do botão da
Amazon) e o campo escondido `creator-sp-csrf-form-token` da página do produto.
Se a Amazon mudar isso, o checkbox fica vermelho e a mensagem aparece ao passar
o mouse; avise para ajustar `listagem.js`. Depois de atualizar os arquivos,
clique em **Recarregar** (↻) na extensão em `brave://extensions`.
