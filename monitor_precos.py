"""Monitor de preços com histórico: só posta quando a oferta é de verdade.

Os produtos ficam no D1 do site (cadastrados por /add no painel privado). A
cada 2 horas o painel dispara esta coleta, que:
  1) lê o preço de cada produto pela API oficial da loja;
  2) grava a leitura no histórico;
  3) posta no canal do Telegram só o que passar em todas as regras de
     avaliar(), respeitando o limite diário e o silêncio da madrugada.

Sem scraping: Mercado Livre pela API com OAuth e Amazon pela Creators API
(esta só depois que a Amazon liberar o acesso da conta).
"""
import html
import statistics
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import requests

import amazon
import config
import mercadolivre_api
import seguranca
import shortlinks
import site_publisher
import store
import telegram_poster

FUSO = ZoneInfo("America/Sao_Paulo")
NOME_LOJA = {"mercadolivre": "Mercado Livre", "amazon": "Amazon"}
PREFIXO_OFERTA = {"mercadolivre": "mercadolivre_", "amazon": "amazon_"}


# --- Regra de "oferta de verdade" (função pura, sem rede) -------------------

def _serie(historico):
    serie = []
    for dia, preco in historico or []:
        try:
            valor = float(preco)
            if valor > 0:
                serie.append((date.fromisoformat(str(dia)), valor))
        except (TypeError, ValueError):
            continue
    return serie


def avaliar(historico, preco, disponivel, primeira_leitura, ultimo_post, agora, cfg=config):
    """Decide se um preço é oferta de verdade.

    historico: [(dia ISO, menor preço disponível do dia)] das leituras
    anteriores a esta. primeira_leitura: epoch da leitura mais antiga.
    ultimo_post: {"preco", "postado_em"} ou None. agora: epoch.

    Devolve um dicionário com "postar" (bool), "motivo" e os números usados
    no post (média, mínimo, percentual abaixo da média, dias de janela).
    """
    agora = int(agora)
    hoje = datetime.fromtimestamp(agora, FUSO).date()
    resultado = {"postar": False, "preco": float(preco or 0)}
    if not disponivel or not preco or float(preco) <= 0:
        resultado["motivo"] = "fora de estoque"
        return resultado
    preco = float(preco)
    dias_historico = (agora - int(primeira_leitura)) / 86400 if primeira_leitura else 0
    resultado["dias_historico"] = dias_historico
    if dias_historico < cfg.MONITOR_DIAS_MINIMOS:
        resultado["motivo"] = (f"só coletando ({dias_historico:.1f} de "
                               f"{cfg.MONITOR_DIAS_MINIMOS} dias de histórico)")
        return resultado

    serie = _serie(historico)
    janela_minimo = [p for d, p in serie if d > hoje - timedelta(days=cfg.MONITOR_DIAS_MINIMO)]
    janela_media = [(d, p) for d, p in serie if d > hoje - timedelta(days=cfg.MONITOR_DIAS_MEDIA)]
    if not janela_minimo or not janela_media:
        resultado["motivo"] = "sem leituras com estoque no período"
        return resultado

    # Desconto falso: se o preço subiu nos últimos dias e voltou, os dias do
    # pico não entram na média (senão a "queda" seria só a volta ao normal).
    mediana = statistics.median(p for _, p in janela_media)
    teto = mediana * (1 + cfg.MONITOR_PICO_PERCENT / 100)
    inicio_pico = hoje - timedelta(days=cfg.MONITOR_DIAS_PICO)
    dias_de_pico = [(d, p) for d, p in janela_media if d > inicio_pico and p > teto]
    valores_media = [p for d, p in janela_media if (d, p) not in dias_de_pico] or [mediana]
    media = statistics.fmean(valores_media)
    minimo = min(janela_minimo)
    abaixo = (1 - preco / media) * 100 if media > 0 else 0

    resultado.update({
        "media": round(media, 2), "minimo": round(minimo, 2), "abaixo": round(abaixo, 1),
        "pico_ignorado": bool(dias_de_pico),
        "dias_janela": min(cfg.MONITOR_DIAS_MINIMO, max(1, int(dias_historico))),
        "dias_media": min(cfg.MONITOR_DIAS_MEDIA, max(1, int(dias_historico))),
    })
    menor_preco = preco <= minimo and abaixo >= cfg.MONITOR_MIN_ABAIXO_MEDIA_PERCENT
    bem_abaixo = abaixo >= cfg.MONITOR_QUEDA_MEDIA_PERCENT
    if not (menor_preco or bem_abaixo):
        resultado["motivo"] = (f"preço comum (R$ {telegram_poster._preco(preco)}; "
                               f"mínimo R$ {telegram_poster._preco(minimo)}, "
                               f"{abaixo:.1f}% abaixo da média)")
        return resultado

    if ultimo_post:
        horas = (agora - int(ultimo_post.get("postado_em") or 0)) / 3600
        anterior = float(ultimo_post.get("preco") or 0)
        caiu_mais = anterior > 0 and preco <= anterior * (1 - cfg.MONITOR_QUEDA_REPOST_PERCENT / 100)
        if horas < cfg.MONITOR_HORAS_REPOST and not caiu_mais:
            resultado["motivo"] = f"já postado há {horas:.0f} h por R$ {telegram_poster._preco(anterior)}"
            return resultado

    resultado["postar"] = True
    resultado["motivo"] = "menor_preco" if menor_preco else "abaixo_media"
    return resultado


