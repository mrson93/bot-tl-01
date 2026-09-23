"""Publica ofertas no X pelo canal conectado ao Buffer."""
import os
import re

import buffer_facebook as buffer_api
import feed_card
import seguranca
import telegram_poster as fmt
import store
import turnos
import time


NOME = "X"
TRACKING_ID = "x"
_CHANNEL_ID = re.compile(r"^[0-9a-f]{24}$", re.IGNORECASE)
_LIMITE_TEXTO = 280
_URL = re.compile(r"https://[^\s]+", re.IGNORECASE)
_TCO_TAMANHO = 23


def _comprimento_x(texto: str) -> int:
    """Conta URLs como o X depois do encurtamento automático por t.co."""
    total = 0
    inicio = 0
    for encontrado in _URL.finditer(texto):
        total += len(texto[inicio:encontrado.start()]) + _TCO_TAMANHO
        inicio = encontrado.end()
    return total + len(texto[inicio:])


def _canal() -> str:
    return os.getenv("BUFFER_X_CHANNEL_ID", "").strip()


def _chave() -> str:
    """Reaproveita a chave do Facebook quando ambos estão no mesmo Buffer."""
    return (os.getenv("BUFFER_X_API_KEY", "").strip()
            or os.getenv("BUFFER_API_KEY", "").strip())


def esta_configurada() -> bool:
    return bool(len(_chave()) >= 20 and _CHANNEL_ID.fullmatch(_canal()))


def pode_publicar() -> bool:
    turno, inicio, fim = turnos.janela()
    return (esta_configurada()
            and store.posts_canal_entre(NOME, inicio, fim) < turnos.COTAS[NOME][turno]
            and store.posts_canal_desde(NOME, time.time() - 86400) < 45)


def _preco(valor) -> str:
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return str(valor)
    return f"{numero:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _cortar_palavras(texto: str, limite: int) -> str:
    """Encurta sem cortar palavra e sem acrescentar reticências."""
    texto = " ".join(str(texto).split())
    if len(texto) <= limite:
        return texto
    trecho = texto[:limite + 1]
    if " " in trecho:
        trecho = trecho.rsplit(" ", 1)[0]
    return trecho.rstrip(" ,;:-–—|/.")


def montar_texto(oferta: dict, link_afiliado: str) -> str:
    link = seguranca.validar_url_https_publica(link_afiliado, "Link de afiliado")
    preco = oferta.get("price") or oferta.get("priceMin")
    desconto = float(oferta.get("priceDiscountRate") or 0)
    linha_preco = f"💰 R$ {_preco(preco)}" if preco else ""
    original = oferta.get("precoOriginal")
    try:
        if original and preco and float(original) > float(preco):
            linha_preco = f"💰 De R$ {_preco(original)} por R$ {_preco(preco)}"
        elif desconto:
            linha_preco += f" · {int(round(desconto))}% OFF"
    except (TypeError, ValueError):
        linha_preco += f" · {int(round(desconto))}% OFF"

    cupom = str(oferta.get("cupom") or "").strip()
    linha_cupom = f"🎟 Cupom: {cupom}" if cupom else ""
    condicao = str(oferta.get("cupomCondicao") or "").strip()[:80]
    linha_condicao = f"ℹ️ {condicao}" if cupom and condicao else ""
    reputacao = []
    if oferta.get("ratingStar"):
        reputacao.append(f"⭐ {float(oferta['ratingStar']):.1f}")
    if oferta.get("sales"):
        reputacao.append(f"🛍️ {fmt._milhar(oferta['sales'])} vendidos")
    if oferta.get("shopName"):
        reputacao.append(f"🏬 {str(oferta['shopName']).strip()}")
    rodape = (f"🛒 {fmt.rotulo_publicidade(oferta)} · "
              f"{fmt.chamada_compra(oferta)}: {link}")
    titulo = fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0)
    titulo = re.sub(r"(?:\.{3,}|…)+$", "", titulo).rstrip() or "Oferta"

    def montar(titulo_atual):
        return "\n\n".join(parte for parte in (
            titulo_atual, linha_preco, " · ".join(reputacao),
            "\n".join(parte for parte in (linha_cupom, linha_condicao) if parte),
            rodape,
        ) if parte)

    texto = montar(titulo)
    for reduzir in ("vendedor", "vendas", "avaliacao", "condicao", "cupom"):
        if _comprimento_x(texto) <= _LIMITE_TEXTO:
            break
        if reduzir == "vendedor":
            reputacao = [item for item in reputacao if not item.startswith("🏬")]
        elif reduzir == "vendas":
            reputacao = [item for item in reputacao if not item.startswith("🛍️")]
        elif reduzir == "avaliacao":
            reputacao = [item for item in reputacao if not item.startswith("⭐")]
        elif reduzir == "condicao":
            linha_condicao = ""
        else:
            linha_cupom = ""
        texto = montar(titulo)
    if _comprimento_x(texto) > _LIMITE_TEXTO:
        fixos = montar("")
        titulo = _cortar_palavras(
            titulo, max(1, _LIMITE_TEXTO - _comprimento_x(fixos) - 2),
        ) or "Oferta"
        texto = montar(titulo)
    if _comprimento_x(texto) > _LIMITE_TEXTO:
        raise RuntimeError("Não foi possível ajustar o texto do X ao limite")
    return texto


def postar(oferta: dict, link_afiliado: str) -> None:
    if not esta_configurada():
        raise RuntimeError("Buffer não configurado para o X")
    texto = montar_texto(oferta, link_afiliado)
    try:
        card = feed_card.gerar(oferta)
    except (OSError, RuntimeError, ValueError) as erro:
        print("   ⚠️  X sem card personalizado: "
              f"{seguranca.redigir_segredos(erro)}")
        card = None
    chave = _chave()
    def criar():
        try:
            return buffer_api.publicar_no_canal(
                texto, card, oferta.get("imageUrl"), _canal(), api_key=chave,
            )
        except buffer_api.FalhaHospedagemCard as erro:
            print("   ⚠️  X via Buffer sem card personalizado: "
                  f"{seguranca.redigir_segredos(erro)}")
            return buffer_api.publicar_no_canal(
                texto, None, oferta.get("imageUrl"), _canal(), api_key=chave,
            )
    buffer_api.publicar_confirmado(
        str(oferta.get("oferta_id") or ""), NOME, criar, api_key=chave,
    )
