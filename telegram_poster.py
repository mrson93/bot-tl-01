"""Publica uma oferta, ja formatada, no seu canal do Telegram."""
import html
import re
import time

import requests

import config
import desempenho
import experimentos
import seguranca
import observabilidade

API = "https://api.telegram.org/bot{token}/{metodo}"

NOME = "Telegram"
TRACKING_ID = config.TELEGRAM_TRACKING_ID  # vazio = usa o padrao da loja


def esta_configurada() -> bool:
    return bool(config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHANNEL)


def _preco(valor) -> str:
    """Formata numero como preco em reais: 1234.5 -> '1.234,50'."""
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return str(valor)
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


# preposicao certa pra cada loja ("na Shopee", "no AliExpress")
_PREPOSICAO = {"Shopee": "na", "AliExpress": "no", "Amazon": "na"}

# Chamada por faixa de desconto, da mais forte para a mais fraca. Abaixo de
# 40% o post vai direto ao produto: anunciar "OFERTA" num desconto pequeno
# gasta a atencao de quem le e faz o canal parecer que exagera sempre.
_ABERTURAS = [
    (70.000001, "🚨 BAIXOU MUITO · {d}% OFF"),
    (40, "🔥 OFERTA · {d}% OFF"),
]

def abertura(desconto: float) -> str:
    """Primeira linha do post. Devolve vazio quando o desconto nao merece
    chamada -- ai o post comeca direto no nome do produto."""
    for piso, modelo in _ABERTURAS:
        if desconto >= piso:
            return modelo.format(d=int(round(desconto)))
    return ""


# separadores que os marketplaces usam antes de emendar palavra-chave
_SEPARADORES = (" - ", " – ", " — ", " | ", " • ", ", ")
# abaixo disso o primeiro pedaco nao e nome de produto, e so um prefixo solto
_MINIMO_UTIL = 25


def limpar_titulo(titulo: str, limite: int = None) -> str:
    """Deixa o nome do produto apresentavel SEM cortar no meio da palavra.

    Os marketplaces montam o titulo como "Nome do Produto, clausula de
    palavra-chave, outra clausula...". Ficamos com o trecho ate o primeiro
    separador, que costuma ser o nome de verdade, e tiramos palavras repetidas
    ("Ampoule 30ml pdrn rosa creme 30ml").
    """
    texto = " ".join((titulo or "Oferta").split())
    # Remove etiquetas promocionais que não identificam o produto.
    texto = re.sub(
        r"^\s*(?:[\[\{【](?:novo\s*\d{0,4}|original|promo(?:cao|ção)?)[\]\}】]\s*)+",
        "", texto, flags=re.IGNORECASE,
    )
    texto = re.sub(r"\b(super\s+promo(?:cao|ção)|promo(?:cao|ção))\b",
                   "", texto, flags=re.IGNORECASE)
    texto = " ".join(texto.split()).strip(" ,;:-–—|/")

    # Tira so repeticao COLADA ("Fone Fone Bluetooth"). Tirar toda palavra
    # repetida estraga o sentido: em "fio de solda ... rolo de fio de solda",
    # sumir com o segundo "solda" deixa "rolo de fio de".
    palavras = []
    for palavra in texto.split():
        if palavras and palavra.lower() == palavras[-1].lower():
            continue
        palavras.append(palavra)
    texto = " ".join(palavras).strip(" ,;:-–—|/")

    # 3) titulo todo em minusculo fica com cara de descuido
    if texto and texto[0].islower():
        texto = texto[0].upper() + texto[1:]

    # 4) aplica o limite editorial comum aos dois canais.
    if limite is None:
        limite = config.TITULO_MAX_CARACTERES
    if limite and len(texto) > limite:
        texto = texto[:limite].rsplit(" ", 1)[0].rstrip(" ,-–|/") + "…"
    return texto or "Oferta"


def _milhar(valor) -> str:
    """7137 -> '7.137'"""
    try:
        return f"{int(valor):,}".replace(",", ".")
    except (TypeError, ValueError):
        return str(valor)


