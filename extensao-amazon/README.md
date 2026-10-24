# Extensão: Tá Barato · Lista de Ofertas

Coloca um checkbox amarelo **"Adicionar às Ofertas"** em cada produto das
páginas de listagem da Amazon (Ofertas do Dia, busca, mais vendidos...). Ao
marcar, a extensão faz a mesma chamada que o botão **Adicionar à Lista** da
Amazon faz para a lista de ideias "Ofertas" (código `2ZUSMM2BR8LVZ`, a mesma
que o bot lê), sem abrir abas. O checkbox fica verde quando a Amazon responde
`updateSuccessful`.

- Um produto por vez, com pausa curta entre eles, como um clique humano.
- Nada sai do seu navegador: a extensão não envia dados para nenhum servidor.
- Só funciona em `www.amazon.com.br`, logado na sua conta.
- Na página de um produto, use o botão normal da Amazon.

## Instalar (Chrome ou Brave)

1. Abra `chrome://extensions` (no Brave, `brave://extensions`).
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao-amazon`
   deste projeto.
4. Abra as Ofertas do Dia da Amazon e marque os produtos.

Para usar outra lista, clique no ícone da extensão e troque o código.

## Se parar de funcionar

A extensão usa a chamada interna `/create/api/addToList` (a mesma do botão da
Amazon) e o campo escondido `creator-sp-csrf-form-token` da página do produto.
Se a Amazon mudar isso, o checkbox fica vermelho e a mensagem aparece ao passar
o mouse; avise para ajustar `listagem.js`. Depois de atualizar os arquivos,
clique em **Recarregar** (↻) na extensão em `brave://extensions`.
