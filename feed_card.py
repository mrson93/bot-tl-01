"""Gera o cartão 4:5 usado nas ofertas do feed do Facebook."""
from io import BytesIO
from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageOps

import story_card as base
import telegram_poster as fmt


LARGURA = 1080
ALTURA = 1350
MAX_JPEG = 1_000_000


def _altura_bloco_texto(draw, linhas, fonte, entrelinha):
    if not linhas:
        return 0
    ultima = draw.textbbox((0, 0), linhas[-1], font=fonte)
    return (len(linhas) - 1) * entrelinha + ultima[3] - ultima[1]


def _desenhar_logo(canvas):
    caminho = Path(__file__).with_name("assets") / "canal-ta-barato-logo.jpg"
    try:
        with Image.open(caminho) as original:
            logo = original.convert("RGB").crop((20, 92, 300, 232))
        pixels = logo.load()
        for y in range(logo.height):
            for x in range(logo.width):
                vermelho, verde, azul = pixels[x, y]
                if vermelho > 200 and verde > 130 and azul < 90:
                    pixels[x, y] = (255, 253, 247)
        logo = ImageOps.contain(logo, (330, 118), Image.Resampling.LANCZOS)
        canvas.paste(logo, ((LARGURA - logo.width) // 2, 62))
    except OSError as erro:
        raise RuntimeError("Logo original do canal não encontrada") from erro


def _ajustar_titulo(draw, texto, largura=860, altura=174):
    for tamanho in (46, 42, 38, 34, 30, 27, 24, 21):
        fonte = base._fonte(tamanho, True)
        linhas = base._quebrar_completo(draw, texto, fonte, largura)
        entrelinha = tamanho + 6
        bloco = _altura_bloco_texto(draw, linhas, fonte, entrelinha)
        if len(linhas) <= 5 and bloco <= altura:
            return linhas, fonte, entrelinha
    fonte = base._fonte(19, True)
    return base._quebrar_completo(draw, texto, fonte, largura), fonte, 24


def _layout_texto(draw, linhas, fonte, entrelinha, preco, desconto):
    titulo_topo = 820
    titulo_fim = titulo_topo + _altura_bloco_texto(
        draw, linhas, fonte, entrelinha
    )
    preco_fonte = base._fonte(82 if len(preco) <= 13 else 70, True)
    caixa_preco = draw.textbbox((0, 0), preco, font=preco_fonte)
    preco_topo = titulo_fim + 22
    preco_fim = preco_topo + caixa_preco[3] - caixa_preco[1]
    desconto_topo = preco_fim + 10 if desconto else None
    desconto_fim = desconto_topo + 58 if desconto else preco_fim
    return {
        "titulo_topo": titulo_topo,
        "titulo_fim": titulo_fim,
        "preco_fonte": preco_fonte,
        "preco_topo": preco_topo,
        "preco_fim": preco_fim,
        "desconto_topo": desconto_topo,
        "desconto_fim": desconto_fim,
        "cta_topo": max(1140, desconto_fim + 24),
    }


def gerar(oferta: dict) -> bytes:
    """Devolve um JPEG 4:5 pronto para ser anexado ao post do feed."""
    canvas = Image.new("RGB", (LARGURA, ALTURA), "#FFC400")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((42, 42, 1038, 1308), radius=48, fill="#FFFDF7")
    _desenhar_logo(canvas)
    draw.text((540, 194), "OFERTA DO DIA", font=base._fonte(34, True),
              fill="#252525", anchor="mm")

    draw.rounded_rectangle((113, 253, 977, 793), radius=36, fill="#E9DFCE")
    draw.rounded_rectangle((103, 243, 967, 783), radius=36, fill="white",
                           outline="#EFE4D1", width=4)
    produto = base._baixar_imagem(oferta.get("imageUrl"))
    if produto:
        ajustada = ImageOps.contain(produto, (790, 490), Image.Resampling.LANCZOS)
        canvas.paste(ajustada, ((LARGURA - ajustada.width) // 2,
                               268 + (465 - ajustada.height) // 2))
    else:
        draw.text((540, 510), "OFERTA DE VERDADE", font=base._fonte(51, True),
                  fill="#ED1C24", anchor="mm")

    fonte_loja = str(oferta.get("fonte") or "OFERTA").upper()[:28]
    draw.rounded_rectangle((128, 266, 128 + max(150, 19 * len(fonte_loja)), 322),
                           radius=28, fill="#252525")
    draw.text((153, 294), fonte_loja, font=base._fonte(24, True),
              fill="white", anchor="lm")

    titulo = fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0)
    # Alguns catálogos já devolvem o nome visualmente truncado. Não repetimos
    # as reticências no criativo, onde parecem um corte feito pelo nosso bot.
    titulo = re.sub(r"(?:\.{3,}|…)+$", "", titulo).rstrip() or "Oferta"
    linhas, titulo_fonte, entrelinha = _ajustar_titulo(draw, titulo)
    preco = base._preco(oferta.get("price") or oferta.get("priceMin"))
    desconto = float(oferta.get("priceDiscountRate") or 0)
    layout = _layout_texto(
        draw, linhas, titulo_fonte, entrelinha, preco, desconto
    )
    y = layout["titulo_topo"]
    for linha in linhas:
        draw.text((540, y), linha, font=titulo_fonte, fill="#252525", anchor="mt")
        y += entrelinha

    draw.text((540, layout["preco_topo"]), preco, font=layout["preco_fonte"],
              fill="#ED1C24", anchor="mt")
    if desconto:
        texto_desconto = f"{int(round(desconto))}% OFF"
        fonte_desconto = base._fonte(31, True)
        largura = draw.textbbox((0, 0), texto_desconto, font=fonte_desconto)[2] + 64
        x1 = (LARGURA - largura) / 2
        draw.rounded_rectangle((x1, layout["desconto_topo"], x1 + largura,
                                layout["desconto_fim"]), radius=29, fill="#252525")
        draw.text((540, layout["desconto_topo"] + 29), texto_desconto,
                  font=fonte_desconto, fill="white", anchor="mm")

    cta_topo = layout["cta_topo"]
    draw.rounded_rectangle((145, cta_topo, 935, cta_topo + 72),
                           radius=36, fill="#ED1C24")
    draw.text((540, cta_topo + 36), "CONFIRA O LINK NA LEGENDA",
              font=base._fonte(29, True), fill="white", anchor="mm")
    draw.text((540, 1281), "Link de afiliado • preço pode mudar",
              font=base._fonte(21), fill="#666666", anchor="mm")

    saida = BytesIO()
    canvas.save(saida, format="JPEG", quality=88, optimize=True, progressive=True)
    conteudo = saida.getvalue()
    if len(conteudo) > MAX_JPEG:
        saida = BytesIO()
        canvas.save(saida, format="JPEG", quality=78, optimize=True)
        conteudo = saida.getvalue()
    if len(conteudo) > MAX_JPEG:
        raise RuntimeError("Não foi possível compactar o cartão do feed")
    return conteudo
