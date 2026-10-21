"""Guias de compra automáticos para o blog (um por dia, por rodízio de pautas).

Cada pauta corresponde a uma busca real ("melhor air fryer até R$ 600") e tem
endereço fixo no site: quando volta no rodízio, a mesma página é atualizada com
preços e produtos atuais, em vez de criar páginas novas e rasas todo dia.

Os produtos vêm das APIs oficiais de afiliados (Shopee e AliExpress), não só do
que já foi postado nas redes. Nada é inventado: o texto usa apenas preço,
avaliação, vendas, loja e características que constam no anúncio.
"""
import math
import re
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

import aliexpress
import config
import desempenho
import seguranca
import shopee
import site_publisher
import store

FUSO = ZoneInfo("America/Sao_Paulo")
MIN_PRODUTOS = 4
MAX_PRODUTOS = 5
_MESES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
          "agosto", "setembro", "outubro", "novembro", "dezembro")

# Pautas de busca. "termos": ao menos um precisa estar no título;
# "excluir": acessórios e peças que não são o produto comparado.
PAUTAS = [
    {"slug": "melhor-air-fryer-ate-600-reais", "genero": "f", "busca": "air fryer", "nome": "air fryer",
     "plural": "air fryers", "preco_max": 600, "termos": ["air fryer", "fritadeira eletrica"],
     "buscas_extras": ["fritadeira eletrica air fryer 4l", "air fryer mondial"],
     "excluir": ["forma", "papel", "forro", "cesto", "tapete", "acessorio", "kit acessorios"],
     "criterios": ["Capacidade útil do cesto (em litros) para o tamanho da família",
                   "Potência e faixa de temperatura",
                   "Facilidade de limpeza, revestimento antiaderente e voltagem"]},
    {"slug": "melhor-fone-bluetooth-ate-200-reais", "genero": "m", "busca": "fone bluetooth", "nome": "fone bluetooth",
     "plural": "fones bluetooth", "preco_max": 200, "termos": ["fone", "headphone", "earbud", "headset"],
     "buscas_extras": ["fone de ouvido bluetooth sem fio"],
     "excluir": ["capa", "case para", "estojo para", "almofada", "espuma", "suporte", "cabo"],
     "criterios": ["Formato (intra-auricular, over-ear) e conforto",
                   "Versão do Bluetooth, cancelamento de ruído e microfone",
                   "Autonomia da bateria e resistência à água"]},
    {"slug": "melhor-power-bank-ate-150-reais", "genero": "m", "busca": "power bank", "nome": "power bank",
     "plural": "power banks", "preco_max": 150, "termos": ["power bank", "powerbank", "carregador portatil", "bateria portatil"],
     "excluir": ["capa", "case", "bolsa", "suporte", "cabo para"],
     "criterios": ["Capacidade em mAh e quantas cargas ela rende",
                   "Potência de saída e carregamento rápido (PD/QC)",
                   "Número de portas, peso e proteções elétricas"]},
    {"slug": "melhor-smartwatch-ate-300-reais", "genero": "m", "busca": "smartwatch", "nome": "smartwatch",
     "plural": "smartwatches", "preco_max": 300, "termos": ["smartwatch", "relogio inteligente"],
     "excluir": ["pulseira", "capa", "case", "pelicula", "carregador", "suporte"],
     "criterios": ["Compatibilidade com Android e iPhone",
                   "Sensores (frequência cardíaca, oxigenação, GPS)",
                   "Autonomia e resistência à água"]},
    {"slug": "melhor-caixa-de-som-bluetooth-ate-300-reais", "genero": "f", "busca": "caixa de som bluetooth",
     "nome": "caixa de som bluetooth", "plural": "caixas de som bluetooth", "preco_max": 300,
     "termos": ["caixa de som", "speaker"], "excluir": ["capa", "case", "suporte", "bolsa"],
     "criterios": ["Potência (W) e qualidade sonora",
                   "Autonomia da bateria e conexões",
                   "Resistência à água e portabilidade"]},
    {"slug": "melhor-aspirador-vertical-ate-500-reais", "genero": "m", "busca": "aspirador de po vertical",
     "nome": "aspirador vertical", "plural": "aspiradores verticais", "preco_max": 500,
     "termos": ["aspirador"], "excluir": ["filtro", "bico", "mangueira", "saco para", "peca", "refil"],
     "criterios": ["Potência de sucção e tipo de filtro",
                   "Capacidade do reservatório e acessórios",
                   "Com fio ou bateria: alcance e autonomia"]},
    {"slug": "melhor-cafeteira-ate-400-reais", "genero": "f", "busca": "cafeteira", "nome": "cafeteira",
     "plural": "cafeteiras", "preco_max": 400, "termos": ["cafeteira"],
     "excluir": ["filtro", "capsula", "jarra", "capa", "suporte", "refil"],
     "criterios": ["Tipo de café (filtro, expresso, cápsula) e pressão",
                   "Capacidade e custo dos insumos",
                   "Facilidade de limpeza e voltagem"]},
    {"slug": "melhor-ventilador-ate-300-reais", "genero": "m", "busca": "ventilador", "nome": "ventilador",
     "plural": "ventiladores", "preco_max": 300, "termos": ["ventilador"],
     "excluir": ["capa", "helice", "motor", "grade", "peca"],
     "criterios": ["Diâmetro, vazão e número de velocidades",
                   "Nível de ruído", "Consumo de energia, voltagem e segurança"]},
    {"slug": "melhor-parafusadeira-ate-400-reais", "genero": "f", "busca": "parafusadeira", "nome": "parafusadeira",
     "plural": "parafusadeiras", "preco_max": 400, "termos": ["parafusadeira"],
     "excluir": ["broca", "bit", "bateria para", "carregador para", "maleta para"],
     "criterios": ["Torque e controle de velocidade",
                   "Voltagem e tipo de bateria", "Acessórios inclusos e mandril"]},
    {"slug": "melhor-panela-eletrica-de-pressao-ate-500-reais", "genero": "f", "busca": "panela de pressao eletrica",
     "nome": "panela de pressão elétrica", "plural": "panelas de pressão elétricas", "preco_max": 500,
     "termos": ["panela de pressao eletrica", "panela eletrica"],
     "excluir": ["tampa", "anel", "vedacao", "valvula", "organizador"],
     "criterios": ["Capacidade em litros", "Funções programadas e potência",
                   "Segurança (travas e válvulas) e revestimento"]},
    {"slug": "melhor-mouse-gamer-ate-150-reais", "genero": "m", "busca": "mouse gamer", "nome": "mouse gamer",
     "plural": "mouses gamer", "preco_max": 150, "termos": ["mouse"],
     "excluir": ["mousepad", "mouse pad", "pes para", "grip para", "bungee"],
     "criterios": ["Sensor e DPI máximo", "Com fio ou sem fio e taxa de resposta",
                   "Formato, peso e botões programáveis"]},
    {"slug": "melhor-teclado-mecanico-ate-300-reais", "genero": "m", "busca": "teclado mecanico", "nome": "teclado mecânico",
     "plural": "teclados mecânicos", "preco_max": 300, "termos": ["teclado mecanico"],
     "excluir": ["keycap", "switch avulso", "capa", "apoio para"],
     "criterios": ["Tipo de switch e sensação de digitação",
                   "Tamanho (full, TKL, 60%) e layout ABNT2",
                   "Conexão, iluminação e construção"]},
]

