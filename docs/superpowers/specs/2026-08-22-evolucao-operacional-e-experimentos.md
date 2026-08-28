# Evolução operacional e experimentos — 2026-08-22

## Objetivo

Reduzir repetição, custo e risco operacional, preservando dados comerciais por
mais tempo e permitindo decisões mensuráveis sobre texto e seleção de ofertas.

## Decisões

- Produtos semelhantes perdem prioridade quando existe alternativa operacionalmente equivalente.
- A variante A usa chamada humana; a B começa pelo conteúdo objetivo. A atribuição
  deriva somente do identificador público da oferta e permanece estável.
- O multiplicador histórico usa suavização para não supervalorizar poucas vendas,
  comissão por post, recência e cancelamentos, limitado entre 0,75 e 1,50.
- Métricas diárias agregadas são retidas por 180 dias; pedido e comprador não são persistidos.
- Testes saem do workflow chamado pelo cron e passam para CI em mudanças de código.
- O SQLite é transferido em duas fases para um artefato privado de 90 dias. O
  arquivo remoto é baixado sem reenviar o token ao host de armazenamento e passa
  por verificação de integridade antes de substituir o estado local.
- Um monitor independente verifica a execução do bot duas vezes ao dia; falhas
  do próprio workflow continuam alertando imediatamente.

## Migração segura concluída

1. O banco mais recente do histórico foi usado como semente sem ser reenviado no commit.
2. A execução inicial criou e validou o artefato privado `bot-state`.
3. A restauração passou a ser obrigatória e o banco foi removido do versionamento.
4. Toda execução valida o SQLite antes de publicar qualquer oferta.