def montar_legenda(oferta: dict, link_afiliado: str) -> str:
    """Monta o texto da postagem em HTML (o que o assinante do canal ve)."""
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    link_html = html.escape(link_afiliado, quote=True)
    # A legenda de foto do Telegram tem limite menor que uma mensagem comum.
    titulo = html.escape(limpar_titulo(
        oferta.get("productName", "Oferta"), config.TITULO_MAX_CARACTERES
    ))
    fonte = str(oferta.get("fonte") or "loja")
    fonte_html = html.escape(fonte.upper())
    preco = oferta.get("price") or oferta.get("priceMin")
    desconto = float(oferta.get("priceDiscountRate") or 0)
    rating = oferta.get("ratingStar")
    vendas = oferta.get("sales")
    loja = html.escape(oferta.get("shopName") or "")

    linhas = []
    humana = (desempenho.chamada_humana(oferta)
              if experimentos.usa_chamada_humana(oferta) else "")
    if humana:
        linhas.append(html.escape(humana))
        linhas.append("")
    linhas.append(f"<b>{titulo}</b>")
    linhas.append("")

    # linha de preco. O "de" preferido e o que a propria loja informa; so
    # calculamos a partir do desconto quando ela nao manda esse campo.
    original = oferta.get("precoOriginal")
    if original and preco:
        try:
            if float(original) > float(preco):
                sufixo = " no app" if oferta.get("precoNoApp") else ""
                linhas.append(f"💰 De <s>R$ {_preco(original)}</s> por <b>R$ {_preco(preco)}</b>{sufixo}")
            else:
                linhas.append(f"💰 <b>R$ {_preco(preco)}</b>" + (f" · {int(round(desconto))}% OFF" if desconto else ""))
        except (ValueError, TypeError):
            linhas.append(f"💰 <b>R$ {_preco(preco)}</b>")
    elif preco:
        sufixo = " no app" if oferta.get("precoNoApp") else ""
        linhas.append(f"💰 <b>R$ {_preco(preco)}</b>{sufixo}" + (f" · {int(round(desconto))}% OFF" if desconto else ""))

    # linha de reputacao
    reput = []
    if rating:
        reput.append(f"⭐ {float(rating):.1f}")
    if vendas:
        reput.append(f"🛍️ {_milhar(vendas)} vendidos")
    if loja:
        reput.append(f"🏬 {loja}")
    if reput:
        linhas.append("")
        linhas.append(" · ".join(reput))

    cupom = str(oferta.get("cupom") or "").strip()
    if cupom:
        linhas.append("")
        linhas.append(f"🎟 Cupom: <code>{html.escape(cupom)}</code>")
        condicao = str(oferta.get("cupomCondicao") or "").strip()
        if condicao:
            linhas.append("ℹ️ " + html.escape(condicao[:140]))
        linhas.append("📱 Ative o cupom no aplicativo antes de finalizar")

    linhas.append("")
    prep = _PREPOSICAO.get(fonte, "na")
    acao = "RESGATAR CUPOM" if oferta.get("cupomResgate") else "COMPRAR"
    linhas.append(f'🛒 <a href="{link_html}">{acao} {prep.upper()} '
                  f'{fonte_html}</a>')

    return "\n".join(linhas)


def postar(oferta: dict, link_afiliado: str) -> None:
    """Envia a oferta para o canal, com foto, texto e botao de compra."""
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    legenda = montar_legenda(oferta, link_afiliado)
    botao = {
        "inline_keyboard": [[{"text": "🛒 Ver oferta", "url": link_afiliado}]]
    }
    dados = {
        "chat_id": config.TELEGRAM_CHANNEL,
        "photo": oferta.get("imageUrl"),
        "caption": legenda,
        "parse_mode": "HTML",
        "reply_markup": botao,
    }
    url = API.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendPhoto")
    ultimo = None
    for tentativa in range(config.HTTP_MAX_TENTATIVAS):
        try:
            resp = requests.post(url, json=dados, timeout=30)
            corpo = resp.json()
            if corpo.get("ok"):
                return
            ultimo = RuntimeError(f"Telegram recusou a foto: {corpo}")
            break
        except requests.RequestException as exc:
            ultimo = exc
            if tentativa + 1 < config.HTTP_MAX_TENTATIVAS:
                time.sleep(tentativa + 1)

    # Imagem quebrada nao deve fazer a oferta desaparecer.
    texto = dict(dados)
    texto.pop("photo", None)
    texto["text"] = texto.pop("caption")
    url_texto = API.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendMessage")
    try:
        resp = requests.post(url_texto, json=texto, timeout=30)
        corpo = resp.json()
    except Exception as exc:
        erro = seguranca.redigir_segredos(
            f"Telegram falhou ao enviar o texto: {exc}"
        )
        raise RuntimeError(erro) from None
    if not corpo.get("ok"):
        erro = seguranca.redigir_segredos(
            f"Telegram recusou foto e texto: {ultimo}; {corpo}"
        )
        raise RuntimeError(erro)
    observabilidade.evento(
        "fallback", oferta_id=oferta.get("oferta_id"), canal=NOME,
        fonte=oferta.get("fonte"), motivo="telegram_foto_para_texto",
    )