_UNIDADES = [
    ("Capacidade", r"(\d{3,6})\s?mah\b", lambda m: f"{int(m.group(1)):,} mAh".replace(",", ".")),
    ("Capacidade", r"(\d{1,2}(?:[.,]\d{1,2})?)\s?(?:l|litros?)\b",
     lambda m: f"{m.group(1).replace('.', ',')} L"),
    ("Potência", r"(\d{2,5})\s?w\b", lambda m: f"{m.group(1)} W"),
    ("Armazenamento", r"(\d{2,4})\s?(gb|tb)\b", lambda m: f"{m.group(1)} {m.group(2).upper()}"),
    ("Tela", r"(\d{1,2}(?:[.,]\d)?)\s?(?:\"|''|polegadas|pol)\b",
     lambda m: f"{m.group(1).replace('.', ',')}\""),
    ("Bluetooth", r"bluetooth\s?(\d\.\d)", lambda m: f"versão {m.group(1)}"),
    ("DPI", r"(\d{3,5})\s?dpi\b", lambda m: f"{int(m.group(1)):,} DPI".replace(",", ".")),
    ("Voltagem", r"\b(bivolt|110\s?v|127\s?v|220\s?v)\b",
     lambda m: m.group(1).replace(" ", "").upper().replace("BIVOLT", "Bivolt")),
]


