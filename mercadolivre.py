"""Ofertas escolhidas na lista publica de recomendacoes do Mercado Livre."""
from html.parser import HTMLParser
import re
import time
from urllib.parse import parse_qs, parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests

import config
import mercadolivre_api
import observabilidade
import seguranca

NOME = "Mercado Livre"
VALIDA_ANTES_PUBLICAR = True
_HOSTS_PAGINA = ("meli.la", "mercadolivre.com.br")
_HOSTS_PRODUTO = ("mercadolivre.com.br",)
_HOSTS_IMAGEM = ("mlstatic.com",)
_MAX_HTML = 3_000_000
_MAX_PAGINAS = 20


# Leitura da rodada reaproveitada na revalidação: evita refazer a busca na
# API (que também avançaria o rodízio de categorias) a cada oferta.
_VALIDADE_LEITURA = 15 * 60
_ultima_leitura = {"em": 0.0, "ofertas": None}


def esta_configurada() -> bool:
    return bool(config.MERCADOLIVRE_LIST_URL) or mercadolivre_api.pode_publicar()


def _classes(attrs):
    return set(dict(attrs).get("class", "").split())


def _texto(valor):
    return " ".join(str(valor or "").replace("\xa0", " ").split())


def _preco_por_rotulo(rotulo):
    # A página alterna o rótulo acessível entre português ("151 reais com 50
    # centavos") e espanhol ("Ahora: 151 reales con 50 centavos").
    texto = _texto(rotulo).lower()
    reais = re.search(r"(\d[\d.]*)\s+(?:reais|reales|real)\b", texto)
    if not reais:
        return None
    inteiro = int(reais.group(1).replace(".", ""))
    centavos = re.search(r"(?:com|con)\s+(\d{1,2})\s+centavos?", texto)
    return inteiro + (int(centavos.group(1)) / 100 if centavos else 0)


def _id_produto(url):
    partes = urlsplit(url)
    parametros = parse_qs(partes.query)
    parametros.update(parse_qs(partes.fragment))
    wid = (parametros.get("wid") or [""])[0]
    if re.fullmatch(r"MLB\d+", wid, re.I):
        return wid.upper()
    catalogo = re.search(r"/p/(MLB\d+)", partes.path, re.I)
    if catalogo:
        return catalogo.group(1).upper()
    # Anúncio sem página de catálogo: produto.mercadolivre.com.br/MLB-123-titulo
    anuncio = re.search(r"/(MLB)-?(\d+)", partes.path, re.I)
    return f"MLB{anuncio.group(2)}" if anuncio else None


