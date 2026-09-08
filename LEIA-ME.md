# Bot automático de ofertas

O bot busca ofertas da Shopee, AliExpress e Amazon, aplica filtros de qualidade e comissão e publica uma oferta por rodada no Telegram e no Bluesky.

## Como funciona

- Ofertas inéditas têm prioridade.
- O mesmo produto não aparece duas vezes no mesmo dia.
- Após isso, ele só volta depois de 7 dias ou se o preço cair pelo menos 15%.
- Cada canal possui seu próprio estado: uma falha no Bluesky não apaga o sucesso do Telegram.
- No modo Econômico, o pico usa 30 minutos e há seis rodadas fora dele, além do relatório.
- No modo Normal, o pico usa 15 minutos e o restante do dia usa 30 minutos.
- No modo Rápido, o pico usa 10 minutos e o restante do dia usa 20 minutos.
- Se não houver oferta, tenta novamente após `RETRY_MINUTES`.
- Quando uma rodada tiver mais de uma oferta, espera três minutos entre cada post.
- Com o repositório privado, a rodada é limitada automaticamente a uma oferta
  para conter o consumo de minutos do GitHub Actions.
- As lojas são consultadas em paralelo e todas as ofertas entram na mesma fila.
- Desconto, comissão e conversão histórica escolhem a melhor oferta; não existe
  mais uma proporção fixa entre Shopee e AliExpress.
- Dentro da mesma prioridade, uma categoria diferente e um título não semelhante
  vencem produtos repetitivos, mesmo que estes tenham uma nota comercial maior.
- A influência histórica usa conversão por publicação, comissão, recência e
  cancelamentos, sempre com limites para amostras pequenas.

O modo Econômico reserva cerca de 21 execuções diárias do bot e uma do monitor.
O modo Normal reserva cerca de 52 execuções do bot e uma do monitor.
O modo Rápido reserva cerca de 78 execuções do bot e uma do monitor. Grades
inativas e chamadas antigas do cron-job.org sem a opção
`executar_bot` são ignoradas antes de reservar uma máquina e não consomem minutos.
Nas execuções em nuvem, a grade escolhida pelo Telegram é a única trava de ritmo;
o espaçamento interno permanece disponível apenas para instalações locais.

## Painel privado pelo Telegram

O controlador em `telegram-control/` permite selecionar os modos Econômico,
Normal, Rápido e Pausado, consultar o status, solicitar o relatório e ajustar
as configurações operacionais pelo próprio Telegram. O menu `⚙️ Configurações`
controla lojas, pesos comerciais, filtros, horários, variedade, relatório,
campanhas recorrentes e teste A/B. Cada mudança exige confirmação e fica no histórico privado do painel.
Ele funciona em um endereço gratuito `workers.dev`, aceita somente o administrador
em conversa privada e altera somente uma lista fechada de variáveis não secretas
do GitHub. Senhas, tokens e chaves nunca entram no painel. Consulte
`telegram-control/README.md` para implantação e renovação da credencial restrita.

## Configuração

As credenciais ficam no GitHub Secrets ou no `.env`. Nunca coloque tokens diretamente no código.

Novas variáveis:

