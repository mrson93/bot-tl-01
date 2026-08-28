# Painel privado pelo Telegram

Este Cloudflare Worker recebe comandos do administrador no mesmo bot que envia
os relatórios. Ele não armazena mensagens, IDs, credenciais de lojas ou dados de
vendas. As configurações operacionais e as dez últimas mudanças ficam em GitHub
Actions Variables, nunca em arquivos ou commits.

Não é necessário domínio próprio. A instalação atual usa
`https://deal-signal-control.SUA_CONTA.workers.dev`; os comandos entram
somente pela rota protegida `/telegram`.

## Comandos

- `/painel` ou `/start`: mostra os controles;
- `/status`: modo e última execução bem-sucedida;
- `/executar`: pede confirmação e inicia uma rodada de ofertas imediatamente;
- `/ritmo economico`: aproximadamente 22 Actions por dia;
- `/ritmo normal`: aproximadamente 53 Actions por dia;
- `/ritmo rapido`: aproximadamente 79 Actions por dia;
- `/pausar`: interrompe bot e monitor sem reservar runner;
- `/retomar`: volta no modo econômico;
- `/relatorio`: solicita o relatório privado imediatamente;
- `/config`: abre lojas, filtros, horários, variedade, relatório e seleção;
- `/historico`: mostra as últimas mudanças feitas pelo painel;
- `/definir NOME VALOR`: alternativa avançada, limitada à mesma lista segura.

Os mesmos controles aparecem como botões. A execução manual pede uma confirmação
antes de chamar o GitHub, pois pode resultar em uma nova publicação. Comandos de grupos, canais ou usuários
diferentes de `TELEGRAM_ADMIN_ID` são ignorados sem resposta.

## Proteções

- o Telegram autentica cada webhook com `TELEGRAM_WEBHOOK_SECRET`;
- remetente, conversa privada e administrador precisam ter o mesmo ID autorizado;
- o corpo aceito tem no máximo 32 KiB;
- modos e configurações estão em listas fechadas, sem edição de arquivos pelo Telegram;
- valores passam por faixas seguras, confirmação e proteção contra desligar todas as lojas;
- tokens, destinos, IDs administrativos e chaves de criptografia não são configuráveis pelo bot;
- o token do GitHub pode acessar somente este repositório;
- erros enviados ao administrador não incluem resposta de API, token ou ID;
- não há banco, analytics, cookies ou `console.log` no controlador.

## Implantação

1. Copie `wrangler.toml.example` para `wrangler.toml`.
2. Crie um token de acesso refinado no GitHub, limitado apenas ao repositório
   `bot-ofertas`, com `Actions: read and write` e `Variables: read and write`.
3. Configure estes quatro valores exclusivamente como secrets do Worker:

   - `TELEGRAM_BOT_TOKEN`;
   - `TELEGRAM_ADMIN_ID`;
   - `TELEGRAM_WEBHOOK_SECRET` (valor aleatório, diferente de todos os tokens);
   - `GITHUB_TOKEN`.

4. Publique o Worker e registre como webhook a URL
   `https://SEU-WORKER.workers.dev/telegram`, enviando o mesmo
   `TELEGRAM_WEBHOOK_SECRET` em `secret_token`.
5. Cadastre os comandos do bot com `setMyCommands` e confirme com `getWebhookInfo`.

Na instalação atual, o token temporário usado para publicar no Cloudflare foi
revogado depois da configuração. O token refinado do GitHub expira em
22/11/2026 e deve ser substituído no secret `GITHUB_TOKEN` antes dessa data.

Nunca coloque os quatro secrets no `wrangler.toml`, em commits, prints ou
mensagens. O arquivo real `wrangler.toml` e `.dev.vars` são ignorados pelo Git.

## Funcionamento dos modos

O workflow é iniciado somente pelo painel ou pelo controlador Cloudflare. O controlador consulta
o relógio a cada minuto e despacha o GitHub somente na hora sorteada, sem criar
Actions descartadas. No modo rápido, o intervalo é sorteado entre 8–11 minutos
no pico e 16–22 minutos fora dele.
Se a variável estiver ausente ou inválida, o modo Econômico é usado.

## Configurações operacionais

O painel grava somente variáveis permitidas. É possível controlar:

- ativação, preferência e páginas consultadas de cada loja;
- desconto, nota, vendas, preço e comissão mínimos;
- início, fim, horários de pico e ofertas por rodada;
- intervalo de um a três minutos entre posts da mesma rodada;
- repetição, queda de preço e proteção contra produtos semelhantes;
- horário do relatório, alertas e falhas consecutivas;
- peso da comissão, validade do histórico e teste A/B.

O Worker verifica o relógio a cada minuto, mas inicia uma Action apenas quando
chega a hora sorteada da próxima rodada ou do relatório. O botão **Restaurar
padrões** preserva credenciais e o modo de ritmo atual.
