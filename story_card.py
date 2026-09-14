"""Gera o cartão vertical usado nos Stories de ofertas."""
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

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


def _quebrar_completo(draw, texto, fonte, largura):
    """Quebra todo o texto sem omitir palavras nem acrescentar reticências."""
    linhas, atual = [], ""
    for palavra in str(texto or "Oferta").split():
        teste = f"{atual} {palavra}".strip()
        if draw.textbbox((0, 0), teste, font=fonte)[2] <= largura:
            atual = teste
            continue
        if atual:
            linhas.append(atual)
            atual = ""
        # Marketplaces às vezes devolvem um código sem espaços maior que a
        # caixa. Ele também precisa ser preservado, então quebramos por letra.
        pedaco = ""
        for caractere in palavra:
            teste = pedaco + caractere
            if pedaco and draw.textbbox((0, 0), teste, font=fonte)[2] > largura:
                linhas.append(pedaco)
                pedaco = caractere
            else:
                pedaco = teste
        atual = pedaco
    if atual:
        linhas.append(atual)
    return linhas


def _ajustar_titulo(draw, texto, largura=850, altura=220):
    """Escolhe a maior fonte que comporte o título completo no cartão."""
    for tamanho in (49, 45, 41, 37, 33, 29, 25, 22, 20):
        fonte = _fonte(tamanho, True)
        linhas = _quebrar_completo(draw, texto, fonte, largura)
        entrelinha = tamanho + 7
        if len(linhas) <= 6 and len(linhas) * entrelinha <= altura:
            return linhas, fonte, entrelinha
    fonte = _fonte(18, True)
    linhas = _quebrar_completo(draw, texto, fonte, largura)
    return linhas, fonte, 22


def _desenhar_logo(draw):
    """Desenha a marca do canal em formato de ingresso no cabeçalho."""
    amarelo, vermelho = "#FFC400", "#ED1C24"
    draw.rounded_rectangle((54, 54, 1026, 226), radius=54, fill=amarelo)
    draw.rectangle((54, 150, 1026, 226), fill=amarelo)
    ingresso = (244, 76, 836, 208)
    draw.rounded_rectangle(ingresso, radius=8, fill=vermelho)
    raio = 25
    for x, y in ((244, 142), (836, 142), (540, 76), (540, 208)):
        draw.ellipse((x - raio, y - raio, x + raio, y + raio), fill=amarelo)
    draw.text((446, 142), "TÁ", font=_fonte(48, True), fill="white", anchor="mm")
    for y in (111, 136, 161):
        draw.rectangle((532, y, 548, y + 13), fill=amarelo)
    draw.text((681, 142), "BARATO", font=_fonte(48, True), fill="white", anchor="mm")


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


def _link_exibivel(link):
    """Mostra o atalho no domínio principal, sem protocolo ou www."""
    partes = urlsplit(link)
    host = partes.netloc.removeprefix("www.")
    # O redirecionador vive em go.*, mas o site encaminha o mesmo código na
    # raiz. Isso economiza caracteres importantes em uma imagem de Story.
    if host == "go.canaltabarato.com.br" and not partes.query and not partes.fragment:
        host = "canaltabarato.com.br"
    return urlunsplit(("", host, partes.path or "/",
                       partes.query, partes.fragment)).lstrip("//")


def _quebrar_link(draw, texto, largura, max_linhas=3):
    """Quebra URL sem inserir caracteres; quem digitar continuará no destino."""
    for tamanho in (40, 36, 32, 28, 25, 22, 19, 17):
        fonte = _fonte(tamanho, True)
        linhas, atual = [], ""
        for caractere in texto:
            teste = atual + caractere
            if atual and draw.textbbox((0, 0), teste, font=fonte)[2] > largura:
                linhas.append(atual)
                atual = caractere
            else:
                atual = teste
        if atual:
            linhas.append(atual)
        if len(linhas) <= max_linhas:
            return linhas, fonte
    return linhas[:max_linhas], fonte


def gerar(oferta: dict, link: str, direct_ativo=False) -> bytes:
    """Devolve JPEG 9:16 com o endereço curto exato da oferta."""
    link = seguranca.validar_url_https_publica(link, "Link do Story")
    canvas = Image.new("RGB", (LARGURA, ALTURA), "#FFC400")
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((54, 54, 1026, 1866), radius=54, fill="#FFFDF7")
    _desenhar_logo(draw)

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

    titulo = fmt.limpar_titulo(oferta.get("productName") or "Oferta", 0)
    linhas, titulo_fonte, entrelinha = _ajustar_titulo(draw, titulo)
    y = 1048
    for linha in linhas:
        draw.text((540, y), linha, font=titulo_fonte, fill="#252525", anchor="ma")
        y += entrelinha

    preco = oferta.get("price") or oferta.get("priceMin")
    draw.text((540, 1280), _preco(preco), font=_fonte(92, True), fill="#ED1C24", anchor="mm")
    desconto = float(oferta.get("priceDiscountRate") or 0)
    if desconto:
        draw.rounded_rectangle((365, 1342, 715, 1422), radius=38, fill="#252525")
        draw.text((540, 1382), f"{int(round(desconto))}% OFF", font=_fonte(42, True), fill="white", anchor="mm")

    draw.text((540, 1482), "ACESSE A OFERTA", font=_fonte(38, True),
              fill="#ED1C24", anchor="ma")
    linhas_link, fonte_link = _quebrar_link(
        draw, _link_exibivel(link), 820, max_linhas=4
    )
    y_link = 1542
    for linha in linhas_link:
        draw.text((540, y_link), linha, font=fonte_link,
                  fill="#252525", anchor="ma")
        y_link += fonte_link.size + 8
    draw.text((540, max(1685, y_link + 10)), "Digite o endereço no navegador",
              font=_fonte(24), fill="#555555", anchor="ma")
    fonte = str(oferta.get("fonte") or "loja")
    draw.text((470, 1720), f"Oferta {fonte}", font=_fonte(27, True), fill="#555555")
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
