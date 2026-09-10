"""Publica ofertas em uma Pagina do Facebook usando a Graph API."""
import re
import time

import requests

import config
import desempenho
import experimentos
import seguranca
import store
import telegram_poster as fmt


NOME = "Facebook"
TRACKING_ID = config.FACEBOOK_TRACKING_ID
_VERSAO = re.compile(r"^v\d{1,3}\.\d{1,2}$")


class RespostaFacebookError(RuntimeError):
    """A Meta respondeu de forma definitiva e permite fallback seguro."""


def esta_configurada() -> bool:
    return bool(config.FACEBOOK_ATIVO and config.FACEBOOK_PAGE_ID
                and config.FACEBOOK_PAGE_ACCESS_TOKEN)


def pode_publicar() -> bool:
    return (esta_configurada()
            and store.posts_canal_hoje(NOME) < config.FACEBOOK_MAX_POSTS_DIA)


def _endpoint(recurso: str) -> str:
    versao = str(config.FACEBOOK_GRAPH_API_VERSION or "")
    pagina = str(config.FACEBOOK_PAGE_ID or "")
    if not _VERSAO.fullmatch(versao):
        raise ValueError("Versao da Graph API do Facebook invalida")
    if not pagina.isdigit():
        raise ValueError("ID da pagina do Facebook invalido")
    return f"https://graph.facebook.com/{versao}/{pagina}/{recurso}"


def _preco(valor) -> str:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return str(valor)
    return f"{numero:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def montar_texto(oferta: dict, link_afiliado: str) -> str:
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    titulo = fmt.limpar_titulo(
        oferta.get("productName", "Oferta"), config.TITULO_MAX_CARACTERES
    )
    fonte = str(oferta.get("fonte") or "loja")
    preco = oferta.get("price") or oferta.get("priceMin")
    desconto = float(oferta.get("priceDiscountRate") or 0)
    original = oferta.get("precoOriginal")
    humana = (desempenho.chamada_humana(oferta)
              if experimentos.usa_chamada_humana(oferta) else "")
    linhas = []
    if humana:
        linhas.extend((humana, ""))
    linhas.append(titulo)
    linhas.append("")
    try:
        if original and preco and float(original) > float(preco):
            linhas.append(f"💰 De R$ {_preco(original)} por R$ {_preco(preco)}")
        elif preco:
            sufixo = f" · {int(round(desconto))}% OFF" if desconto else ""
            linhas.append(f"💰 R$ {_preco(preco)}{sufixo}")
    except (TypeError, ValueError):
        if preco:
            linhas.append(f"💰 R$ {_preco(preco)}")

    reputacao = []
    if oferta.get("ratingStar"):
        reputacao.append(f"⭐ {float(oferta['ratingStar']):.1f}")
    if oferta.get("sales"):
        reputacao.append(f"🛍️ {fmt._milhar(oferta['sales'])} vendidos")
    loja = str(oferta.get("shopName") or "").strip()
    if loja:
        reputacao.append(f"🏬 {loja}")
    if reputacao:
        linhas.extend(("", " · ".join(reputacao)))

    cupom = str(oferta.get("cupom") or "").strip()
    if cupom:
        linhas.extend(("", f"🎟 Cupom: {cupom}"))
        condicao = str(oferta.get("cupomCondicao") or "").strip()
        if condicao:
            linhas.append("ℹ️ " + condicao[:180])
        linhas.append("📱 Ative o cupom no aplicativo antes de finalizar")

    anterior = oferta.get("_preco_publicacao_anterior")
    if oferta.get("_motivo") == "queda_preco" and anterior and preco:
        try:
            queda = 100 * (float(anterior) - float(preco)) / float(anterior)
            if queda > 0:
                linhas.extend(("", f"📉 Reapareceu porque caiu {queda:.0f}% desde a última publicação"))
        except (TypeError, ValueError, ZeroDivisionError):
            pass

    prep = fmt._PREPOSICAO.get(fonte, "na")
    linhas.extend(("", f"🛒 Comprar {prep} {fonte}: {link_afiliado}",
                   "", "ℹ️ Link de afiliado; o canal pode receber comissão sem custo adicional para você."))
    return "\n".join(linhas)


def _publicar(recurso: str, dados: dict) -> dict:
    url = _endpoint(recurso)
    headers = {"Authorization": f"Bearer {config.FACEBOOK_PAGE_ACCESS_TOKEN}"}
    ultimo = None
    for tentativa in range(config.HTTP_MAX_TENTATIVAS):
        try:
            resposta = requests.post(
                url, headers=headers, data=dados, timeout=30,
                allow_redirects=False,
            )
        except requests.RequestException as erro:
            ultimo = erro
            if tentativa + 1 < config.HTTP_MAX_TENTATIVAS:
                time.sleep(tentativa + 1)
                continue
            raise RuntimeError(seguranca.redigir_segredos(
                f"Facebook indisponivel sem confirmacao da publicacao: {ultimo}"
            )) from None
        try:
            corpo = resposta.json() or {}
        except ValueError:
            corpo = {}
        if 200 <= resposta.status_code < 300:
            if corpo.get("id") or corpo.get("post_id"):
                return corpo
            raise RuntimeError("Facebook respondeu sem confirmar o identificador da publicacao")
        detalhe = corpo.get("error", {}).get("message") or resposta.text[:300]
        erro = RespostaFacebookError(seguranca.redigir_segredos(
            f"Facebook recusou a publicacao ({resposta.status_code}): {detalhe}"
        ))
        if resposta.status_code == 429 or resposta.status_code >= 500:
            ultimo = erro
            if tentativa + 1 < config.HTTP_MAX_TENTATIVAS:
                time.sleep(tentativa + 1)
                continue
            raise RuntimeError(seguranca.redigir_segredos(str(ultimo)))
        raise erro
    raise RuntimeError(seguranca.redigir_segredos(str(ultimo)))


def postar(oferta: dict, link_afiliado: str) -> None:
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    texto = montar_texto(oferta, link_afiliado)
    imagem = oferta.get("imageUrl")
    if imagem:
        try:
            imagem = seguranca.validar_url_https_publica(imagem, "URL da imagem")
        except ValueError:
            imagem = None
    if imagem:
        try:
            _publicar("photos", {"url": imagem, "caption": texto, "published": "true"})
            return
        except RespostaFacebookError:
            # Como houve resposta definitiva da Meta, sabemos que a foto nao foi
            # publicada e o fallback de texto nao cria uma duplicata.
            pass
    _publicar("feed", {"message": texto, "link": link_afiliado})