def _normalizar(texto) -> str:
    base = unicodedata.normalize("NFKD", str(texto or ""))
    base = "".join(c for c in base if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9.,\"]+", " ", base).strip()


def _contem(texto: str, termo: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(_normalizar(termo))}(?![a-z0-9])", texto) is not None


def extrair_ficha(titulo: str) -> dict:
    """Características que o próprio título declara (nunca supostas)."""
    texto = _normalizar(titulo)
    ficha = {}
    for rotulo, padrao, formatar in _UNIDADES:
        if rotulo in ficha:
            continue
        achado = re.search(padrao, texto)
        if achado:
            ficha[rotulo] = formatar(achado)
    return ficha


def _preco(valor) -> str:
    return f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _milhar(valor) -> str:
    valor = int(valor or 0)
    if valor >= 1000:
        return f"{valor / 1000:.1f} mil".replace(".", ",").replace(",0 mil", " mil")
    return str(valor)


def _nota(produto) -> float:
    """Nota de 0 a 5. No AliExpress a API dá % de avaliações positivas."""
    try:
        estrelas = float(produto.get("ratingStar") or 0)
    except (TypeError, ValueError):
        estrelas = 0
    if estrelas:
        return estrelas
    positivas = produto.get("positiveFeedbackPercent")
    return float(positivas) / 20 if positivas else 0.0


def _avaliacao_texto(produto) -> str:
    if produto.get("ratingStar"):
        return f"{float(produto['ratingStar']):.1f} de 5".replace(".", ",")
    if produto.get("positiveFeedbackPercent"):
        return f"{float(produto['positiveFeedbackPercent']):.0f}% positivas"
    return "Sem avaliação"


def _pontuacao(produto) -> float:
    vendas = max(0, int(float(produto.get("sales") or 0)))
    desconto = min(60.0, float(produto.get("priceDiscountRate") or 0))
    nota = (_nota(produto) - 4.0) * 20 + math.log10(vendas + 1) * 8 + desconto * 0.1
    if desempenho.loja_oficial(produto):
        nota += 5
    return nota


# O tipo do produto precisa aparecer no começo do título: "Cabo USB-C ... para
# Power Bank" e "Fone TWS ... com Power Bank" não são power banks.
_POSICAO_MAX_TERMO = 6


def _posicao_palavra(titulo: str, termo: str):
    achado = re.search(rf"(?<![a-z0-9]){re.escape(_normalizar(termo))}(?![a-z0-9])", titulo)
    return len(titulo[:achado.start()].split()) if achado else None


def motivo_rejeicao(produto, pauta):
    titulo = _normalizar(produto.get("productName"))
    try:
        preco = float(produto.get("price") or 0)
    except (TypeError, ValueError):
        return "preco"
    if not pauta["preco_max"] * 0.15 <= preco <= pauta["preco_max"]:
        return "preco"
    if _nota(produto) < 4.5:
        return "avaliacao"
    if int(float(produto.get("sales") or 0)) < 50:
        return "vendas"
    posicoes = [p for p in (_posicao_palavra(titulo, termo) for termo in pauta["termos"])
                if p is not None]
    if not posicoes or min(posicoes) >= _POSICAO_MAX_TERMO:
        return "fora_do_tema"
    if any(_contem(titulo, termo) for termo in pauta["excluir"]):
        return "acessorio"
    if desempenho.parece_replica(produto):
        return "replica"
    if not produto.get("productUrl") or not str(produto.get("imageUrl") or "").startswith("https://"):
        return "sem_link_ou_imagem"
    return None


def _apto(produto, pauta) -> bool:
    return motivo_rejeicao(produto, pauta) is None


def buscar_candidatos(pauta) -> list:
    """Consulta as lojas oficiais pela busca da pauta (sem depender das redes).

    A busca da Shopee mistura muitos acessórios baratos; por isso cada pauta
    pode ter buscas alternativas e lemos duas páginas de cada lista.
    """
    produtos, vistos = [], set()

    def juntar(itens):
        for item in itens:
            if item.get("oferta_id") and item["oferta_id"] not in vistos:
                vistos.add(item["oferta_id"])
                produtos.append(item)

    buscas = [pauta["busca"]] + list(pauta.get("buscas_extras") or [])
    if shopee.esta_configurada() and config.loja_ativa(shopee.NOME):
        for termo in buscas:
            for lista in (0, 2):
                for pagina in (1, 2):
                    try:
                        juntar(shopee._normalizar_produto(n)
                               for n in shopee._buscar_pagina(pagina, lista, termo))
                    except Exception as erro:
                        print(f"   ⚠️  Guia: busca Shopee indisponível ({seguranca.redigir_segredos(erro)})")
                        break
    if aliexpress.esta_configurada() and config.loja_ativa(aliexpress.NOME):
        for termo in buscas:
            try:
                juntar(aliexpress._normalizar_produto(p)
                       for p in aliexpress._buscar_pagina(1, termo))
            except Exception as erro:
                print(f"   ⚠️  Guia: busca AliExpress indisponível ({seguranca.redigir_segredos(erro)})")
    return produtos


