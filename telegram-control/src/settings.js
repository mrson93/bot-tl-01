export const CATEGORIES = Object.freeze({
  lojas: { label: "🏪 Lojas", description: "Ativação, preferência e profundidade das buscas" },
  filtros: { label: "🎯 Filtros", description: "Requisitos mínimos para uma oferta" },
  horarios: { label: "⏱ Horários", description: "Janela de publicação, pico e volume" },
  variedade: { label: "🔁 Variedade", description: "Repetição e produtos semelhantes" },
  relatorio: { label: "📊 Relatório", description: "Horário e limites dos alertas" },
  cupons: { label: "🎟 Cupons", description: "Alertas e resumo de cupons oficiais" },
  selecao: { label: "🧪 Seleção", description: "Comissão, histórico e teste A/B" },
});

export const SETTINGS = Object.freeze({
  SHOPEE_ATIVA: {
    category: "lojas", label: "Shopee ativa", type: "boolean", default: "true",
    hint: "Ativa ou desativa a busca de ofertas da Shopee.",
  },
  ALIEXPRESS_ATIVA: {
    category: "lojas", label: "AliExpress ativo", type: "boolean", default: "true",
    hint: "Ativa ou desativa a busca de ofertas do AliExpress.",
  },
  AMAZON_ATIVA: {
    category: "lojas", label: "Amazon ativa", type: "boolean", default: "false",
    hint: "Só terá efeito quando as credenciais da Amazon estiverem configuradas.",
  },
  PESO_SHOPEE: {
    category: "lojas", label: "Preferência Shopee", type: "float", default: "1", min: 0.5, max: 2,
    hint: "1 é neutro; 1,2 aumenta a prioridade em 20%; 0,8 reduz em 20%.",
  },
  PESO_ALIEXPRESS: {
    category: "lojas", label: "Preferência AliExpress", type: "float", default: "1", min: 0.5, max: 2,
    hint: "1 é neutro; use apenas ajustes pequenos para preservar a qualidade.",
  },
  PESO_AMAZON: {
    category: "lojas", label: "Preferência Amazon", type: "float", default: "1", min: 0.5, max: 2,
    hint: "1 é neutro; só terá efeito quando a Amazon estiver configurada.",
  },
  SHOPEE_PAGES: {
    category: "lojas", label: "Páginas Shopee", type: "integer", default: "3", min: 1, max: 5,
    hint: "Mais páginas encontram mais produtos, mas aumentam o tempo da consulta.",
  },
  PICO_PRIORIZA_MAIS_VENDIDOS: {
    category: "selecao", label: "Campeões Shopee no pico", type: "boolean", default: "true",
    hint: "Reserva a primeira vaga do horário de pico para um campeão de vendas que passe em todos os filtros.",
  },
  PICO_JANELA_VENDAS_DIAS: {
    category: "selecao", label: "Janela de vendas Shopee", type: "integer", default: "7", min: 1, max: 30,
    hint: "Dias usados para estimar o crescimento das vendas com base no histórico observado pelo bot.",
  },
  ALIEXPRESS_PAGES: {
    category: "lojas", label: "Páginas AliExpress", type: "integer", default: "6", min: 1, max: 8,
    hint: "O valor atual foi aumentado para reduzir rodadas sem ofertas inéditas.",
  },
  AMAZON_PAGES: {
    category: "lojas", label: "Páginas Amazon", type: "integer", default: "3", min: 1, max: 5,
    hint: "Só terá efeito quando a Amazon estiver configurada.",
  },

  MIN_DISCOUNT: {
    category: "filtros", label: "Desconto mínimo (%)", type: "float", default: "15", min: 0, max: 90,
    hint: "Produtos abaixo deste desconto são descartados.",
  },
  MIN_RATING: {
    category: "filtros", label: "Nota mínima", type: "float", default: "4", min: 0, max: 5,
    hint: "Produtos sem avaliação continuam permitidos.",
  },
  MIN_SALES: {
    category: "filtros", label: "Vendas mínimas", type: "integer", default: "50", min: 0, max: 1000000,
    hint: "Lojas que não informam vendas, como a Amazon, não usam este filtro.",
  },
  MIN_PRICE: {
    category: "filtros", label: "Preço mínimo (R$)", type: "float", default: "10", min: 0, max: 10000,
    hint: "Evita ofertas muito baratas que ocupam espaço e geram pouco retorno.",
  },
  MIN_GANHO: {
    category: "filtros", label: "Comissão mínima (R$)", type: "float", default: "3", min: 0, max: 1000,
    hint: "Estimativa mínima de comissão por venda.",
  },
  DESCONTO_PREFERIDO: {
    category: "filtros", label: "Desconto preferido (%)", type: "float", default: "30", min: 0, max: 90,
    hint: "Abaixo deste valor, só entram produtos com forte prova comercial, comissão ou cupom.",
  },
  VENDAS_EXCECAO_DESCONTO: {
    category: "filtros", label: "Vendas para exceção", type: "integer", default: "1000", min: 0, max: 1000000,
    hint: "Vendas mínimas para aceitar um desconto abaixo do preferido, com nota alta.",
  },

  HORA_INICIO: {
    category: "horarios", label: "Começar a publicar", type: "startHour", default: "6",
    hint: "Use uma hora entre 6 e 23. O bot não consulta entre 1h e 5h59.",
  },
  HORA_FIM: {
    category: "horarios", label: "Parar de publicar", type: "endHour", default: "0",
    hint: "Use 0 ou uma hora entre 6 e 23. Zero significa até 00h59.",
  },
  HORAS_PICO: {
    category: "horarios", label: "Horas de pico", type: "hours", default: "12,13,18,19,20,21,22",
    hint: "Informe até 12 horas separadas por vírgula, por exemplo: 12,13,18,19,20,21,22.",
  },
  MAX_POSTS_PER_RUN: {
    category: "horarios", label: "Ofertas por rodada", type: "integer", default: "1", min: 1, max: 3,
    hint: "Limite nas horas de pico, somando todas as lojas. Em repositório privado, o GitHub limita a uma oferta.",
  },
  MAX_POSTS_PER_RUN_FORA_PICO: {
    category: "horarios", label: "Ofertas por rodada fora do pico", type: "integer", default: "1", min: 1, max: 3,
    hint: "Limite nas demais horas. Não pode superar o limite das horas de pico.",
  },
  INTERVALO_ENTRE_POSTS_MINUTOS: {
    category: "horarios", label: "Intervalo entre posts (min)", type: "integer", default: "3", min: 1, max: 3,
    hint: "Só vale quando a rodada tiver mais de uma oferta. Três minutos deixam o canal mais natural.",
  },
  MAX_POSTS_POR_DIA: {
    category: "horarios", label: "Limite diário de ofertas", type: "integer", default: "50", min: 0, max: 150,
    hint: "Zero desliga o limite. O recomendado é de 40 a 60 ofertas por dia.",
  },

  DIAS_ANTES_DE_REPETIR: {
    category: "variedade", label: "Dias antes de repetir", type: "integer", default: "7", min: 1, max: 30,
    hint: "Tempo normal antes de um mesmo produto poder voltar ao canal.",
  },
  QUEDA_PRECO_REPOST_PERCENT: {
    category: "variedade", label: "Queda para repetir antes (%)", type: "float", default: "15", min: 1, max: 90,
    hint: "Permite repetir antes do prazo se o preço cair pelo menos este percentual.",
  },
  DIVERSIDADE_JANELA_POSTS: {
    category: "variedade", label: "Janela de variedade", type: "integer", default: "3", min: 1, max: 20,
    hint: "Quantidade de publicações recentes usada para evitar produtos parecidos.",
  },
  SIMILARIDADE_MAXIMA: {
    category: "variedade", label: "Similaridade máxima", type: "float", default: "0.68", min: 0.2, max: 0.95,
    hint: "Quanto menor, mais rígida é a proteção contra produtos semelhantes.",
  },
  DIAS_BLOQUEIO_PRODUTO_SEMELHANTE: {
    category: "variedade", label: "Bloqueio de produto semelhante", type: "integer", default: "3", min: 1, max: 30,
    hint: "Impede que o mesmo produto volte com outro anúncio, vendedor ou identificador.",
  },
  MAX_POSTS_POR_LOJA_DIA: {
    category: "variedade", label: "Máximo por loja ao dia", type: "integer", default: "3", min: 0, max: 20,
    hint: "Zero desliga o limite. Evita que um único vendedor domine o canal.",
  },

  RELATORIO_HORA: {
    category: "relatorio", label: "Hora do relatório", type: "integer", default: "11", min: 0, max: 23,
    hint: "O controlador verifica o horário a cada 15 minutos.",
  },
  RELATORIO_MINUTO: {
    category: "relatorio", label: "Minuto do relatório", type: "choice", default: "30", choices: ["0", "15", "30", "45"],
    hint: "Escolha 0, 15, 30 ou 45.",
  },
  RELATORIO_ALERTA_MIN_POSTS: {
    category: "relatorio", label: "Posts para alerta sem venda", type: "integer", default: "10", min: 1, max: 100,
    hint: "Gera alerta quando uma loja acumula esta quantidade de posts sem conversão.",
  },
  FALHAS_CONSECUTIVAS_ALERTA: {
    category: "relatorio", label: "Falhas para alertar", type: "integer", default: "3", min: 1, max: 10,
    hint: "Quantidade de falhas consecutivas antes do aviso operacional.",
  },

  CUPOM_ALERTA_SEPARADO: {
    category: "cupons", label: "Alerta separado de cupom", type: "boolean", default: "true",
    hint: "Só publica quando a API afiliada informar código e página oficial de resgate.",
  },
  CUPOM_ALERTAS_POR_RODADA: {
    category: "cupons", label: "Alertas de cupom por rodada", type: "integer", default: "1", min: 0, max: 2,
    hint: "Zero pausa alertas separados; o cupom continua aparecendo na oferta quando disponível.",
  },
  CUPOM_RESUMO_HORAS: {
    category: "cupons", label: "Horas do resumo de cupons", type: "hours", default: "12,20",
    hint: "Até 12 horas, separadas por vírgula. Em cada horário, o resumo sai uma vez se houver cupom ativo.",
  },
  CUPOM_RESUMO_MAX_ITENS: {
    category: "cupons", label: "Máximo no resumo", type: "integer", default: "5", min: 1, max: 10,
    hint: "Limite para manter o resumão curto e fácil de consultar.",
  },

  PESO_COMISSAO: {
    category: "selecao", label: "Peso da comissão", type: "float", default: "1", min: 0, max: 3,
    hint: "Zero ignora comissão; 1 mantém o equilíbrio atual entre desconto e retorno.",
  },
  DESEMPENHO_MAX_DIAS: {
    category: "selecao", label: "Validade do histórico (dias)", type: "integer", default: "14", min: 1, max: 90,
    hint: "Por quantos dias conversões antigas influenciam a seleção.",
  },
  AB_TEST_ATIVO: {
    category: "selecao", label: "Teste A/B de chamada", type: "boolean", default: "true",
    hint: "Compara chamadas humanas com aberturas objetivas.",
  },
  TITULO_MAX_CARACTERES: {
    category: "selecao", label: "Tamanho máximo do título", type: "integer", default: "90", min: 45, max: 140,
    hint: "Remove excesso de palavras sem esconder preço, link ou reputação.",
  },
});

