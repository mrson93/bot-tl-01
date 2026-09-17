"""Publica ofertas no X pelo canal conectado ao Buffer."""
import os
import re

import buffer_facebook as buffer_api
import feed_card
import seguranca
import telegram_poster as fmt


NOME = "X"
TRACKING_ID = "x"
_CHANNEL_ID = re.compile(r"^[0-9a-f]{24}$", re.IGNORECASE)
_LIMITE_TEXTO = 280


def _canal() -> str:
    return os.getenv("BUFFER_X_CHANNEL_ID", "").strip()


def esta_configurada() -> bool:
    chave = os.getenv("BUFFER_API_KEY", "").strip()
    return bool(len(chave) >= 20 and _CHANNEL_ID.fullmatch(_canal()))


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
    if desconto:
        linha_preco += f" · {int(round(desconto))}% OFF"

    cupom = str(oferta.get("cupom") or "").strip()
    linha_cupom = f"🎟 Cupom: {cupom}" if cupom else ""
    rodape = f"🛒 Ver oferta {fmt.rotulo_publicidade()}: {link}"
    abertura = fmt.chamada_inicial(oferta)
    fixos = "\n\n".join(parte for parte in
                         (abertura, linha_preco, linha_cupom, rodape) if parte)
    espaco_titulo = max(1, _LIMITE_TEXTO - len(fixos) - 2)
    titulo = fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0)
    titulo = re.sub(r"(?:\.{3,}|…)+$", "", titulo).rstrip()
    titulo = _cortar_palavras(titulo, espaco_titulo) or "Oferta"
    texto = "\n\n".join(parte for parte in
                         (abertura, titulo, linha_preco, linha_cupom, rodape)
                         if parte)
    if len(texto) > _LIMITE_TEXTO and abertura:
        abertura = ""
        fixos = "\n\n".join(parte for parte in
                             (linha_preco, linha_cupom, rodape) if parte)
        titulo = _cortar_palavras(
            fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0),
            max(1, _LIMITE_TEXTO - len(fixos) - 2),
        ) or "Oferta"
        texto = "\n\n".join(parte for parte in
                             (titulo, linha_preco, linha_cupom, rodape) if parte)
    if len(texto) > _LIMITE_TEXTO and linha_cupom:
        linha_cupom = ""
        fixos = "\n\n".join(parte for parte in (linha_preco, rodape) if parte)
        titulo = _cortar_palavras(
            fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0),
            max(1, _LIMITE_TEXTO - len(fixos) - 2),
        ) or "Oferta"
        texto = "\n\n".join(parte for parte in (titulo, linha_preco, rodape) if parte)
    if len(texto) > _LIMITE_TEXTO:
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
    try:
        buffer_api.publicar_no_canal(
            texto, card, oferta.get("imageUrl"), _canal()
        )
    except buffer_api.FalhaHospedagemCard as erro:
        print("   ⚠️  X via Buffer sem card personalizado: "
              f"{seguranca.redigir_segredos(erro)}")
        buffer_api.publicar_no_canal(
            texto, None, oferta.get("imageUrl"), _canal()
        )