class _ParserLista(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ofertas = []
        self.card = None
        self.profundidade = 0
        self.campo = None

    def handle_starttag(self, tag, attrs):
        valores = dict(attrs)
        classes = _classes(attrs)
        if tag == "div" and "lists-card" in classes and self.card is None:
            self.card = {}
            prazo = (valores.get("data-deal-end-date")
                     or valores.get("data-promotion-end-date"))
            if prazo:
                self.card["expira_em"] = prazo
            self.profundidade = 1
            return
        if self.card is None:
            return
        prazo = (valores.get("data-deal-end-date")
                 or valores.get("data-promotion-end-date"))
        if prazo:
            self.card["expira_em"] = prazo
        if tag == "div":
            self.profundidade += 1
        if tag == "img" and "poly-component__picture" in classes:
            self.card["imageUrl"] = valores.get("src")
            self.card.setdefault("productName", valores.get("alt"))
        elif tag == "a" and "poly-component__title" in classes:
            self.card["productUrl"] = valores.get("href")
            self.card["productName"] = ""
            self.campo = "productName"
        elif "poly-component__seller" in classes:
            self.campo = "shopName"
        elif "poly-price__disc--pill" in classes:
            self.campo = "discountText"
        elif "poly-reviews__rating" in classes:
            self.campo = "ratingText"
        elif "poly-price__previous" in classes:
            self.card["precoOriginal"] = _preco_por_rotulo(valores.get("aria-label"))
        elif "poly-price__amount" in classes:
            self.card["price"] = _preco_por_rotulo(valores.get("aria-label"))

    def handle_endtag(self, tag):
        if self.card is None:
            return
        if tag in {"a", "span"}:
            self.campo = None
        if tag == "div":
            self.profundidade -= 1
            if self.profundidade == 0:
                self.ofertas.append(self.card)
                self.card = None
                self.campo = None

    def handle_data(self, data):
        if self.card is None or not self.campo:
            return
        self.card[self.campo] = _texto(
            f"{self.card.get(self.campo, '')} {data}"
        )


def _adicionar_marcadores_lista(url_produto, url_lista):
    """Mantém no produto os marcadores oficiais recebidos na vitrine social."""
    produto = urlsplit(url_produto)
    lista = urlsplit(url_lista or "")
    parametros = list(parse_qsl(produto.query, keep_blank_values=True))
    chaves = {chave for chave, _ in parametros}
    for chave, valor in parse_qsl(lista.query, keep_blank_values=True):
        # matt_tool identifica a ferramenta oficial que originou o link. Os
        # demais parâmetros da lista (por exemplo, forceInApp e page) não são
        # atributos do produto e não devem ser copiados.
        if chave == "matt_tool" and chave not in chaves and valor:
            parametros.append((chave, valor))
            chaves.add(chave)
    # O link da lista não traz o matt_word do afiliado; completa com os
    # parâmetros configurados para não perder a atribuição da venda.
    for chave, valor in mercadolivre_api.parametros_afiliado():
        if chave not in chaves:
            parametros.append((chave, valor))
            chaves.add(chave)
    return urlunsplit((produto.scheme, produto.netloc, produto.path,
                       urlencode(parametros), produto.fragment))


def _normalizar(card, url_lista=None):
    url = seguranca.validar_url_https_em_hosts(
        card.get("productUrl"), _HOSTS_PRODUTO, "Link de produto do Mercado Livre"
    )
    url = _adicionar_marcadores_lista(url, url_lista)
    imagem = seguranca.validar_url_https_em_hosts(
        card.get("imageUrl"), _HOSTS_IMAGEM, "Imagem do Mercado Livre"
    )
    produto_id = _id_produto(url)
    preco = float(card.get("price") or 0)
    original = float(card.get("precoOriginal") or 0)
    desconto_texto = re.search(r"(\d+(?:[.,]\d+)?)\s*%", card.get("discountText", ""))
    desconto = float(desconto_texto.group(1).replace(",", ".")) if desconto_texto else 0
    if not desconto and original > preco > 0:
        desconto = round((1 - preco / original) * 100)
    if not produto_id or not preco or not card.get("productName"):
        raise ValueError("Produto incompleto na lista do Mercado Livre")
    vendedor = re.sub(r"^Por\s+", "", _texto(card.get("shopName")), flags=re.I)
    oferta = {
        "fonte": NOME,
        "oferta_id": f"mercadolivre_{produto_id}",
        "productName": _texto(card["productName"]),
        "price": preco,
        "precoOriginal": original or None,
        "priceDiscountRate": desconto,
        "ratingStar": float(card.get("ratingText") or 0) or None,
        "sales": None,
        "shopName": vendedor or NOME,
        "imageUrl": imagem,
        "productUrl": url,
        # A inclusão na lista é a curadoria humana; não depende de métricas que
        # a página pública não fornece, como vendas e comissão estimada.
        "curadoriaManual": True,
        "comissao": None,
    }
    if card.get("expira_em"):
        oferta["expira_em"] = card["expira_em"]
    return oferta


def _baixar_html(url):
    atual = url
    for _ in range(6):
        atual = seguranca.validar_url_https_em_hosts(
            atual, _HOSTS_PAGINA, "Lista do Mercado Livre"
        )
        resposta = requests.get(
            atual, headers={"User-Agent": "CanalTaBarato/1.0"}, timeout=30,
            allow_redirects=False, stream=True,
        )
        try:
            if resposta.status_code in {301, 302, 303, 307, 308}:
                destino = resposta.headers.get("Location")
                if not destino:
                    raise RuntimeError("Mercado Livre redirecionou sem destino")
                atual = urljoin(atual, destino)
                continue
            resposta.raise_for_status()
            tamanho = int(resposta.headers.get("Content-Length") or 0)
            if tamanho > _MAX_HTML:
                raise RuntimeError("Lista do Mercado Livre excedeu o tamanho seguro")
            partes, total = [], 0
            for parte in resposta.iter_content(64 * 1024):
                total += len(parte)
                if total > _MAX_HTML:
                    raise RuntimeError("Lista do Mercado Livre excedeu o tamanho seguro")
                partes.append(parte)
            return b"".join(partes).decode(resposta.encoding or "utf-8", "replace"), atual
        finally:
            resposta.close()
    raise RuntimeError("Lista do Mercado Livre redirecionou vezes demais")


def buscar_ofertas() -> list:
    """Lista manual (curadoria) + mais vendidos da API oficial, quando liberada."""
    ofertas, erro_lista = {}, None
    if config.MERCADOLIVRE_LIST_URL:
        try:
            for oferta in _buscar_lista():
                ofertas[oferta["oferta_id"]] = oferta
        except Exception as erro:
            erro_lista = erro
    if mercadolivre_api.pode_publicar():
        try:
            mais_vendidos = mercadolivre_api.buscar_mais_vendidos()
            print(f"   Mercado Livre (API): {len(mais_vendidos)} mais vendido(s) nas categorias "
                  f"da rodada ({mercadolivre_api.resumo_diagnostico()}).")
            for oferta in mais_vendidos:
                ofertas.setdefault(oferta["oferta_id"], oferta)
        except mercadolivre_api.AcessoRevogado:
            print("   ⚠️  Mercado Livre (API): autorização expirou; rode scripts/autorizar_mercadolivre.py.")
            observabilidade.evento("fonte_falha", fonte="Mercado Livre API", motivo="autorizacao")
        except Exception as erro:
            print(f"   ⚠️  Mercado Livre (API) indisponível: {seguranca.redigir_segredos(erro)}")
            observabilidade.evento("fonte_falha", fonte="Mercado Livre API", motivo="erro")
    if not ofertas and erro_lista:
        raise erro_lista
    if not ofertas:
        raise RuntimeError("Nenhuma oferta válida encontrada na lista do Mercado Livre")
    _ultima_leitura.update(em=time.monotonic(), ofertas=[dict(o) for o in ofertas.values()])
    return list(ofertas.values())


def _leitura_recente():
    if (_ultima_leitura["ofertas"] is not None
            and time.monotonic() - _ultima_leitura["em"] <= _VALIDADE_LEITURA):
        # Cópias: a publicação limpa e regrava a oferta revalidada, e um objeto
        # compartilhado apagaria os dados da própria oferta.
        return [dict(oferta) for oferta in _ultima_leitura["ofertas"]]
    return None


def _buscar_lista() -> list:
    html, url_lista = _baixar_html(config.MERCADOLIVRE_LIST_URL)
    url_lista = seguranca.validar_url_https_em_hosts(
        url_lista, _HOSTS_PRODUTO, "Lista do Mercado Livre"
    )
    base = urlsplit(url_lista)
    parametros = [(chave, valor) for chave, valor in parse_qsl(base.query)
                  if chave != "page"]
    ofertas = {}
    pagina = 1
    while pagina <= _MAX_PAGINAS and len(ofertas) < config.MERCADOLIVRE_FETCH_LIMIT:
        parser = _ParserLista()
        parser.feed(html)
        novos = 0
        for card in parser.ofertas:
            try:
                oferta = _normalizar(card, url_lista)
            except (TypeError, ValueError):
                continue
            if oferta["oferta_id"] not in ofertas:
                ofertas[oferta["oferta_id"]] = oferta
                novos += 1
            if len(ofertas) >= config.MERCADOLIVRE_FETCH_LIMIT:
                break
        # A paginação pode ser criada pelo JavaScript do site e não existir no
        # HTML que o bot recebe. Avançamos até uma página sem produtos novos.
        if not novos or len(ofertas) >= config.MERCADOLIVRE_FETCH_LIMIT:
            break
        pagina += 1
        consulta = urlencode([*parametros, ("page", str(pagina))])
        url_pagina = urlunsplit((base.scheme, base.netloc, base.path,
                               consulta, ""))
        try:
            html, _ = _baixar_html(url_pagina)
        except requests.HTTPError as erro:
            if erro.response is not None and erro.response.status_code == 404:
                break
            raise
    if not ofertas:
        raise RuntimeError("Nenhuma oferta válida encontrada na lista do Mercado Livre")
    return list(ofertas.values())


def consultar_produtos(ids) -> dict:
    """Consulta novamente a lista e devolve somente os produtos ainda vigentes."""
    procurados = {str(item) for item in ids if item}
    if not procurados:
        return {}
    encontrados = {
        oferta["oferta_id"]: oferta
        for oferta in (_leitura_recente() or buscar_ofertas())
        if oferta["oferta_id"] in procurados
    }
    faltando = procurados - set(encontrados)
    if faltando and mercadolivre_api.pode_publicar():
        try:
            encontrados.update(mercadolivre_api.consultar(sorted(faltando)))
        except Exception as erro:
            print(f"   ⚠️  Revalidação pela API do Mercado Livre falhou: {seguranca.redigir_segredos(erro)}")
    return encontrados


def revalidar_oferta(oferta: dict):
    """Obtém preço e disponibilidade atuais imediatamente antes da publicação."""
    oferta_id = str(oferta.get("oferta_id") or "")
    return consultar_produtos([oferta_id]).get(oferta_id)


def gerar_link(url_produto: str, tracking_id: str = None, etiquetas=None) -> str:
    """Preserva o link rastreado criado pelo próprio Mercado Livre."""
    return seguranca.validar_url_https_em_hosts(
        url_produto, _HOSTS_PAGINA, "Link afiliado do Mercado Livre"
    )
