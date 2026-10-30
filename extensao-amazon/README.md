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
