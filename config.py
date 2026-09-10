"""Le as configuracoes do arquivo .env e deixa disponiveis para o resto do bot."""
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()  # carrega o arquivo .env que fica ao lado deste codigo


def _get(nome, padrao=""):
    return os.getenv(nome, padrao).strip()


def _int(nome, padrao):
    try:
        return int(_get(nome) or padrao)
    except ValueError:
        return padrao


def _float(nome, padrao):
    try:
        return float((_get(nome) or padrao))
    except ValueError:
        return padrao


def _bool(nome, padrao=False):
    valor = _get(nome)
    if not valor:
        return bool(padrao)
    return valor.lower() in {"1", "true", "yes", "sim", "on"}


def _normalizar_canal(valor: str) -> str:
    """Aceita @usuario, link t.me/usuario ou ID numerico e devolve o formato
    que o Telegram entende (@usuario ou -100...)."""
    valor = valor.strip()
    if not valor:
        return valor
    # link do tipo https://t.me/usuario  ->  @usuario
    if "t.me/" in valor:
        parte = valor.split("t.me/", 1)[1].strip("/")
        # links privados (com + ou joinchat) NAO servem como destino de postagem
        if parte.startswith("+") or parte.startswith("joinchat"):
            return valor  # deixa como esta; validar() vai avisar
        return "@" + parte
    # ja e ID numerico (ex: -1001234567890)
    if valor.lstrip("-").isdigit():
        return valor
    # ja veio como @usuario ou usuario simples
    return valor if valor.startswith("@") else "@" + valor


# --- Telegram ---
TELEGRAM_BOT_TOKEN = _get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHANNEL = _normalizar_canal(_get("TELEGRAM_CHANNEL"))
# id de rastreio so deste canal (crie no painel da loja). Vazio = usa o padrao.
TELEGRAM_TRACKING_ID = _get("TELEGRAM_TRACKING_ID")

# --- Bluesky ---
BLUESKY_HANDLE = _get("BLUESKY_HANDLE")          # ex: seucanal.bsky.social
BLUESKY_APP_PASSWORD = _get("BLUESKY_APP_PASSWORD")  # senha de app (Settings > App Passwords)
BLUESKY_PDS = _get("BLUESKY_PDS") or "https://bsky.social"
# id de rastreio so deste canal (crie no painel da loja). Vazio = usa o padrao.
BLUESKY_TRACKING_ID = _get("BLUESKY_TRACKING_ID")

# --- Facebook Page (Graph API) ---
# Comeca desligado: criar o aplicativo na Meta nao autoriza publicacoes ate que
# o ID e o token da pagina sejam configurados com pages_manage_posts.
FACEBOOK_ATIVO = _bool("FACEBOOK_ATIVO", False)
FACEBOOK_PAGE_ID = _get("FACEBOOK_PAGE_ID")
FACEBOOK_PAGE_ACCESS_TOKEN = _get("FACEBOOK_PAGE_ACCESS_TOKEN")
FACEBOOK_GRAPH_API_VERSION = _get("FACEBOOK_GRAPH_API_VERSION") or "v26.0"
FACEBOOK_TRACKING_ID = _get("FACEBOOK_TRACKING_ID") or "facebook"
FACEBOOK_MAX_POSTS_DIA = max(1, _int("FACEBOOK_MAX_POSTS_DIA", 4))

# --- Shopee ---
SHOPEE_APP_ID = _get("SHOPEE_APP_ID")
SHOPEE_SECRET = _get("SHOPEE_SECRET")
SHOPEE_SUBID = _get("SHOPEE_SUBID") or "telegram"
SHOPEE_ATIVA = _bool("SHOPEE_ATIVA", True)
PESO_SHOPEE = _float("PESO_SHOPEE", 1.0)
# Listas usadas na busca: 0 = padrao (mais variedade e comissao maior),
# 2 = campeoes de venda (muito mais popular, comissao menor). Buscamos as duas
# e deixamos a pontuacao escolher. SHOPEE_PAGES vale por lista.
SHOPEE_LIST_TYPES = [int(x) for x in (_get("SHOPEE_LIST_TYPES") or "0,2").split(",")
                     if x.strip().lstrip("-").isdigit()]
