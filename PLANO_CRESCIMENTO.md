# Plano de crescimento: cliques qualificados e vendas

Análise de 29/09/2026. Escopo: código do site, blog, seleção de ofertas e relatórios; inspeção do site público em computador e celular. O plano abaixo foi parcialmente executado no código do projeto; o estado e as dependências restantes estão registrados em “Execução deste plano”.

## Objetivo e limites da análise

Aumentar o número de visitantes que encontram um produto adequado, chegam à loja correta e geram comissão aprovada. Mais cliques, isoladamente, não demonstram mais vendas.

Não foram consultados os relatórios privados do Google Analytics, Search Console ou os painéis de vendas das lojas. Portanto, não é possível quantificar perdas atuais, identificar o canal mais rentável ou projetar receita. Os prazos abaixo são uma proposta de sequência, não garantia de resultado.

## Diagnóstico comprovado

1. **Produtos muito abaixo da primeira tela.** Na página inicial, com 774 ofertas durante a inspeção, o primeiro botão de produto estava a aproximadamente 2.194 pixels do topo no computador (1280 × 720) e 3.271 pixels no celular (390 × 844). Apresentação, canais sociais, Shopee VIP, atalhos e filtros aparecem antes dos produtos. A hipótese a testar é que reduzir esse caminho aumentará a descoberta e os cliques qualificados.
2. **O guia até R$ 2.000 não tem caminhos de compra nos modelos cadastrados.** Os quatro cards exibiam “Links em atualização”, sem links e sem preço de referência. O texto também recomenda o Galaxy A36, que não aparece nos cards. Constatação limitada à matéria inspecionada; auditar as outras antes de generalizar.
3. **Medição de afiliados incompleta no blog.** Os links dos modelos são externos e diretos; o evento específico `affiliate_click` só cobre `/go/`, `/loja/` e `/cupom/`. Os relatórios internos não incluem esses cliques editoriais. O Google Analytics pode registrar cliques externos genéricos se a medição otimizada estiver habilitada, mas essa configuração não foi verificada.
4. **O indicador chamado CTR não mede a exposição dos cards.** Atualmente divide saídas para lojas por visualizações registradas de páginas. Falta saber qual modelo e posição foram vistos, qual botão foi acionado e qual origem trouxe o leitor. X não tem classificação própria no contador interno de visitas.
5. **Há uma boa base editorial, mas a resposta pode vir antes.** A matéria inspecionada tem fontes, especificações, modelos e conclusão por perfil. Porém o resumo repete a apresentação, e os cards longos precedem a resposta rápida. Não havia tabela comparativa renderizada nesse guia; o sistema depende de um marcador no texto para exibi-la.
6. **A seleção já usa desempenho, mas não é conversão por clique.** O bot considera desconto, comissão, avaliação, vendas, diversidade e resultados históricos. Parte do histórico usa vendas e comissão por publicação. Não deve ser interpretado como taxa de compra dos visitantes.
7. **Vendas de Amazon e Mercado Livre não estão no relatório automático.** O próprio relatório informa essa limitação. Não tratar ausência de vendas registradas como zero vendas nessas lojas.
8. **Dois problemas secundários podem interromper a navegação.** Falha inicial da API aparece como catálogo sem ofertas, sem uma opção clara de tentar novamente; favoritos só consideram produtos já carregados e desativam a paginação.

### O que preservar

- Links oficiais de afiliado, transparência e preços com data de consulta.
- Histórico de preço, páginas de quedas e menores preços já existentes: melhorar sua exposição, não recriar.
- Blog editorial independente das promoções disponíveis.
- Imagens, conteúdo renderizado no servidor, páginas por categoria e infraestrutura atual.
- Anúncios discretos, sem competir com os botões de compra.
- Alertas privados restritos aos problemas relevantes, conforme a preferência já definida.

## Plano de ação de seis semanas

