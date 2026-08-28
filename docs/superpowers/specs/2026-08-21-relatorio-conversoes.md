# Especificação: relatório privado de conversões

## Objetivo

Ampliar o resumo privado já existente para mostrar, sem expor dados de compradores,
as conversões atribuídas ao AliExpress e à Shopee e relacioná-las ao canal de origem.

## Escopo aprovado

- Consultar os últimos sete dias na API oficial `aliexpress.affiliate.order.list`.
- Consultar os estados aceitos pela API, `Payment Completed` e
  `Buyer Confirmed Receipt`.
- Contar como inválidos os pedidos marcados pela API com `FullRefund` ou
  `Antispam` em `effect_detail_status`.
- Somar a comissão estimada informada pela API quando disponível.
- Agrupar pedidos por `tracking_id` para distinguir Telegram e Bluesky.
- Consultar os últimos sete dias no `conversionReport` da API oficial da Shopee.
- Contar conversões Shopee pendentes, concluídas, canceladas e de status desconhecido.
- Somar separadamente a comissão estimada das conversões pendentes e a comissão
  líquida das concluídas.
- Reduzir o `utmContent` da Shopee aos canais `telegram`, `bsky`, `sem_tracking` ou
  `outros`, sem guardar identificadores.
- Acrescentar esses dados ao relatório administrativo enviado por mensagem privada no Telegram.
- Manter no mesmo relatório as entregas do dia anterior por loja e canal.
- Se uma API de conversões falhar, enviar as outras seções e o resumo operacional,
  informando somente a plataforma indisponível, sem impedir as ofertas.

## Limites conhecidos

- As consultas atuais de AliExpress e Shopee informam conversões, não a contagem
  completa de cliques. Cliques só poderão ser medidos futuramente com um
  redirecionador próprio ou outro relatório oficial.
- O relatório continua desativado quando `TELEGRAM_ADMIN_ID` estiver vazio.
- Nenhum número de pedido, dado de comprador ou segredo deve aparecer na mensagem ou nos logs.

## Critérios de aceite

1. Uma resposta vazia do AliExpress gera totais iguais a zero.
2. Pedidos são somados por estado e `tracking_id`.
3. Comissões em formatos numéricos ou texto são convertidas sem quebrar o relatório.
4. Erro de rede ou de API não impede o resumo operacional nem a postagem de ofertas.
5. O relatório é enviado no máximo uma vez por dia ao administrador configurado.
6. Todos os testes existentes continuam passando.
7. A paginação Shopee usa `scrollId` escapado e rejeita cursores ausentes ou repetidos.
8. Conversões canceladas ou de status desconhecido da Shopee não entram nas
   comissões nem no tracking válido.

## Desempenho e isolamento

- Quando há oferta liberada, o relatório roda depois da busca, publicação e
  persistência do próximo horário; uma consulta lenta não atrasa ofertas.
- Quando a próxima oferta ainda não venceu, o relatório diário pode ser enviado
  de forma independente antes de a execução terminar.
- A API de pedidos não é chamada quando o AliExpress não está configurado.
- Sem token do Telegram ou conversa administrativa, o relatório retorna sem
  fazer chamadas externas.