export const AUDIT_VARIABLE = "BOT_CONFIG_AUDIT";
export const STORE_KEYS = Object.freeze(["SHOPEE_ATIVA", "ALIEXPRESS_ATIVA", "AMAZON_ATIVA"]);

export function settingsForCategory(category) {
  return Object.entries(SETTINGS).filter(([, setting]) => setting.category === category);
}

export function effectiveValue(key, variables = {}) {
  const setting = SETTINGS[key];
  if (!setting) return "";
  const value = String(variables[key] ?? "").trim();
  return value || setting.default;
}

function normalizedNumber(number) {
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(3)));
}

export function validateSetting(key, rawValue) {
  const setting = SETTINGS[key];
  if (!setting) return { ok: false, error: "Configuração não permitida." };
  const raw = String(rawValue ?? "").trim().replace(",", ".");

  if (setting.type === "boolean") {
    const lowered = raw.toLowerCase();
    if (["true", "1", "sim", "on", "ativar", "ativo"].includes(lowered)) return { ok: true, value: "true" };
    if (["false", "0", "nao", "não", "off", "desativar", "inativo"].includes(lowered)) return { ok: true, value: "false" };
    return { ok: false, error: "Escolha Ativar ou Desativar." };
  }

  if (setting.type === "hours") {
    const pieces = String(rawValue ?? "").split(/[\s,;]+/).filter(Boolean);
    const hours = [...new Set(pieces.map((piece) => Number(piece)))];
    if (!hours.length || hours.length > 12 || hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23 || (hour > 0 && hour < 6))) {
      return { ok: false, error: "Informe de 1 a 12 horas válidas. O bot não funciona entre 1h e 5h59." };
    }
    return { ok: true, value: hours.sort((a, b) => a - b).join(",") };
  }

  if (setting.type === "choice") {
    if (!setting.choices.includes(raw)) return { ok: false, error: `Escolha: ${setting.choices.join(", ")}.` };
    return { ok: true, value: raw };
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, error: "Informe somente um número válido." };
  if (setting.type === "integer" && !Number.isInteger(value)) return { ok: false, error: "Informe um número inteiro." };
  if (setting.type === "startHour" && (!Number.isInteger(value) || value < 6 || value > 23)) {
    return { ok: false, error: "A hora inicial deve estar entre 6 e 23." };
  }
  if (setting.type === "endHour" && (!Number.isInteger(value) || (value !== 0 && (value < 6 || value > 23)))) {
    return { ok: false, error: "A hora final deve ser 0 ou estar entre 6 e 23." };
  }
  if (setting.min !== undefined && value < setting.min) return { ok: false, error: `O mínimo permitido é ${setting.min}.` };
  if (setting.max !== undefined && value > setting.max) return { ok: false, error: `O máximo permitido é ${setting.max}.` };
  return { ok: true, value: normalizedNumber(value) };
}

export function displayValue(key, value) {
  const setting = SETTINGS[key];
  if (!setting) return String(value);
  if (setting.type === "boolean") return String(value) === "true" ? "Ativo" : "Desativado";
  if (key === "HORAS_PICO") return `${value}h`;
  if (key === "HORA_INICIO" || key === "HORA_FIM" || key === "RELATORIO_HORA") return `${String(value).padStart(2, "0")}h`;
  if (key === "RELATORIO_MINUTO") return `${String(value).padStart(2, "0")} min`;
  return String(value).replace(".", ",");
}

export function defaultValues() {
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, setting]) => [key, setting.default]));
}