| Variável | Padrão | Função |
|---|---:|---|
| `QUEDA_PRECO_REPOST_PERCENT` | `15` | Queda mínima para antecipar uma repetição |
| `HTTP_MAX_TENTATIVAS` | `3` | Tentativas em falhas temporárias |
| `TELEGRAM_ADMIN_ID` | vazio | Conversa privada que recebe o resumo diário |
| `RELATORIO_HORA` | `11` | Hora a partir da qual o resumo pode ser enviado |
| `RELATORIO_MINUTO` | `30` | Minuto a partir do qual o resumo pode ser enviado |
| `RELATORIO_ALERTA_MIN_POSTS` | `10` | Posts sem conversão necessários para gerar alerta |
| `FALHAS_CONSECUTIVAS_ALERTA` | `3` | Falhas seguidas necessárias para gerar alerta |
| `SHOPEE_ATIVA` | `true` | Permite desligar a Shopee sem apagar credenciais |
| `ALIEXPRESS_ATIVA` | `true` | Permite desligar o AliExpress sem apagar credenciais |
| `AMAZON_ATIVA` | `false` | Ativa a Amazon depois que suas credenciais existirem |
| `PESO_SHOPEE` | `1` | Preferência moderada da Shopee na fila global |
| `PESO_ALIEXPRESS` | `1` | Preferência moderada do AliExpress na fila global |
| `PESO_AMAZON` | `1` | Preferência moderada da Amazon na fila global |
| `INTERVALO_ENTRE_POSTS_MINUTOS` | `3` | Espera entre posts da mesma rodada |
| `DIVERSIDADE_JANELA_POSTS` | `3` | Publicações recentes consideradas na variedade |
| `SIMILARIDADE_MAXIMA` | `0.55` | Limite de semelhança entre títulos |
| `DESEMPENHO_MAX_DIAS` | `14` | Idade máxima dos dados usados na seleção |
| `AB_TEST_ATIVO` | `true` | Compara chamada humana (A) com objetiva (B) |
| `MIN_MINUTOS_FORA_PICO` | `30` | Menor intervalo fora dos horários de pico |
| `MAX_MINUTOS_FORA_PICO` | `30` | Maior intervalo fora dos horários de pico |
| `SHORTLINK_API_URL` | vazio | API opcional do redirecionador próprio |
| `SHORTLINK_BASE_URL` | vazio | Domínio público aprovado dos links curtos |
| `SHORTLINK_API_TOKEN` | vazio | Token administrativo do redirecionador |
| `CUPOM_ALERTA_SEPARADO` | `true` | Publica alerta exclusivo para cupom retornado oficialmente pela API |
| `SHOPEE_CAMPANHAS_CUPOM` | `true` | Busca cupons e vouchers nas campanhas da API afiliada da Shopee |
| `CUPOM_ALERTAS_POR_RODADA` | `1` | Máximo de alertas exclusivos de cupom por execução |
| `CUPOM_RESUMO_HORAS` | `12,20` | Horas de Brasília para o resumão de cupons ativos |
| `CUPOM_RESUMO_MAX_ITENS` | `5` | Máximo de cupons listados em cada resumo |
| `SHOPEE_VIP_URL` | vazio | Link afiliado oficial da assinatura, definido fora do painel do Telegram |
| `SHOPEE_VIP_ATIVO` | `true` | Ativa banner no site e divulgação recorrente no Telegram |
| `SHOPEE_VIP_DIAS` | `0,2,5` | Segunda, quarta e sábado (`0` é segunda e `6` é domingo) |
| `SHOPEE_VIP_HORAS` | `10,11,19,20` | Janelas da manhã e da noite para divulgar o VIP |

Para descobrir o `TELEGRAM_ADMIN_ID`, envie uma mensagem privada ao bot e consulte `https://api.telegram.org/botSEU_TOKEN/getUpdates`. Copie somente o número de `chat.id` para um GitHub Secret; não compartilhe a URL preenchida.

### Relatório privado

Depois de configurar `TELEGRAM_ADMIN_ID`, o bot envia uma vez por dia:

- entregas e falhas do dia anterior por canal e loja;
- pedidos pagos, confirmados e inválidos do AliExpress nos últimos 7 dias;
- comissão do AliExpress na moeda informada pela plataforma;
- conversões pendentes, concluídas e canceladas da Shopee nos últimos 7 dias;
- comissão estimada e líquida da Shopee em reais;
- conversões separadas pelos trackings `telegram` e `bsky`;
- produtos, horários, categorias, faixas de preço e desconto que converteram;
- alertas de muitas publicações sem conversão e exemplos recentes sem venda;
- cliques por canal e loja quando o redirecionador próprio estiver ativado.
- tendência semanal baseada em séries diárias de até 180 dias;
- resultado do teste A/B depois de cada variante atingir dez publicações.