def selecionar(produtos, pauta, limite=MAX_PRODUTOS) -> list:
    """Melhores aptos, sem modelos repetidos e no máximo um por loja."""
    escolhidos, lojas = [], set()
    motivos = {}
    for produto in produtos:
        motivo = motivo_rejeicao(produto, pauta)
        if motivo:
            motivos[motivo] = motivos.get(motivo, 0) + 1
    if produtos:
        detalhe = ", ".join(f"{m}={q}" for m, q in sorted(motivos.items())) or "nenhuma"
        print(f"   Diagnostico guia {pauta['slug']}: recebidos={len(produtos)}; rejeicoes: {detalhe}.")
    for produto in sorted((p for p in produtos if _apto(p, pauta)),
                          key=_pontuacao, reverse=True):
        loja = str(produto.get("shopName") or "").strip().casefold()
        if loja and loja in lojas:
            continue
        # Só barra anúncios praticamente iguais: modelos diferentes da mesma
        # categoria costumam ter títulos parecidos, e é isso que comparamos.
        if any(desempenho.produtos_semelhantes(produto, outro.get("productName"), 0.85)
               for outro in escolhidos):
            continue
        escolhidos.append(produto)
        if loja:
            lojas.add(loja)
        if len(escolhidos) >= limite:
            break
    return escolhidos


def _destaques(produtos) -> dict:
    return {
        "melhor": max(produtos, key=_pontuacao),
        "avaliado": max(produtos, key=lambda p: (_nota(p), int(float(p.get("sales") or 0)))),
        "vendido": max(produtos, key=lambda p: int(float(p.get("sales") or 0))),
        "barato": min(produtos, key=lambda p: float(p.get("price") or 0)),
    }


def _titulo_curto(produto, limite=80) -> str:
    texto = " ".join(str(produto.get("productName") or "Produto").split())
    return texto if len(texto) <= limite else texto[:limite].rsplit(" ", 1)[0] + "…"