def em_silencio(hora, cfg=config):
    inicio, fim = cfg.MONITOR_SILENCIO_INICIO, cfg.MONITOR_SILENCIO_FIM
    if inicio == fim:
        return False
    return hora >= inicio or hora < fim if inicio > fim else inicio <= hora < fim


def montar_legenda(nome, loja, avaliacao, link):
    """Texto do post (HTML do Telegram) no formato combinado."""
    preco = telegram_poster._preco(avaliacao["preco"])
    media = telegram_poster._preco(avaliacao["media"])
    if avaliacao["motivo"] == "menor_preco":
        titulo = f"🔥 MENOR PREÇO EM {avaliacao['dias_janela']} DIAS"
    else:
        titulo = "🔥 PREÇO BEM ABAIXO DA MÉDIA"
    linhas = [
        f"<b>{titulo}</b>",
        html.escape(telegram_poster.limpar_titulo(nome or "Produto", 160)),
        f"💰 <b>R$ {preco}</b>  (média {avaliacao['dias_media']} dias: R$ {media})",
        f"📉 {max(0, round(avaliacao['abaixo']))}% abaixo da média",
        f"🛒 {html.escape(NOME_LOJA.get(loja, loja))}",
        f"👉 {html.escape(link)}",
        "⚠️ Preço pode mudar a qualquer momento.",
    ]
    return "\n".join(linhas)


# --- Acesso ao D1 pelo site ---------------------------------------------------

def _url_api():
    return site_publisher._api_path("/api/monitor")


def _cabecalho():
    return {"Authorization": f"Bearer {config.SITE_API_TOKEN}"}


def carregar(agora):
    inicio_do_dia = datetime.fromtimestamp(agora, FUSO).replace(hour=0, minute=0, second=0, microsecond=0)
    resposta = requests.get(_url_api(), headers=_cabecalho(), timeout=30, allow_redirects=False, params={
        "dias": max(config.MONITOR_DIAS_MINIMO, config.MONITOR_DIAS_MEDIA),
        "posts_desde": int(inicio_do_dia.timestamp()),
    })
    if resposta.status_code != 200:
        raise RuntimeError(f"Site recusou a leitura do monitor ({resposta.status_code})")
    return resposta.json() or {}


def gravar(corpo):
    resposta = requests.post(_url_api(), headers=_cabecalho(), json=corpo, timeout=30,
                             allow_redirects=False)
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou a gravação do monitor ({resposta.status_code})")


# --- Coleta -------------------------------------------------------------------

def _com_retentativa(funcao, tentativas=3):
    """Respeita o 429 (limite de requisições) com espera curta antes de desistir."""
    for tentativa in range(tentativas):
        try:
            return funcao()
        except requests.HTTPError as erro:
            resposta = getattr(erro, "response", None)
            if getattr(resposta, "status_code", None) != 429 or tentativa + 1 >= tentativas:
                raise
            try:
                espera = int(resposta.headers.get("Retry-After") or 0)
            except (TypeError, ValueError):
                espera = 0
            time.sleep(min(30, espera or 5 * (tentativa + 1)))
    return None