Na nuvem, o controlador verifica o horário do relatório a cada 15 minutos e só
dispara o workflow no momento escolhido. Assim, mudar hora e minuto pelo Telegram
não cria consultas extras de ofertas nem reserva máquinas do GitHub nas verificações.

O relatório nunca solicita nem mostra números de pedidos ou dados de compradores. A
API oficial da Shopee fornece conversões, mas não fornece a contagem completa de
cliques nessa consulta. O redirecionador opcional está em `redirector/` e permanece
desligado até o domínio ser aprovado nos programas de afiliados e configurado no
Cloudflare. Se ele falhar, o bot usa automaticamente o link oficial de afiliado.

## Formato das ofertas

- Abaixo de 40%: sem chamada exagerada.
- De 40% a 70%: `OFERTA`.
- Acima de 70%: `BAIXOU MUITO`.
- O preço anterior só aparece quando a plataforma o informa oficialmente.
- Cupom e preço de aplicativo só aparecem quando a API os informa; atualmente o
  AliExpress oferece esses campos e a consulta de produtos da Shopee não.
- Quando a API também informar uma página oficial de resgate, o bot pode publicar
  um alerta exclusivo de cupom e incluí-lo em um resumão de cupons ativos. A
  mensagem permanece no canal mesmo depois do vencimento; apenas deixa de entrar
  nos próximos resumos.
- A primeira linha pode usar uma frase curta relacionada à categoria do produto.
- O Telegram mantém um único botão/caminho de compra; o convite para compartilhar
  fica fora dos posts de oferta.
- O Bluesky mostra avaliação e quantidade vendida quando esses dados existem.
- Se a imagem falhar, o Telegram publica a oferta em texto.
- O Shopee VIP pode ser divulgado uma vez pela manhã e outra à noite nos dias
  configurados. Um alerta urgente de cupom sempre passa na frente e adia a campanha.
- O banner do VIP aparece na página inicial e na página de cupons somente quando
  o link oficial estiver ativo no site. Os cliques são contados de forma agregada.

### Links próprios

O código do redirecionador usa Cloudflare Worker + D1, não registra IP nem comprador
e está documentado em `redirector/README.md`. Não ative as variáveis `SHORTLINK_*`
antes de cadastrar o domínio como mídia aprovada e validar uma compra de teste em
cada programa.

### Estado remoto e automações

O banco `postadas.db` é restaurado de um artefato privado chamado `bot-state`,
validado com `PRAGMA integrity_check` e salvo novamente somente quando mudar.
O artefato tem retenção de 90 dias. O backup anterior à migração continua na
branch de segurança.

Os testes Python e os testes do controlador rodam no workflow `Testes` apenas
quando o código muda. O GitHub usa a grade selecionada em `BOT_MODE`. O workflow
`Monitor do Bot` confere uma vez ao dia se houve execução recente; no modo Pausado,
ele também é ignorado sem reservar runner. Falhas do
próprio bot continuam gerando alerta privado imediatamente.

Modelo equivalente para o Botize:

```text
{{titulo}}

💰 De {{preco_anterior}} por {{preco_atual}}

🏬 Amazon

🛒 COMPRAR NA AMAZON
{{link_afiliado}}
```

Se o Botize não fornecer preço anterior real, use apenas `💰 {{preco_atual}}`.

## Comandos

```text
python main.py --check
python main.py --once
python main.py --relatorio
python -m unittest discover -v
```

`--relatorio` força um envio privado imediato, sem buscar ou publicar ofertas.
No GitHub Actions, marque **Enviar agora apenas o relatorio privado** ao executar
o workflow manualmente.

## Backup e segurança

O ponto de restauração imediatamente anterior a estas melhorias está na branch
`codex/backup-relatorio-shopee-2026-08-21`, commit `62404a0`.

Tokens que já tenham sido enviados em mensagens ou prints devem ser revogados e recriados. Isso inclui Telegram, Bluesky, AliExpress, Shopee, Amazon e o token usado pelo cron-job.org.