def montar_guia(pauta, produtos, links, agora=None) -> dict:
    """Matéria em markdown + produtos editoriais no formato do painel do site."""
    agora = agora or datetime.now(FUSO)
    mes = f"{_MESES[agora.month - 1]} de {agora.year}"
    data = agora.strftime("%d/%m/%Y")
    d = _destaques(produtos)
    ids = {id(p): f"p{i + 1}" for i, p in enumerate(produtos)}
    fem = pauta.get("genero") == "f"
    o, um, os_, analisados = (("a", "uma", "As", "analisadas") if fem
                              else ("o", "um", "Os", "analisados"))
    titulo = (f"Melhor {pauta['nome']} até R$ {pauta['preco_max']} em {mes}: "
              f"{len(produtos)} opções comparadas")
    resumo = (f"Comparamos {len(produtos)} {pauta['plural']} até R$ {pauta['preco_max']} "
              f"por preço, avaliação de compradores, vendas e ficha do anúncio. "
              f"Preços consultados em {data}.")

    corpo = [
        f"Procurando {o} melhor {pauta['nome']} até R$ {pauta['preco_max']}? Reunimos as "
        f"opções mais bem avaliadas e mais vendidas nas lojas parceiras e comparamos o que "
        f"cada anúncio informa. Os preços foram consultados em {data} e mudam com frequência.",
        "",
        "## Resposta rápida",
        "",
        f"- **Melhor equilíbrio geral:** {_titulo_curto(d['melhor'])} "
        f"({_preco(d['melhor']['price'])}).",
        f"- **Mais bem avaliado:** {_titulo_curto(d['avaliado'])} "
        f"({_avaliacao_texto(d['avaliado'])}).",
        f"- **Mais vendido:** {_titulo_curto(d['vendido'])} "
        f"({_milhar(d['vendido'].get('sales'))} vendidos).",
        f"- **Menor preço:** {_titulo_curto(d['barato'])} ({_preco(d['barato']['price'])}).",
        "",
        "## Tabela comparativa",
        "",
        "{{editorial-comparison-table}}",
        "",
        f"## {os_} {len(produtos)} {pauta['plural']} {analisados}",
        "",
    ]
    for posicao, produto in enumerate(produtos, start=1):
        ficha = extrair_ficha(produto.get("productName"))
        selos = [rotulo for chave, rotulo in (("melhor", "melhor equilíbrio geral"),
                                               ("avaliado", "mais bem avaliado"),
                                               ("vendido", "mais vendido"),
                                               ("barato", "menor preço"))
                 if d[chave] is produto]
        corpo += [f"### {posicao}. {_titulo_curto(produto, 90)}", "",
                  f"{{{{product:{ids[id(produto)]}}}}}", ""]
        if selos:
            corpo.append(f"Destaque desta seleção: **{', '.join(selos)}**.")
            corpo.append("")
        corpo.append(f"- **Preço consultado:** {_preco(produto['price'])} em {data}.")
        corpo.append(f"- **Avaliação dos compradores:** {_avaliacao_texto(produto)}.")
        corpo.append(f"- **Vendas informadas pela loja:** {_milhar(produto.get('sales'))}.")
        for rotulo, valor in ficha.items():
            corpo.append(f"- **{rotulo}:** {valor} (segundo o anúncio).")
        if not ficha:
            corpo.append("- O anúncio não detalha a ficha técnica no título; confirme "
                         "medidas e especificações na página da loja.")
        corpo.append("")
    corpo += [f"## Como escolher {um} {pauta['nome']}", ""]
    corpo += [f"- **{criterio}.**" for criterio in pauta["criterios"]]
    corpo += ["- **Reputação da loja e garantia:** prefira lojas oficiais ou bem avaliadas "
              "e confira a política de troca.", "",
              "## Perguntas frequentes", "",
              f"### Qual {o} melhor {pauta['nome']} até R$ {pauta['preco_max']}?", "",
              f"Nesta atualização, o melhor equilíbrio entre avaliação, vendas e preço foi "
              f"{_titulo_curto(d['melhor'])}. A escolha certa depende do seu uso: compare "
              f"os critérios acima na tabela.", "",
              f"### Os preços deste guia são definitivos?", "",
              f"Não. Os valores foram consultados em {data} e podem mudar a qualquer momento. "
              "Confira o preço final, o frete e os cupons na página da loja.", "",
              "## Como montamos este guia", "",
              "Selecionamos produtos das lojas parceiras com avaliação de pelo menos 4,5 de 5 "
              "(ou equivalente), pelo menos 50 vendas, dentro da faixa de preço e sem indícios "
              "de réplica de marca. Não fazemos teste físico: as características vêm do anúncio "
              "e devem ser confirmadas na loja. Os links são de afiliado e podem gerar comissão "
              "para o Tá Barato, sem custo extra para você. Este guia é atualizado "
              "periodicamente com novos preços.", ""]

    produtos_site = []
    for produto in produtos:
        ficha = {"Avaliação": _avaliacao_texto(produto),
                 "Vendidos": _milhar(produto.get("sales"))}
        ficha.update(extrair_ficha(produto.get("productName")))
        if produto.get("shopName"):
            ficha["Loja"] = str(produto["shopName"])[:60]
        loja = produto.get("fonte") or "Loja"
        rotulo = "Ver no AliExpress" if loja == "AliExpress" else f"Ver na {loja}"
        produtos_site.append({
            "id": ids[id(produto)], "name": _titulo_curto(produto, 170),
            "summary": f"{_avaliacao_texto(produto)} · {_milhar(produto.get('sales'))} vendidos.",
            "image_url": produto["imageUrl"], "price_label": _preco(produto["price"]),
            "price_checked_at": int(agora.timestamp()), "specs": ficha,
            "links": [{"store": "outro", "label": rotulo,
                       "affiliate_url": links[id(produto)]}],
        })
    return {
        "topic": pauta["slug"], "slug": pauta["slug"], "title": titulo[:180],
        "excerpt": resumo[:320], "body_markdown": "\n".join(corpo),
        "cover_image_url": produtos[0]["imageUrl"],
        "category": "Guia de compra", "meta_title": titulo[:70],
        "meta_description": resumo[:170], "status": config.BLOG_GUIAS_STATUS,
        "products": produtos_site,
    }