SHOPEE_KEYWORD = _get("SHOPEE_KEYWORD")
SHOPEE_FETCH_LIMIT = _int("SHOPEE_FETCH_LIMIT", 50)
# quantas paginas buscar por rodada (mais paginas = mais ofertas ineditas)
SHOPEE_PAGES = _int("SHOPEE_PAGES", 3)
# No pico, reserva a primeira vaga da rodada para um item da lista oficial de
# campeões. O histórico local estima a aceleração de vendas em 1 e 7 dias.
PICO_PRIORIZA_MAIS_VENDIDOS = _bool("PICO_PRIORIZA_MAIS_VENDIDOS", True)
PICO_JANELA_VENDAS_DIAS = max(1, min(30, _int("PICO_JANELA_VENDAS_DIAS", 7)))

# Campanha recorrente do programa Shopee VIP. O link ja vem pronto do painel
# afiliado; os dias seguem datetime.weekday() (0=segunda, 6=domingo).
SHOPEE_VIP_URL = _get("SHOPEE_VIP_URL")
SHOPEE_VIP_ATIVO = _bool("SHOPEE_VIP_ATIVO", True)
SHOPEE_VIP_DIAS = [int(x) for x in (_get("SHOPEE_VIP_DIAS") or "0,2,5").split(",")
                   if x.strip().isdigit() and 0 <= int(x) <= 6]
SHOPEE_VIP_HORAS = [int(x) for x in (_get("SHOPEE_VIP_HORAS") or "10,11,19,20").split(",")
                    if x.strip().isdigit() and 0 <= int(x) <= 23]

# --- AliExpress (API de afiliado) ---
ALIEXPRESS_APP_KEY = _get("ALIEXPRESS_APP_KEY")
ALIEXPRESS_APP_SECRET = _get("ALIEXPRESS_APP_SECRET")
ALIEXPRESS_TRACKING_ID = _get("ALIEXPRESS_TRACKING_ID") or "default"
ALIEXPRESS_ATIVA = _bool("ALIEXPRESS_ATIVA", True)
PESO_ALIEXPRESS = _float("PESO_ALIEXPRESS", 1.0)
ALIEXPRESS_KEYWORD = _get("ALIEXPRESS_KEYWORD")
ALIEXPRESS_SORT = _get("ALIEXPRESS_SORT") or "LAST_VOLUME_DESC"
ALIEXPRESS_FETCH_LIMIT = _int("ALIEXPRESS_FETCH_LIMIT", 40)
# quantas paginas buscar por rodada (mais paginas = mais chance de achar ineditas)
ALIEXPRESS_PAGES = _int("ALIEXPRESS_PAGES", 3)
ALIEXPRESS_SHIP_TO = _get("ALIEXPRESS_SHIP_TO") or "BR"
ALIEXPRESS_CURRENCY = _get("ALIEXPRESS_CURRENCY") or "BRL"
ALIEXPRESS_LANGUAGE = _get("ALIEXPRESS_LANGUAGE") or "pt"

# --- Amazon (Creators API) ---
AMAZON_CREDENTIAL_ID = _get("AMAZON_CREDENTIAL_ID")
AMAZON_CREDENTIAL_SECRET = _get("AMAZON_CREDENTIAL_SECRET")
AMAZON_ASSOCIATE_TAG = _get("AMAZON_ASSOCIATE_TAG")
AMAZON_ATIVA = _bool("AMAZON_ATIVA", False)
PESO_AMAZON = _float("PESO_AMAZON", 1.0)
AMAZON_MARKETPLACE = _get("AMAZON_MARKETPLACE") or "www.amazon.com.br"
AMAZON_KEYWORD = _get("AMAZON_KEYWORD")
AMAZON_SEARCH_INDEX = _get("AMAZON_SEARCH_INDEX")
AMAZON_SORT = _get("AMAZON_SORT") or "Featured"
AMAZON_PAGES = _int("AMAZON_PAGES", 3)