| Etapa | Ações | Responsável principal | Como verificar |
| --- | --- | --- | --- |
| Semana 1: completar a compra | Auditar os 12 artigos publicados; cadastrar todos os modelos efetivamente recomendados; preencher links oficiais, variante, preço de referência e data; eliminar divergências entre texto, cards e tabela. | Você fornece/confirma links de afiliado; desenvolvimento organiza cadastro e validações. | Cada recomendação comercial tem ao menos uma loja disponível; nenhum link leva a modelo ou versão diferente; lacunas ficam sinalizadas no painel. |
| Semana 1: medir corretamente | Registrar artigo, modelo, loja, posição do botão, origem e campanha; medir exposição de cards, busca e buscas sem resultado; incluir X; separar os eventos editoriais no painel. | Desenvolvimento. | Um clique de teste aparece uma única vez com a identificação correta, sem alterar o link oficial nem ser confundido com uma venda. |
| Semana 2: facilitar a escolha | Encurtar a apresentação; colocar busca e produtos cedo; recolher filtros avançados; mover convites sociais e VIP para posições secundárias; destacar poucos produtos relevantes, não apenas os últimos publicados. Corrigir falha de carregamento e favoritos. | Desenvolvimento. | Ao abrir no celular, o visitante encontra um produto ou caminho curto de busca na primeira tela; medir cliques por exposição e sessões com saída para loja. |
| Semana 3: fortalecer os guias | Resumo com vencedores por perfil; cards compactos; prós, contras e “para quem não serve”; tabela consistente de especificações e preços; botões junto da decisão e da conclusão. | Editorial + desenvolvimento. | Todos os modelos citados correspondem aos cards e à tabela; o leitor consegue justificar a escolha e chegar à loja sem procurar pelo botão. |
| Semana 4: captar buscas com intenção | Usar consultas e páginas reais do Search Console para escolher pautas; melhorar títulos, descrições e respostas das páginas existentes; publicar inicialmente até dois conteúdos úteis por semana, se houver capacidade de revisar. | Editorial. | Acompanhar impressões, cliques orgânicos e saídas para lojas por artigo; não produzir páginas quase iguais para a mesma dúvida. |
| Semanas 5–6: melhorar ofertas e canais | Analisar comissão aprovada por clique e por publicação, onde houver dados; testar horários e chamadas por canal; aumentar peso de preço historicamente bom, relevância e disponibilidade. | Desenvolvimento + acompanhamento dos painéis das lojas. | Comparar resultados em períodos equivalentes; considerar atraso de atribuição e cancelamentos; manter diversidade e espaço para produtos novos. |

Esforço relativo: completar cadastros é baixo em desenvolvimento, mas exige dados corretos; medição e página inicial têm esforço médio; conteúdo é trabalho contínuo; ajustar a seleção com atribuição confiável tem esforço médio/alto. Não executar tudo simultaneamente.

## Execução deste plano

Implementado no código em 29/09/2026: busca rápida e catálogo mais cedo na página inicial; filtros recolhidos no celular; nova tentativa quando o catálogo falha; inclusão dos favoritos ainda não carregados; eventos agregados de exposição e clique dos modelos editoriais por matéria, modelo, loja, posição e origem; suporte a X nos relatórios; guia rápido no resumo da matéria sem duplicar o trecho no corpo; e alertas no painel para modelos publicados sem preço ou link.

Para ativar a medição em produção, publicar esta versão. O primeiro evento válido cria a tabela e o índice de `site/migrations/0017_metricas_cliques_editoriais.sql` de forma idempotente; o arquivo permanece disponível para a gestão formal das migrações no D1. O pacote de código não preenche links afiliados, preços ou dados de vendas: esses dados precisam ser cadastrados/revisados no painel e nas plataformas. A auditoria dos demais artigos e a escolha de novas pautas ainda dependem dos relatórios privados do Search Console, que não foram acessados nesta execução.

## Formato recomendado para os artigos

1. Resposta curta à dúvida: qual modelo atende a cada perfil e por quê.
2. Seleção compacta dos modelos com foto fiel, versão exata, preço de referência datado e opções de compra.
3. Comparação prática: processador/desempenho, memória, tela, câmera, autonomia, carregamento, atualizações, garantia e limitações relevantes ao tema.
4. Prós, contras e perfil de uso de cada modelo, sem comparar acessórios com produtos de outra função.
5. Tabela com as mesmas informações para todos, seguida de conclusão e alternativas.
6. Fontes, método, autoria e data da última revisão efetiva.

Explicar o efeito das especificações: “120 Hz” precisa ser traduzido para a experiência de uso; megapixels não demonstram qualidade fotográfica; capacidade da bateria não demonstra autonomia real. Não inventar benchmarks, fotos de teste ou experiência prática. Quando o trabalho for documental, identificá-lo como análise de fichas técnicas.

Os guias por orçamento precisam de preços verificáveis para a variante indicada. Se um modelo só cabe no teto em promoção, deixar a condição explícita e apresentar alternativa normalmente acessível. Preço editorial de referência não equivale a preço garantido de todas as lojas.

O Google recomenda comparações úteis, benefícios e limitações fundamentados, evidências e opções de vendedores. Isso orienta a qualidade, sem garantir posição nas buscas: [orientações oficiais para avaliações](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews).

### Pautas a validar, não demanda comprovada

- Comparativo entre dois modelos exatos e da mesma faixa.
- Melhor celular para um perfil e orçamento específicos.
- Versões de memória do mesmo aparelho: quando pagar a diferença.
- NFC, atualizações ou resistência: quais modelos atendem à necessidade.

Priorizar as consultas que já geram impressões no Search Console e podem ser respondidas com conteúdo verificável. Atualizar os guias existentes antes de expandir para muitas categorias.

