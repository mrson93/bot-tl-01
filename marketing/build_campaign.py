"""Monta a peça final da campanha com marca e textos determinísticos."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
PASTA = ROOT / "marketing"
SAIDA = PASTA / "campanha-seguidores-facebook.png"
VERMELHO = "#ED1C24"
AMARELO = "#FFC400"
ESCURO = "#252525"


def fonte(tamanho):
    caminhos = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    )
    for caminho in caminhos:
        if Path(caminho).is_file():
            return ImageFont.truetype(caminho, tamanho)
    raise RuntimeError("Fonte em negrito não encontrada")


def logo_original():
    with Image.open(ROOT / "assets" / "canal-ta-barato-logo.jpg") as arquivo:
        logo = arquivo.convert("RGB").crop((20, 92, 300, 232))
    pixels = logo.load()
    for y in range(logo.height):
        for x in range(logo.width):
            vermelho, verde, azul = pixels[x, y]
            if vermelho > 200 and verde > 130 and azul < 90:
                pixels[x, y] = (255, 196, 0)
    return ImageOps.contain(logo, (280, 140), Image.Resampling.LANCZOS)


def montar():
    with Image.open(PASTA / "campanha-seguidores-base.png") as arquivo:
        imagem = ImageOps.fit(arquivo.convert("RGB"), (1080, 1080),
                             method=Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(imagem, "RGBA")
    # A base foi criada com uma área superior limpa; a faixa suave garante
    # contraste consistente nos posicionamentos automáticos de anúncios.
    draw.rounded_rectangle((65, 35, 1015, 328), radius=38,
                           fill=(255, 253, 247, 242))
    logo = logo_original()
    imagem.paste(logo, ((1080 - logo.width) // 2, 35))
    draw.text((540, 220), "OFERTAS DE VERDADE", font=fonte(51),
              fill=ESCURO, anchor="mm")
    draw.text((540, 279), "TODOS OS DIAS", font=fonte(46),
              fill=VERMELHO, anchor="mm")

    draw.rounded_rectangle((93, 946, 987, 1035), radius=43,
                           fill=(237, 28, 36, 246))
    draw.text((540, 990), "SIGA E MARQUE COMO FAVORITO", font=fonte(34),
              fill="white", anchor="mm")
    imagem.save(SAIDA, format="PNG", optimize=True)


if __name__ == "__main__":
    montar()