# --- Filtros ("o que e uma boa oferta") ---
MIN_DISCOUNT = _float("MIN_DISCOUNT", 15)
MIN_RATING = _float("MIN_RATING", 4.5)
MIN_SALES = _int("MIN_SALES", 50)
MIN_PRICE = _float("MIN_PRICE", 10)
# quanto a venda precisa render de comissao (preco x taxa) para valer o post
MIN_GANHO = _float("MIN_GANHO", 0)
# quantos dias uma oferta fica "de molho" antes de poder ser repetida
DIAS_ANTES_DE_REPETIR = _int("DIAS_ANTES_DE_REPETIR", 7)
QUEDA_PRECO_REPOST_PERCENT = _float("QUEDA_PRECO_REPOST_PERCENT", 15)
# quanto a comissao pesa na escolha da oferta. 0 = so desconto (comportamento
# antigo); 1 = uma comissao de 40%% multiplica a nota por 1.4.
PESO_COMISSAO = _float("PESO_COMISSAO", 1.0)
# O histórico só influencia a fila enquanto estiver recente.
DESEMPENHO_MAX_DIAS = _int("DESEMPENHO_MAX_DIAS", 14)
# Quantas publicações recentes entram na proteção de variedade.
DIVERSIDADE_JANELA_POSTS = _int("DIVERSIDADE_JANELA_POSTS", 3)
SIMILARIDADE_MAXIMA = _float("SIMILARIDADE_MAXIMA", 0.68)
# Protecao adicional contra o mesmo produto reaparecer com outro itemId, URL
# ou vendedor. A comparacao respeita a excecao de queda real de preco.
DIAS_BLOQUEIO_PRODUTO_SEMELHANTE = _int(
    "DIAS_BLOQUEIO_PRODUTO_SEMELHANTE", 3
)
# Limites editoriais. Zero desliga o respectivo limite.
MAX_POSTS_POR_DIA = max(0, _int("MAX_POSTS_POR_DIA", 50))
MAX_POSTS_POR_LOJA_DIA = max(0, _int("MAX_POSTS_POR_LOJA_DIA", 3))
# Abaixo deste desconto, a oferta so entra se tiver um sinal comercial forte.
DESCONTO_PREFERIDO = _float("DESCONTO_PREFERIDO", 30)
VENDAS_EXCECAO_DESCONTO = max(0, _int("VENDAS_EXCECAO_DESCONTO", 1000))
# Titulos longos perdem legibilidade no Telegram e no Bluesky.
TITULO_MAX_CARACTERES = max(45, min(140, _int("TITULO_MAX_CARACTERES", 90)))

# Experimento simples e rastreável: A usa chamada humana; B começa objetiva.
AB_TEST_ATIVO = _bool("AB_TEST_ATIVO", True)
AB_TEST_NOME = _get("AB_TEST_NOME") or "chamada_humana_v1"

# --- Ritmo ---
POLL_INTERVAL_MINUTES = _int("POLL_INTERVAL_MINUTES", 30)
# intervalo variavel: sorteia entre MIN e MAX a cada rodada (default = fixo acima)
POLL_MIN_MINUTES = _int("POLL_MIN_MINUTES", POLL_INTERVAL_MINUTES)
POLL_MAX_MINUTES = _int("POLL_MAX_MINUTES", POLL_INTERVAL_MINUTES)
# quando uma rodada nao posta nada, espera so isso antes de tentar de novo
RETRY_MINUTES = _int("RETRY_MINUTES", 2)
# espacamento minimo entre posts (usado no modo --once/nuvem, que roda com
# frequencia alta pra compensar execucoes puladas pelo agendador)
MIN_MINUTOS_ENTRE_POSTS = _int("MIN_MINUTOS_ENTRE_POSTS", 15)
# a cada rodada sorteia o espacamento entre MIN e MAX (padrao = fixo no MIN)
MAX_MINUTOS_ENTRE_POSTS = _int("MAX_MINUTOS_ENTRE_POSTS", MIN_MINUTOS_ENTRE_POSTS)
# so posta entre HORA_INICIO e HORA_FIM (inclusive). Ex: 6 e 23 = 06:00 as 23:59.
HORA_INICIO = _int("HORA_INICIO", 6)
HORA_FIM = _int("HORA_FIM", 23)
# Horas em que o brasileiro compra mais (almoco e noite). Fora delas o bot
# espera mais entre um post e outro, guardando as ofertas boas para o pico.
HORAS_PICO = [int(x) for x in (_get("HORAS_PICO") or "12,13,18,19,20,21,22").split(",")
              if x.strip().isdigit()]
