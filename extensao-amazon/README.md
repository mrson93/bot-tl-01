# Extensão: Tá Barato · Lista de Ofertas

Coloca um checkbox amarelo **"Adicionar às Ofertas"** em cada produto das
páginas de listagem da Amazon (Ofertas do Dia, busca, mais vendidos...). Ao
marcar, a extensão abre o produto numa aba em segundo plano, usa o próprio
botão **Adicionar à Lista** da Amazon para gravar na lista pública "Ofertas"
(código `2ZUSMM2BR8LVZ`, a mesma que o bot lê) e fecha a aba. O checkbox fica
verde quando a Amazon confirma.

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

A extensão depende do botão "Adicionar à Lista" da página do produto
(`#add-to-wishlist-button` e `#atwl-link-to-list-<código>`). Se a Amazon mudar
essa parte do site, o checkbox fica vermelho com a mensagem do erro; avise
para ajustar os seletores em `background.js`.