def coletar(produtos, pausa=None):
    """Lê o preço atual de cada produto. Devolve ({id: leitura}, erros)."""
    pausa = config.MONITOR_PAUSA_SEGUNDOS if pausa is None else pausa
    leituras, erros = {}, 0
    ml = [p for p in produtos if p.get("loja") == "mercadolivre"]
    if ml and mercadolivre_api.esta_configurada():
        for indice, produto in enumerate(ml):
            if indice and pausa:
                time.sleep(pausa)
            try:
                leitura = _com_retentativa(lambda: mercadolivre_api.ler_monitorado(
                    produto["id_produto"], produto.get("tipo"),
                    com_categoria=not produto.get("categoria")))
            except mercadolivre_api.AcessoRevogado:
                print("   ⚠️ Monitor: autorização do Mercado Livre expirou; coleta do ML adiada.")
                erros += len(ml) - indice
                break
            except Exception as erro:
                erros += 1
                print(f"   ⚠️ Monitor: leitura de #{produto['id']} falhou: "
                      f"{seguranca.redigir_segredos(erro)[:160]}")
                continue
            if leitura is None:
                leitura = {"preco": None, "preco_antigo": None, "disponivel": False}
            leituras[produto["id"]] = leitura
    elif ml:
        print("   ⚠️ Monitor: API do Mercado Livre não configurada.")

    az = [p for p in produtos if p.get("loja") == "amazon"]
    if az:
        if store._estado("amazon_api_status") != "liberada" or not amazon.credenciais_api_configuradas():
            print(f"   ⏳ Monitor: {len(az)} produto(s) da Amazon aguardando a liberação da Creators API.")
        else:
            try:
                por_asin = amazon.consultar_monitor([p["id_produto"] for p in az])
            except Exception as erro:
                erros += len(az)
                por_asin = {}
                print(f"   ⚠️ Monitor: Creators API falhou: {seguranca.redigir_segredos(erro)[:160]}")
            for produto in az:
                if str(produto["id_produto"]).upper() in por_asin:
                    leituras[produto["id"]] = por_asin[str(produto["id_produto"]).upper()]
    return leituras, erros


def _link_afiliado(produto, leitura):
    url = (leitura or {}).get("url") or produto.get("link_afiliado")
    if not url:
        return None
    if produto["loja"] == "mercadolivre":
        if not mercadolivre_api.parametros_afiliado():
            return None
        return mercadolivre_api.link_afiliado(url)
    return amazon.gerar_link(url, "telegram")


def _atualizacoes(produtos, leituras):
    atualizar = []
    for produto in produtos:
        leitura = leituras.get(produto["id"])
        if not leitura:
            continue
        dados = {"id": produto["id"]}
        for campo in ("nome", "categoria", "imagem"):
            if leitura.get(campo) and leitura[campo] != produto.get(campo):
                dados[campo] = leitura[campo]
        if not produto.get("link_afiliado"):
            try:
                link = _link_afiliado(produto, leitura)
            except Exception:
                link = None
            if link:
                dados["link_afiliado"] = link
        if len(dados) > 1:
            atualizar.append(dados)
    return atualizar


# --- Publicação ---------------------------------------------------------------

def _enviar(chat_id, legenda, imagem, link):
    api = telegram_poster.API
    botao = {"inline_keyboard": [[{"text": "🛒 Ver oferta", "url": link}]]}
    if imagem:
        try:
            corpo = requests.post(api.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendPhoto"), json={
                "chat_id": chat_id, "photo": seguranca.validar_url_https_publica(imagem, "Imagem"),
                "caption": legenda, "parse_mode": "HTML", "reply_markup": botao,
            }, timeout=30).json()
            if corpo.get("ok"):
                return
        except (requests.RequestException, ValueError):
            pass
    corpo = requests.post(api.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendMessage"), json={
        "chat_id": chat_id, "text": legenda, "parse_mode": "HTML", "reply_markup": botao,
        "disable_web_page_preview": True,
    }, timeout=30).json()
    if not corpo.get("ok"):
        raise RuntimeError(seguranca.redigir_segredos(f"Telegram recusou o post: {corpo}"))