# Compatibilidade com instalações antigas que definiam apenas um multiplicador.
ESPERA_FORA_PICO = _float("ESPERA_FORA_PICO", 2.0)
MIN_MINUTOS_FORA_PICO = _int(
    "MIN_MINUTOS_FORA_PICO",
    int(round(MIN_MINUTOS_ENTRE_POSTS * ESPERA_FORA_PICO)),
)
MAX_MINUTOS_FORA_PICO = _int(
    "MAX_MINUTOS_FORA_PICO",
    int(round(MAX_MINUTOS_ENTRE_POSTS * ESPERA_FORA_PICO)),
)
HTTP_MAX_TENTATIVAS = max(1, _int("HTTP_MAX_TENTATIVAS", 3))

# Relatorio privado opcional. Use o ID numerico da sua conversa com o bot.
TELEGRAM_ADMIN_ID = _get("TELEGRAM_ADMIN_ID")
RELATORIO_HORA = _int("RELATORIO_HORA", 11)
RELATORIO_MINUTO = max(0, min(59, _int("RELATORIO_MINUTO", 30)))
RELATORIO_ALERTA_MIN_POSTS = _int("RELATORIO_ALERTA_MIN_POSTS", 10)
FALHAS_CONSECUTIVAS_ALERTA = _int("FALHAS_CONSECUTIVAS_ALERTA", 3)
# Na nuvem, o controlador do Telegram agenda o relatório sem gastar uma
# execução do GitHub a cada verificação. Instalações locais mantêm o padrão.
RELATORIO_AUTOMATICO_NA_EXECUCAO = _bool("RELATORIO_AUTOMATICO_NA_EXECUCAO", True)

# Redirecionador proprio opcional. Fica desligado ate o dominio estar aprovado
# nos programas de afiliados e o Worker ter sido implantado.
SHORTLINK_API_URL = _get("SHORTLINK_API_URL")
SHORTLINK_BASE_URL = _get("SHORTLINK_BASE_URL")
SHORTLINK_API_TOKEN = _get("SHORTLINK_API_TOKEN")

# Vitrine pública opcional. O token é secreto e nunca deve ir para o código.
SITE_ATIVO = _bool("SITE_ATIVO", False)
SITE_API_URL = _get("SITE_API_URL")
SITE_API_TOKEN = _get("SITE_API_TOKEN")
SITE_TRACKING_ID = _get("SITE_TRACKING_ID") or "site"
# Produtos antigos sao revistos aos poucos dentro das rodadas que ja existem.
# Isso nao cria novas execucoes do GitHub Actions.
SITE_REFRESH_PER_RUN = max(0, min(20, _int("SITE_REFRESH_PER_RUN", 6)))

# Compatibilidade com instalações antigas. Posts de oferta não usam mais esse
# link; o convite deve ficar em mensagem institucional ou post fixado.
LINK_COMPARTILHAR = _get("LINK_COMPARTILHAR")
MAX_POSTS_PER_RUN = _int("MAX_POSTS_PER_RUN", 3)
# Fora do pico, uma rodada menor preserva a qualidade do canal. Zero significa
# usar o mesmo limite do pico, para manter compatibilidade com instalacoes antigas.
MAX_POSTS_PER_RUN_FORA_PICO = _int("MAX_POSTS_PER_RUN_FORA_PICO", 0)
# Um cupom oficial ativo deve passar na frente da fila normal na próxima rodada.
CUPOM_PRIORIDADE_BONUS = _float("CUPOM_PRIORIDADE_BONUS", 1000)
# Um alerta de cupom e uma mensagem separada da oferta. So e criado quando a
# propria API devolve codigo E pagina de resgate; assim nao propagamos cupons
# copiados, vencidos ou sem destino verificavel.
CUPOM_ALERTA_SEPARADO = _bool("CUPOM_ALERTA_SEPARADO", True)
CUPOM_ALERTAS_POR_RODADA = max(0, _int("CUPOM_ALERTAS_POR_RODADA", 1))
# Consulta campanhas oficiais da API afiliada da Shopee. Não usa scraping e
# continua funcionando independentemente do domínio público da vitrine.
SHOPEE_CAMPANHAS_CUPOM = _bool("SHOPEE_CAMPANHAS_CUPOM", True)
# Horas (Brasilia) em que a proxima execucao publica um resumao dos cupons
# ainda ativos que o bot encontrou. Vazio desliga o resumo.
CUPOM_RESUMO_HORAS = [int(x) for x in (_get("CUPOM_RESUMO_HORAS") or "12,20").split(",")
                      if x.strip().isdigit() and 0 <= int(x) <= 23]