def _gerar_link(produto) -> str:
    fonte = aliexpress if produto.get("fonte") == "AliExpress" else shopee
    tracking = (config.ALIEXPRESS_SITE_TRACKING_ID if fonte is aliexpress
                else config.SITE_TRACKING_ID)
    return fonte.gerar_link(produto["productUrl"], tracking, ["guia"])


# Suba quando a seleção mudar de forma relevante: guias publicados com uma
# versão anterior são refeitos antes de qualquer pauta nova.
VERSAO_SELECAO = 2


def _desatualizado(pauta) -> bool:
    publicado = store._estado(f"guia_atualizado:{pauta['slug']}")
    versao = store._estado(f"guia_versao:{pauta['slug']}")
    return bool(publicado) and str(versao) != str(VERSAO_SELECAO)


def proxima_pauta(agora=None):
    """Guias de versão antiga primeiro; depois inéditos; depois os mais antigos."""
    momento = int(agora or time.time())
    def idade(pauta):
        return int(store._estado(f"guia_atualizado:{pauta['slug']}") or 0)
    revisar = [p for p in PAUTAS if _desatualizado(p)]
    if revisar:
        return min(revisar, key=idade)
    candidatas = [p for p in PAUTAS if momento - idade(p) >= 5 * 86400]
    return min(candidatas, key=idade) if candidatas else None


def arquivar(pauta) -> None:
    """Tira do ar um guia que não pode mais ser montado com qualidade."""
    resposta = requests.post(
        site_publisher._api_path("/api/editorial-guides"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={"topic": pauta["slug"], "status": "archived"},
        timeout=30, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou arquivar o guia ({resposta.status_code})")


def publicar(guia) -> dict:
    resposta = requests.post(
        site_publisher._api_path("/api/editorial-guides"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json=guia, timeout=30, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou o guia ({resposta.status_code})")
    return resposta.json() or {}


def gerar_guia_do_dia(agora=None) -> bool:
    """No máximo um guia por dia; nunca interrompe a rodada de ofertas."""
    agora = agora or datetime.now(FUSO)
    chave_dia = f"guia_dia:{agora.date().isoformat()}:v{VERSAO_SELECAO}"
    if (not config.BLOG_GUIAS_AUTOMATICOS or not site_publisher.esta_configurado()
            or agora.hour < config.BLOG_GUIAS_HORA
            or store._estado(chave_dia) == "publicado"):
        return False
    tentadas = 0
    while tentadas < 3:
        pauta = proxima_pauta(agora.timestamp())
        if not pauta:
            return False
        tentadas += 1
        try:
            produtos = selecionar(buscar_candidatos(pauta), pauta)
            if len(produtos) < MIN_PRODUTOS:
                print(f"📝 Guia '{pauta['slug']}' adiado: só {len(produtos)} produto(s) aptos.")
                if _desatualizado(pauta):
                    # Melhor sem página do que com uma seleção que não é do tema.
                    try:
                        arquivar(pauta)
                        print(f"📝 Guia antigo '{pauta['slug']}' arquivado até haver produtos aptos.")
                    except Exception as erro:
                        print(f"   ⚠️  Não foi possível arquivar '{pauta['slug']}': "
                              f"{seguranca.redigir_segredos(erro)}")
                # Tentada com a seleção atual: não deve voltar como "desatualizada".
                store._definir_estado(f"guia_versao:{pauta['slug']}", VERSAO_SELECAO)
                # Volta ao fim da fila para não travar o rodízio.
                store._definir_estado(f"guia_atualizado:{pauta['slug']}", int(agora.timestamp()))
                continue
            links = {id(p): _gerar_link(p) for p in produtos}
            resultado = publicar(montar_guia(pauta, produtos, links, agora))
            store._definir_estado(f"guia_atualizado:{pauta['slug']}", int(agora.timestamp()))
            store._definir_estado(f"guia_versao:{pauta['slug']}", VERSAO_SELECAO)
            # A trava diária conta só guias publicados: tentativas sem produtos
            # aptos não impedem que a próxima rodada tente outra pauta.
            store._definir_estado(chave_dia, "publicado")
            endereco = f"{config.SITE_PUBLICO_URL}/blog/{resultado.get('slug') or pauta['slug']}"
            print(f"📝 Guia publicado: {endereco}")
            return True
        except Exception as erro:
            print(f"⚠️ Guia do blog adiado: {seguranca.redigir_segredos(erro)}")
            return False
    return False
