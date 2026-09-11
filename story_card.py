"""Gera o cartão vertical usado nos Stories de ofertas."""
from io import BytesIO
from pathlib import Path

import qrcode
import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps

import seguranca
import telegram_poster as fmt


LARGURA = 1080
ALTURA = 1920
MAX_DOWNLOAD = 5_000_000


def _fonte(tamanho, negrito=False):
    nomes = (
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
        if negrito else
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/System/Library/Fonts/Supplemental/Arial.ttf")
    )
    for nome in nomes:
        if Path(nome).is_file():
            return ImageFont.truetype(nome, tamanho)
    raise RuntimeError("Fonte necessária para o cartão do Story não encontrada")


def _quebrar(draw, texto, fonte, largura, max_linhas):
    palavras = str(texto or "Oferta").split()
    linhas, atual = [], ""
    for palavra in palavras:
        teste = f"{atual} {palavra}".strip()
        if draw.textbbox((0, 0), teste, font=fonte)[2] <= largura:
            atual = teste
        else:
            if atual:
                linhas.append(atual)
            atual = palavra
            if len(linhas) == max_linhas - 1:
                break
    if atual and len(linhas) < max_linhas:
        linhas.append(atual)
    usado = sum(len(linha.split()) for linha in linhas)
    if usado < len(palavras) and linhas:
        while linhas[-1] and draw.textbbox(
            (0, 0), linhas[-1] + "…", font=fonte
        )[2] > largura:
            linhas[-1] = linhas[-1][:-1].rstrip()
        linhas[-1] += "…"
    return linhas


def _baixar_imagem(url):
    if not url:
        return None
    try:
        url = seguranca.validar_url_https_publica(
            url, "URL da imagem do produto", resolver=True
        )
        resposta = requests.get(
            url, stream=True, timeout=15, allow_redirects=False,
            headers={"User-Agent": "CanalTaBarato/1.0"},
        )
        try:
            if not 200 <= resposta.status_code < 300:
                return None
            if not str(resposta.headers.get("Content-Type") or "").lower().startswith("image/"):
                return None
            tamanho = int(resposta.headers.get("Content-Length") or 0)
            if tamanho > MAX_DOWNLOAD:
                return None
            partes, total = [], 0
            for parte in resposta.iter_content(64 * 1024):
                total += len(parte)
                if total > MAX_DOWNLOAD:
                    return None
                partes.append(parte)
        finally:
            resposta.close()
        imagem = Image.open(BytesIO(b"".join(partes)))
        imagem.load()
        return ImageOps.exif_transpose(imagem).convert("RGB")
    except (OSError, ValueError, requests.RequestException):
        return None


def _preco(valor):
    try:
        return f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return "OFERTA"


def gerar(oferta: dict, link: str) -> bytes:
    """Devolve um JPEG 9:16 com QR code do link afiliado rastreado."""
    link = seguranca.validar_url_https_publica(link, "Link do Story")
    canvas = Image.new("RGB", (LARGURA, ALTURA), "#FFC400")
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((54, 54, 1026, 1866), radius=54, fill="#FFFDF7")
    draw.rounded_rectangle((54, 54, 1026, 226), radius=54, fill="#ED1C24")
    draw.rectangle((54, 150, 1026, 226), fill="#ED1C24")
    draw.text((540, 140), "TÁ BARATO", font=_fonte(72, True), fill="white", anchor="mm")

    produto = _baixar_imagem(oferta.get("imageUrl"))
    caixa = (130, 270, 950, 1030)
    draw.rounded_rectangle(caixa, radius=38, fill="white", outline="#EFE4D1", width=4)
    if produto:
        ajustada = ImageOps.contain(produto, (760, 700), Image.Resampling.LANCZOS)
        x = (LARGURA - ajustada.width) // 2
        y = 300 + (690 - ajustada.height) // 2
        canvas.paste(ajustada, (x, y))
    else:
        draw.text((540, 650), "OFERTA DO DIA", font=_fonte(64, True), fill="#ED1C24", anchor="mm")

    titulo = fmt.limpar_titulo(oferta.get("productName") or "Oferta", 92)
    titulo_fonte = _fonte(49, True)
    linhas = _quebrar(draw, titulo, titulo_fonte, 850, 3)
    y = 1065
    for linha in linhas:
        draw.text((540, y), linha, font=titulo_fonte, fill="#252525", anchor="ma")
        y += 59

    preco = oferta.get("price") or oferta.get("priceMin")
    draw.text((540, 1280), _preco(preco), font=_fonte(92, True), fill="#ED1C24", anchor="mm")
    desconto = float(oferta.get("priceDiscountRate") or 0)
    if desconto:
        draw.rounded_rectangle((365, 1342, 715, 1422), radius=38, fill="#252525")
        draw.text((540, 1382), f"{int(round(desconto))}% OFF", font=_fonte(42, True), fill="white", anchor="mm")

    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=3)
    qr.add_data(link)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#111111", back_color="white").convert("RGB")
    qr_img = qr_img.resize((300, 300), Image.Resampling.NEAREST)
    canvas.paste(qr_img, (130, 1480))

    draw.text((470, 1510), "COMO COMPRAR", font=_fonte(42, True), fill="#ED1C24")
    draw.multiline_text(
        (470, 1570), "Aponte a câmera para o QR code\nou salve e abra pelo Lens.",
        font=_fonte(31), fill="#252525", spacing=12,
    )
    fonte = str(oferta.get("fonte") or "loja")
    draw.text((470, 1680), f"Oferta {fonte}", font=_fonte(29, True), fill="#555555")
    draw.text((540, 1822), "Link de afiliado • preço pode mudar", font=_fonte(24), fill="#6B6B6B", anchor="mm")

    saida = BytesIO()
    canvas.save(saida, format="JPEG", quality=86, optimize=True, progressive=True)
    conteudo = saida.getvalue()
    if len(conteudo) > 850_000:
        saida = BytesIO()
        canvas.save(saida, format="JPEG", quality=76, optimize=True)
        conteudo = saida.getvalue()
    if len(conteudo) > 850_000:
        raise RuntimeError("Não foi possível compactar o cartão do Story")
    return conteudo