CUPOM_RESUMO_MAX_ITENS = max(1, _int("CUPOM_RESUMO_MAX_ITENS", 5))
# Em execuções com mais de uma oferta, o intervalo evita uma sequência com cara
# de spam. A variável antiga em segundos continua funcionando localmente.
_INTERVALO_ENTRE_POSTS = _get("INTERVALO_ENTRE_POSTS_MINUTOS")
INTERVALO_ENTRE_POSTS_MINUTOS = _int("INTERVALO_ENTRE_POSTS_MINUTOS", 3)
DELAY_BETWEEN_POSTS_SECONDS = (
    max(1, INTERVALO_ENTRE_POSTS_MINUTOS) * 60 if _INTERVALO_ENTRE_POSTS
    else _int("DELAY_BETWEEN_POSTS_SECONDS", 5)
)


def limite_posts_por_rodada(hora=None):
    """Retorna o limite aplicável ao horário, sem exceder o limite do pico."""
    hora = datetime.now().hour if hora is None else int(hora)
    if hora not in HORAS_PICO and MAX_POSTS_PER_RUN_FORA_PICO > 0:
        return min(MAX_POSTS_PER_RUN, MAX_POSTS_PER_RUN_FORA_PICO)
    return MAX_POSTS_PER_RUN


def shopee_configurada():
    return bool(SHOPEE_APP_ID and SHOPEE_SECRET)


def aliexpress_configurada():
    return bool(ALIEXPRESS_APP_KEY and ALIEXPRESS_APP_SECRET)


def amazon_configurada():
    return bool(AMAZON_CREDENTIAL_ID and AMAZON_CREDENTIAL_SECRET
                and AMAZON_ASSOCIATE_TAG)


def loja_ativa(nome):
    """Permite desligar uma fonte sem apagar suas credenciais."""
    return {
        "Shopee": SHOPEE_ATIVA,
        "AliExpress": ALIEXPRESS_ATIVA,
        "Amazon": AMAZON_ATIVA,
    }.get(nome, True)


def peso_loja(nome):
    """Preferência comercial moderada configurável por fonte."""
    return max(0.5, min(2.0, {
        "Shopee": PESO_SHOPEE,
        "AliExpress": PESO_ALIEXPRESS,
        "Amazon": PESO_AMAZON,
    }.get(nome, 1.0)))


def validar():
    """Confere se o basico foi preenchido. Retorna lista de problemas (vazia = tudo ok)."""
    faltando = []
    telegram_ok = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL)
    bluesky_ok = bool(BLUESKY_HANDLE and BLUESKY_APP_PASSWORD)
    facebook_ok = bool(FACEBOOK_ATIVO and FACEBOOK_PAGE_ID
                       and FACEBOOK_PAGE_ACCESS_TOKEN)
    if FACEBOOK_PAGE_ID and not FACEBOOK_PAGE_ID.isdigit():
        faltando.append("FACEBOOK_PAGE_ID deve conter somente numeros")
    # precisa de PELO MENOS um canal onde publicar
    if not telegram_ok and not bluesky_ok and not facebook_ok:
        faltando.append("nenhum canal configurado (Telegram, Bluesky ou Facebook)")
    if TELEGRAM_CHANNEL and "t.me/" in TELEGRAM_CHANNEL:
        faltando.append("TELEGRAM_CHANNEL (link privado nao serve; use @usuario "
                        "do canal ou o ID numerico)")
    # precisa de PELO MENOS uma loja configurada
    if not (shopee_configurada() or aliexpress_configurada()
            or amazon_configurada()):
        faltando.append("nenhuma loja configurada (preencha Shopee, AliExpress "
                        "OU Amazon)")
    return faltando