def _publicar(produto, leitura, avaliacao):
    link = produto.get("link_afiliado") or _link_afiliado(produto, leitura)
    if not link:
        raise RuntimeError("sem link de afiliado confirmado")
    oferta_id = PREFIXO_OFERTA[produto["loja"]] + str(produto["id_produto"]).upper()
    if shortlinks.esta_configurado():
        try:
            link = shortlinks.criar(link, oferta_id, "telegram", NOME_LOJA[produto["loja"]])
        except Exception as erro:
            print(f"   ⚠️ Monitor: link curto indisponível, usando o link direto "
                  f"({seguranca.redigir_segredos(erro)[:80]}).")
    link = seguranca.validar_url_https_publica(link, "Link de afiliado")
    nome = leitura.get("nome") or produto.get("nome")
    legenda = montar_legenda(nome, produto["loja"], avaliacao, link)
    _enviar(config.TELEGRAM_CHANNEL, legenda, leitura.get("imagem") or produto.get("imagem"), link)


def executar(agora=None):
    """Rodada completa: coleta, grava o histórico e posta o que for oferta."""
    if not config.MONITOR_ATIVO:
        print("⏸ Monitor de preços desativado (MONITOR_ATIVO).")
        return False
    if not site_publisher.esta_configurado():
        print("❌ Monitor de preços precisa de SITE_API_URL e SITE_API_TOKEN.")
        return False
    agora = int(agora or time.time())
    dados = carregar(agora)
    produtos = dados.get("produtos") or []
    if not produtos:
        print("📭 Monitor de preços: nenhum produto ativo. Use /add <link> no painel.")
        return True
    leituras, erros = coletar(produtos)
    gravar({
        "leituras": [{"produto_id": pid, "preco": l.get("preco"), "preco_antigo": l.get("preco_antigo"),
                      "disponivel": bool(l.get("disponivel"))} for pid, l in leituras.items()],
        "produtos": _atualizacoes(produtos, leituras),
    })
    print(f"📈 Monitor de preços: {len(leituras)} de {len(produtos)} produto(s) lido(s)"
          f"{f', {erros} erro(s)' if erros else ''}.")

    historico = dados.get("historico") or {}
    primeira = dados.get("primeira_leitura") or {}
    ultimo = dados.get("ultimo_post") or {}
    na_fila = {int(f["produto_id"]): f for f in dados.get("fila") or []}
    aprovados = []
    for produto in produtos:
        pid = produto["id"]
        leitura = leituras.get(pid)
        if not leitura:
            continue
        chave = str(pid)
        avaliacao = avaliar(historico.get(chave) or historico.get(pid), leitura.get("preco"),
                            leitura.get("disponivel"), primeira.get(chave) or primeira.get(pid) or agora,
                            ultimo.get(chave) or ultimo.get(pid), agora)
        if avaliacao["postar"]:
            aprovados.append((produto, leitura, avaliacao))
        else:
            print(f"   · #{pid}: {avaliacao['motivo']}.")

    aprovados_ids = {p["id"] for p, _, _ in aprovados}
    sairam_da_fila = [pid for pid in na_fila if pid not in aprovados_ids and pid in leituras]
    hora = datetime.fromtimestamp(agora, FUSO).hour
    if em_silencio(hora):
        novos = [{"produto_id": p["id"], "preco": a["preco"]} for p, _, a in aprovados]
        if novos or sairam_da_fila:
            gravar({"fila_add": novos, "fila_remover": sairam_da_fila})
        if novos:
            print(f"🌙 Monitor: {len(novos)} oferta(s) na fila para depois das "
                  f"{config.MONITOR_SILENCIO_FIM}h.")
        return True
    if sairam_da_fila:
        gravar({"fila_remover": sairam_da_fila})

    vagas = max(0, config.MONITOR_LIMITE_DIARIO - int(dados.get("posts_hoje") or 0))
    aprovados.sort(key=lambda item: (item[0]["id"] not in na_fila,
                                     na_fila.get(item[0]["id"], {}).get("entrou_em", 0),
                                     -item[2]["abaixo"]))
    if aprovados and not vagas:
        print(f"   ⏳ Monitor: limite de {config.MONITOR_LIMITE_DIARIO} posts por dia atingido.")
    for produto, leitura, avaliacao in aprovados[:vagas]:
        try:
            _publicar(produto, leitura, avaliacao)
        except Exception as erro:
            print(f"   ❌ Monitor: post de #{produto['id']} falhou: "
                  f"{seguranca.redigir_segredos(erro)[:160]}")
            continue
        gravar({"post": {"produto_id": produto["id"], "preco": avaliacao["preco"],
                         "motivo": avaliacao["motivo"]}})
        print(f"   ✅ Monitor postou #{produto['id']} ({avaliacao['motivo']}, "
              f"{avaliacao['abaixo']:.0f}% abaixo da média).")
    return True


