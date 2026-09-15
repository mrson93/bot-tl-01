"""Publica ofertas em uma Pagina do Facebook usando a Graph API."""
import json
import re
import time

import requests

import buffer_facebook
import config
import desempenho
import experimentos
import feed_card
import seguranca
import store
import telegram_poster as fmt


NOME = "Facebook"
TRACKING_ID = config.FACEBOOK_TRACKING_ID
_VERSAO = re.compile(r"^v\d{1,3}\.\d{1,2}$")


class RespostaFacebookError(RuntimeError):
    """A Meta respondeu de forma definitiva e permite fallback seguro."""


def esta_configurada() -> bool:
    direta = bool(config.FACEBOOK_PAGE_ID and config.FACEBOOK_PAGE_ACCESS_TOKEN)
    return bool(config.FACEBOOK_ATIVO and (buffer_facebook.esta_configurado() or direta))


def pode_publicar() -> bool:
    limite = config.FACEBOOK_MAX_POSTS_DIA
    return (esta_configurada()
            and (limite == 0 or store.posts_canal_hoje(NOME) < limite))


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
    # O Facebook comporta a legenda completa; limitar aqui criava reticências
    # desnecessárias mesmo quando o card ainda tinha espaço para o título.
    titulo = fmt.limpar_titulo(oferta.get("productName", "Oferta"), 0)
    titulo = re.sub(r"(?:\.{3,}|…)+$", "", titulo).rstrip() or "Oferta"
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


def _publicar(recurso: str, dados: dict, arquivo=None) -> dict:
    url = _endpoint(recurso)
    headers = {"Authorization": f"Bearer {config.FACEBOOK_PAGE_ACCESS_TOKEN}"}
    ultimo = None
    for tentativa in range(config.HTTP_MAX_TENTATIVAS):
        try:
            argumentos = {"headers": headers, "data": dados, "timeout": 30,
                          "allow_redirects": False}
            if arquivo is not None:
                argumentos["files"] = {
                    "source": ("oferta-feed.jpg", arquivo, "image/jpeg")
                }
            resposta = requests.post(url, **argumentos)
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
    try:
        card = feed_card.gerar(oferta)
    except (OSError, RuntimeError, ValueError) as erro:
        print("   ⚠️  Facebook sem card personalizado: "
              f"{seguranca.redigir_segredos(erro)}")
        card = None
    if buffer_facebook.esta_configurado():
        try:
            buffer_facebook.publicar(texto, card, oferta.get("imageUrl"))
        except buffer_facebook.FalhaHospedagemCard as erro:
            # Se a hospedagem temporária do card falhar, ainda tentamos a foto
            # original da oferta. Uma falha da API não cai na integração direta
            # da Meta, pois isso poderia criar dois posts.
            print("   ⚠️  Facebook via Buffer sem card personalizado: "
                  f"{seguranca.redigir_segredos(erro)}")
            buffer_facebook.publicar(texto, None, oferta.get("imageUrl"))
        return
    if card:
        try:
            foto = _publicar("photos", {"published": "false"}, arquivo=card)
            foto_id = str(foto.get("id") or "")
            if not foto_id:
                raise RuntimeError("Facebook respondeu sem confirmar o identificador da foto")
            _publicar("feed", {
                "message": texto,
                "published": "true",
                "attached_media[0]": json.dumps({"media_fbid": foto_id}),
            })
            return
        except RespostaFacebookError:
            pass

    imagem = oferta.get("imageUrl")
    if imagem:
        try:
            imagem = seguranca.validar_url_https_publica(imagem, "URL da imagem")
        except ValueError:
            imagem = None
    if imagem:
        try:
            # Primeiro cria apenas o ativo de imagem, sem publica-lo como uma
            # entrada independente da secao Fotos. Depois anexa esse ativo a
            # um post criado explicitamente no feed da Pagina.
            foto = _publicar("photos", {"url": imagem, "published": "false"})
            foto_id = str(foto.get("id") or "")
            if not foto_id:
                raise RuntimeError("Facebook respondeu sem confirmar o identificador da foto")
            _publicar("feed", {
                "message": texto,
                "published": "true",
                "attached_media[0]": json.dumps({"media_fbid": foto_id}),
            })
            return
        except RespostaFacebookError:
            # Uma recusa definitiva ao upload permite criar o post de link sem
            # risco de duplicar uma publicacao visivel.
            pass
    _publicar("feed", {"message": texto, "link": link_afiliado})