def postar_bom_dia(mensagem: str) -> None:
    """Publica uma saudacao simples, sem imagem nem botao de venda."""
    url = API.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendMessage")
    ultimo = None
    for tentativa in range(config.HTTP_MAX_TENTATIVAS):
        try:
            resposta = requests.post(url, json={
                "chat_id": config.TELEGRAM_CHANNEL,
                "text": mensagem,
            }, timeout=30)
            corpo = resposta.json()
            if corpo.get("ok"):
                return
            ultimo = RuntimeError(f"Telegram recusou o bom dia: {corpo}")
        except requests.RequestException as erro:
            ultimo = erro
        if tentativa + 1 < config.HTTP_MAX_TENTATIVAS:
            time.sleep(tentativa + 1)
    raise RuntimeError(seguranca.redigir_segredos(
        f"Nao foi possivel publicar o bom dia: {ultimo}"
    ))


def postar_cupom(cupom: dict, link_afiliado: str) -> None:
    """Alerta enxuto para cupom cuja pagina de resgate veio da API oficial."""
    link_afiliado = seguranca.validar_url_https_publica(link_afiliado, "Link do cupom")
    fonte = html.escape(str(cupom.get("fonte") or "loja"))
    codigo = html.escape(str(cupom.get("codigo") or "").strip())
    condicao = html.escape(str(cupom.get("condicao") or "").strip()[:180])
    linhas = [f"🚨 <b>CUPOM LIBERADO · {fonte.upper()}</b>", "",
              f"🎟 <code>{codigo}</code>"]
    if condicao:
        linhas.append("ℹ️ " + condicao)
    linhas.extend(["📱 Resgate agora no aplicativo antes de finalizar.", "",
                   "⏳ Cupom sujeito a disponibilidade e regras da plataforma."])
    dados = {
        "chat_id": config.TELEGRAM_CHANNEL, "text": "\n".join(linhas),
        "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": [[{
            "text": "🎟 Resgatar cupom", "url": link_afiliado
        }]]},
    }
    resposta = requests.post(API.format(token=config.TELEGRAM_BOT_TOKEN,
                                        metodo="sendMessage"), json=dados, timeout=30)
    corpo = resposta.json()
    if not corpo.get("ok"):
        raise RuntimeError(seguranca.redigir_segredos(f"Telegram recusou cupom: {corpo}"))


def postar_resumo_cupons(cupons: list, links: dict) -> None:
    """Resumo curto; cada item aponta para a mesma pagina oficial de resgate."""
    linhas = ["🎟 <b>CUPONS ATIVOS</b>", ""]
    for cupom in cupons:
        codigo = html.escape(str(cupom["codigo"]))
        fonte = html.escape(str(cupom["fonte"]))
        condicao = html.escape(str(cupom.get("condicao") or "")[:90])
        linha = f"• <b>{fonte}</b>: <code>{codigo}</code>"
        if condicao:
            linha += " — " + condicao
        linhas.append(linha)
    primeiro = links.get(cupons[0]["id"])
    dados = {"chat_id": config.TELEGRAM_CHANNEL, "text": "\n".join(linhas),
             "parse_mode": "HTML"}
    if primeiro:
        dados["reply_markup"] = {"inline_keyboard": [[{
            "text": "🎟 Ver cupom", "url": primeiro
        }]]}
    resposta = requests.post(API.format(token=config.TELEGRAM_BOT_TOKEN,
                                        metodo="sendMessage"), json=dados, timeout=30)
    if not resposta.json().get("ok"):
        raise RuntimeError("Telegram recusou resumo de cupons")