# --- Modo de teste --------------------------------------------------------------

def historico_de_teste(agora):
    """30 dias de preço normal com um pico falso há poucos dias."""
    hoje = datetime.fromtimestamp(agora, FUSO).date()
    historico = []
    for dias_atras in range(30, 0, -1):
        preco = 249.90
        if 6 <= dias_atras <= 10:
            preco = 329.90  # "subiu para depois dar desconto"
        elif dias_atras in (20, 21):
            preco = 239.90
        historico.append(((hoje - timedelta(days=dias_atras)).isoformat(), preco))
    return historico


def executar_teste(agora=None):
    """Mostra no chat de admin como o post ficaria, sem postar no canal."""
    agora = int(agora or time.time())
    historico = historico_de_teste(agora)
    avaliacao = avaliar(historico, 199.90, True, agora - 30 * 86400, None, agora)
    comum = avaliar(historico, 245.00, True, agora - 30 * 86400, None, agora)
    if not avaliacao["postar"]:
        corpo = f"O produto de teste não passou na regra: {avaliacao['motivo']}."
    else:
        corpo = montar_legenda("Fone de Ouvido Bluetooth (produto de teste)", "mercadolivre",
                               avaliacao, "https://www.mercadolivre.com.br/p/MLB00000000")
    texto = "\n".join([
        "🧪 <b>MODO TESTE</b>: este post <b>não</b> foi para o canal.",
        "", corpo, "",
        "<b>Como a regra decidiu</b>",
        f"• Histórico falso: 30 dias a R$ 249,90, com pico de R$ 329,90 há 6 a 10 dias.",
        f"• Pico ignorado na média: {'sim' if avaliacao.get('pico_ignorado') else 'não'}.",
        f"• Média usada: R$ {telegram_poster._preco(avaliacao.get('media', 0))}; "
        f"mínimo do período: R$ {telegram_poster._preco(avaliacao.get('minimo', 0))}.",
        f"• O mesmo produto a R$ 245,00 não seria postado: {html.escape(comum['motivo'])}.",
        f"• Regras atuais: {config.MONITOR_QUEDA_MEDIA_PERCENT:g}% abaixo da média de "
        f"{config.MONITOR_DIAS_MEDIA} dias ou menor preço em {config.MONITOR_DIAS_MINIMO} dias; "
        f"mínimo de {config.MONITOR_DIAS_MINIMOS} dias de histórico; "
        f"até {config.MONITOR_LIMITE_DIARIO} posts por dia; silêncio das "
        f"{config.MONITOR_SILENCIO_INICIO}h às {config.MONITOR_SILENCIO_FIM}h.",
    ])
    if not config.TELEGRAM_ADMIN_ID or not config.TELEGRAM_BOT_TOKEN:
        print("❌ Teste do monitor precisa de TELEGRAM_ADMIN_ID e TELEGRAM_BOT_TOKEN.")
        return False
    _enviar(config.TELEGRAM_ADMIN_ID, texto, None, "https://www.mercadolivre.com.br/")
    print("🧪 Prévia do monitor de preços enviada ao chat de admin.")
    return True