## Medição e experimentos

### Painel mínimo

- **Busca:** impressões e cliques no Google por consulta e página.
- **Site:** sessões elegíveis, exposição dos cards e sessões com saída de afiliado, por artigo, origem, modelo e dispositivo.
- **Ofertas sociais:** entregas bem-sucedidas e cliques por canal; usar visualizações das redes quando disponíveis, sem chamar cliques/publicações de CTR.
- **Vendas:** pedidos atribuídos, aprovados, cancelados e comissão aprovada, separados por loja e janela de atribuição.
- **Retorno:** comissão aprovada por clique e por publicação; Amazon e Mercado Livre permanecem “dados não disponíveis” até incorporar seus relatórios oficiais.

O indicador atual deve ser apresentado como “cliques de saída por visualização registrada”, não como CTR dos cards. Para medir exposição, registrar cards realmente visíveis, não apenas os inseridos na página.

Preservar links oficiais de Mercado Livre e Amazon. A medição editorial pode ser feita por evento próprio sem interpor redirecionadores adicionais. Não acrescentar parâmetros aos links de afiliado sem verificar as regras de cada programa. Respeitar as escolhas de privacidade e não coletar dados pessoais desnecessários.

Conferir a configuração real do Analytics: [documentação de cliques externos e medição otimizada](https://support.google.com/analytics/answer/9216061?hl=pt-BR).

### Testes em ordem

1. Página inicial atual versus versão com produtos próximos do topo.
2. Resumo descritivo versus resumo com recomendação por perfil.
3. Botão genérico versus “Conferir preço na [loja]”, sem prometer o menor preço.
4. Destaque recente versus destaque selecionado por interesse e preço observado.

Testar uma mudança principal por vez, com grupos comparáveis. Os produtos, horários e fontes de tráfego não podem ser diferenças sistemáticas entre variantes. O teste atual de chamadas distribui variantes por produto; essa limitação precisa ser considerada antes de atribuir uma diferença à redação.

Registrar pelo menos duas semanas completas de referência após validar a medição. Se houver pouco tráfego, prolongar o teste; não anunciar vencedor com poucos cliques. Separar o tráfego orgânico das redes e os dispositivos.

Objetivo inicial sugerido: buscar aumento relativo de 15% nas sessões que chegam a uma loja, sem piorar disponibilidade, comissão por clique ou experiência. É uma meta experimental, não uma previsão. Avaliar vendas conforme o tempo necessário para atribuição e aprovação das comissões.

## Operação, qualidade e custos

- Revisar semanalmente links, preços, variantes, modelos sem cadastro e produtos indisponíveis.
- Manter histórico próprio e aproveitar dados oficiais já acessíveis; não contratar API paga como requisito inicial.
- Verificar desempenho móvel e anúncios com PageSpeed/Core Web Vitals; a inspeção visual não substitui medição de velocidade. [Referência oficial](https://web.dev/articles/vitals).
- Preservar a publicidade discreta. Não aumentar anúncios antes de comparar sua receita com o possível efeito sobre os cliques de afiliado; nunca testar clicando nos próprios anúncios.
- Automatizar pesquisa e rascunhos com fontes, mas manter revisão factual, de modelos e de links antes da publicação. Produção em massa sem revisão não é estratégia de crescimento.
- Depois do piloto, avaliar um catálogo compartilhado de modelos, ligado aos artigos: hoje os registros são específicos de cada matéria. Isso pode evitar cadastrar o mesmo link e especificação repetidamente, mas não deve bloquear os ganhos imediatos.
- Fazer acompanhamento consolidado; não reativar notificações privadas de cada publicação bem-sucedida.
- Usar ferramentas e infraestrutura atuais dentro de seus limites gratuitos. Não há contratação de serviços neste plano; limites de uso e eventuais custos existentes devem ser conferidos antes de ampliar automações.

## Primeiro pacote recomendado

Completar os produtos do guia até R$ 2.000, instrumentar seus cliques e reorganizar a primeira tela da página inicial. Esses três trabalhos tratam obstáculos observáveis. Em seguida, aplicar o formato editorial e as validações às outras matérias, escolhendo novas pautas com dados reais.

## Referências no projeto

- Layout e navegação: `site/public/index.html`, `site/public/app.js`.
- Medição: `site/public/google-analytics.js`, `site/public/analytics.js`, `site/functions/api/stats.js`.
- Cards, tabelas e cadastro editorial: `site/functions/_blog.js`, `site/functions/blog/[slug].js`, `site/functions/_blog_products.js`.
- Histórico de preço já implementado: `site/functions/oferta/[id].js`.
- Seleção, resultados e testes: `main.py`, `store.py`, `relatorio.py`, `experimentos.py`.
