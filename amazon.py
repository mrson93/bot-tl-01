"""Cliente da Creators API da Amazon (substituta da antiga PA-API).

Mesma ideia das outras lojas:
  1) buscar_ofertas()  -> lista as melhores ofertas
  2) gerar_link()      -> garante que o link tem a SUA tag de afiliado

Autenticacao em 2 passos: pega um token OAuth e usa ele nas chamadas.
"""
from html.parser import HTMLParser
import re
import time
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests

import config
import seguranca

NOME = "Amazon"
VALIDA_ANTES_PUBLICAR = True
TOKEN_URL = "https://api.amazon.com/auth/o2/token"
API_BASE = "https://creatorsapi.amazon/catalog/v1"
_HOSTS_LISTA = ("amzn.to", "amazon.com.br")
_HOSTS_PRODUTO = ("amazon.com.br",)
_HOSTS_IMAGEM = ("media-amazon.com", "ssl-images-amazon.com")
_MAX_HTML = 4_000_000
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
              "link", "meta", "param", "source", "track", "wbr"}

_token = {"valor": None, "expira_em": 0}


def esta_configurada() -> bool:
    return config.amazon_configurada()


def _texto(valor):
    return " ".join(str(valor or "").replace("\xa0", " ").split())


def _preco_brasileiro(valor):
    encontrado = re.search(r"R\$\s*([0-9.]+(?:,[0-9]{1,2})?)", _texto(valor))
    if not encontrado:
        return None
    return float(encontrado.group(1).replace(".", "").replace(",", "."))


class _ParserLista(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ofertas = []
        self.card = None
        self.depth = 0
        self.campo = None
        self.campo_depth = 0

    def handle_starttag(self, tag, attrs):
        valores = dict(attrs)
        classes = set(valores.get("class", "").split())
        if (self.card is None and tag == "a"
                and "single-product-item-link" in classes):
            self.card = {"productUrl": valores.get("href")}
            self.depth = 1
            return
        if self.card is None:
            return
        prazo = (valores.get("data-deal-end-date")
                 or valores.get("data-promotion-end-date"))
        if prazo:
            self.card["expira_em"] = prazo
        if tag not in _VOID_TAGS:
            self.depth += 1
        if valores.get("data-asin"):
            self.card["asin"] = valores["data-asin"]
        if tag == "img" and "product-image" in classes:
            self.card["imageUrl"] = valores.get("src")
        campos = {
            "product-brand-text": "brand",
            "product-title-text": "productName",
            "product-badge-label": "discountText",
            "a-offscreen": "priceText",
            "a-text-strike": "originalText",
        }
        for classe, campo in campos.items():
            if classe in classes:
                self.campo, self.campo_depth = campo, self.depth
                break

    def handle_endtag(self, tag):
        if self.card is None:
            return
        if self.campo and self.depth == self.campo_depth:
            self.campo = None
        self.depth -= 1
        if self.depth == 0:
            self.ofertas.append(self.card)
            self.card = None
            self.campo = None

    def handle_data(self, data):
        if self.card is not None and self.campo:
            self.card[self.campo] = _texto(
                f"{self.card.get(self.campo, '')} {data}"
            )


def _normalizar_lista(card):
    asin = str(card.get("asin") or "").upper()
    if not re.fullmatch(r"[A-Z0-9]{10}", asin):
        raise ValueError("ASIN inválido na lista da Amazon")
    url = urljoin("https://www.amazon.com.br", str(card.get("productUrl") or ""))
    url = seguranca.validar_url_https_em_hosts(
        url, _HOSTS_PRODUTO, "Link de produto da Amazon"
    )
    tags = [valor for chave, valor in parse_qsl(urlsplit(url).query)
            if chave == "tag"]
    if tags != [config.AMAZON_ASSOCIATE_TAG]:
        raise ValueError("Produto da Amazon não contém a tag de afiliado configurada")
    imagem = seguranca.validar_url_https_em_hosts(
        card.get("imageUrl"), _HOSTS_IMAGEM, "Imagem da Amazon"
    )
    preco = _preco_brasileiro(card.get("priceText"))
    original = _preco_brasileiro(card.get("originalText"))
    desconto_match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", card.get("discountText", ""))
    desconto = float(desconto_match.group(1).replace(",", ".")) if desconto_match else 0
    if not desconto and original and preco and original > preco:
        desconto = round((1 - preco / original) * 100)
    titulo = _texto(card.get("productName"))
    if not preco or not titulo:
        raise ValueError("Produto incompleto na lista da Amazon")
    oferta = {
        "fonte": NOME,
        "oferta_id": f"amazon_{asin}",
        "productName": titulo,
        "price": preco,
        "precoOriginal": original,
        "priceDiscountRate": desconto,
        "ratingStar": None,
        "sales": None,
        "shopName": _texto(card.get("brand")) or NOME,
        "imageUrl": imagem,
        "productUrl": url,
        "curadoriaManual": True,
        "comissao": None,
    }
    if card.get("expira_em"):
        oferta["expira_em"] = card["expira_em"]
    return oferta


def _baixar_lista(url):
    atual = url
    headers = {
        "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
    }
    for _ in range(6):
        atual = seguranca.validar_url_https_em_hosts(
            atual, _HOSTS_LISTA, "Lista da Amazon"
        )
        for tentativa in range(3):
            try:
                resposta = requests.get(
                    atual, headers=headers, timeout=30,
                    allow_redirects=False, stream=True,
                )
            except requests.RequestException:
                if tentativa == 2:
                    raise
                time.sleep(tentativa + 1)
                continue
            if resposta.status_code not in {429, 500, 502, 503, 504} or tentativa == 2:
                break
            resposta.close()
            time.sleep(tentativa + 1)
        try:
            if resposta.status_code in {301, 302, 303, 307, 308}:
                destino = resposta.headers.get("Location")
                if not destino:
                    raise RuntimeError("Amazon redirecionou sem destino")
                atual = urljoin(atual, destino)
                continue
            resposta.raise_for_status()
            tamanho = int(resposta.headers.get("Content-Length") or 0)
            if tamanho > _MAX_HTML:
                raise RuntimeError("Lista da Amazon excedeu o tamanho seguro")
            partes, total = [], 0
            for parte in resposta.iter_content(64 * 1024):
                total += len(parte)
                if total > _MAX_HTML:
                    raise RuntimeError("Lista da Amazon excedeu o tamanho seguro")
                partes.append(parte)
            return b"".join(partes).decode(resposta.encoding or "utf-8", "replace")
        finally:
            resposta.close()
    raise RuntimeError("Lista da Amazon redirecionou vezes demais")


def _buscar_lista() -> list:
    parser = _ParserLista()
    parser.feed(_baixar_lista(config.AMAZON_LIST_URL))
    ofertas = {}
    for card in parser.ofertas[:config.AMAZON_FETCH_LIMIT]:
        try:
            oferta = _normalizar_lista(card)
            ofertas.setdefault(oferta["oferta_id"], oferta)
        except (TypeError, ValueError):
            continue
    if not ofertas:
        raise RuntimeError("Nenhuma oferta válida encontrada na lista da Amazon")
    return list(ofertas.values())


def _access_token() -> str:
    """Pega (e reaproveita) o token OAuth. Ele vale cerca de 1 hora."""
    if _token["valor"] and time.time() < _token["expira_em"]:
        return _token["valor"]

    r = requests.post(TOKEN_URL, json={
        "grant_type": "client_credentials",
        "client_id": config.AMAZON_CREDENTIAL_ID,
        "client_secret": config.AMAZON_CREDENTIAL_SECRET,
        "scope": "creatorsapi::default",
    }, timeout=30)
    r.raise_for_status()
    dados = r.json()
    _token["valor"] = dados["access_token"]
    # renova um pouco antes de expirar, pra nao usar token vencido
    _token["expira_em"] = time.time() + int(dados.get("expires_in", 3600)) - 60
    return _token["valor"]


def _chamar(operacao: str, corpo: dict) -> dict:
    r = requests.post(
        f"{API_BASE}/{operacao}",
        headers={
            "Authorization": f"Bearer {_access_token()}",
            "Content-Type": "application/json",
            "x-marketplace": config.AMAZON_MARKETPLACE,
        },
        json=corpo,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Amazon recusou ({r.status_code}): {r.text[:300]}")
    return r.json()


def _cavar(dicionario, *caminho, padrao=None):
    """Anda dentro de dicionarios aninhados sem quebrar se faltar alguma chave."""
    atual = dicionario
    for chave in caminho:
        if isinstance(atual, list):
            atual = atual[0] if atual else None
        if not isinstance(atual, dict):
            return padrao
        atual = atual.get(chave)
    return padrao if atual is None else atual


def _normalizar(item: dict) -> dict:
    listagem = _cavar(item, "offersV2", "listings", padrao=[])
    if isinstance(listagem, list):
        listagem = listagem[0] if listagem else {}

    preco = _cavar(listagem, "price", "money", "amount")
    if preco is None:
        preco = _cavar(listagem, "price", "amount", padrao=0)
    # "savingBasis" e o preco cheio (de/por); usamos pra calcular o desconto
    cheio = _cavar(listagem, "price", "savingBasis", "money", "amount")
    desconto = _cavar(listagem, "price", "savings", "percentage")
    if desconto is None and cheio and preco:
        try:
            desconto = round((1 - float(preco) / float(cheio)) * 100)
        except (ZeroDivisionError, ValueError, TypeError):
            desconto = 0

    return {
        "fonte": NOME,
        "oferta_id": f"amazon_{item.get('asin')}",
        "productName": _cavar(item, "itemInfo", "title", "displayValue",
                              padrao="Oferta"),
        "price": float(preco or 0),
        "priceDiscountRate": float(desconto or 0),
        # a Amazon nao devolve nota nem numero de vendas nesses recursos:
        # o filtro de nota e feito no proprio pedido (minReviewsRating)
        "ratingStar": None,
        "sales": None,
        "shopName": "Amazon",
        "imageUrl": _cavar(item, "images", "primary", "large", "url"),
        "productUrl": item.get("detailPageURL"),
    }


def _buscar_api() -> list:
    """Busca ofertas com desconto na Amazon. O filtro de desconto minimo e
    aplicado pela propria Amazon (minSavingPercent), o que ja traz so promocao."""
    corpo_base = {
        "partnerTag": config.AMAZON_ASSOCIATE_TAG,
        "marketplace": config.AMAZON_MARKETPLACE,
        "itemCount": 10,                      # maximo permitido por pagina
        "minSavingPercent": int(config.MIN_DISCOUNT) or 1,
        "condition": "New",
        "availability": "Available",
        "sortBy": config.AMAZON_SORT,
        "currencyOfPreference": "BRL",
        "languagesOfPreference": ["pt_BR"],
        "resources": [
            "itemInfo.title",
            "images.primary.large",
            "offersV2.listings.price",
            "offersV2.listings.dealDetails",
        ],
    }
    if config.AMAZON_KEYWORD:
        corpo_base["keywords"] = config.AMAZON_KEYWORD
    if config.AMAZON_SEARCH_INDEX:
        corpo_base["searchIndex"] = config.AMAZON_SEARCH_INDEX
    if config.MIN_RATING:
        # a Amazon aceita inteiro menor que 5 (ex: 4 = 4 estrelas ou mais)
        corpo_base["minReviewsRating"] = int(config.MIN_RATING)

    ofertas, vistos = [], set()
    for pagina in range(1, config.AMAZON_PAGES + 1):
        corpo = dict(corpo_base, itemPage=pagina)
        try:
            resposta = _chamar("searchItems", corpo)
        except Exception as e:
            if pagina == 1:
                raise
            erro = seguranca.redigir_segredos(e)
            print(f"   ⚠️  Amazon parou na pagina {pagina}: {erro}")
            break

        itens = _cavar(resposta, "searchResult", "items", padrao=[]) or []
        if not itens:
            break
        for item in itens:
            if item.get("asin") in vistos:
                continue
            vistos.add(item.get("asin"))
            ofertas.append(_normalizar(item))
    return ofertas


def buscar_ofertas() -> list:
    if config.AMAZON_LIST_URL:
        return _buscar_lista()
    return _buscar_api()


def consultar_produtos(ids) -> dict:
    procurados = {str(item) for item in ids if item}
    if not procurados:
        return {}
    return {
        oferta["oferta_id"]: oferta
        for oferta in buscar_ofertas()
        if oferta["oferta_id"] in procurados
    }


def revalidar_oferta(oferta: dict):
    if not config.AMAZON_LIST_URL:
        return oferta
    oferta_id = str(oferta.get("oferta_id") or "")
    return consultar_produtos([oferta_id]).get(oferta_id)


def gerar_link(url_produto: str, tracking_id: str = None, etiquetas=None) -> str:
    """Garante que o link tem a SUA tag de afiliado.

    Na Amazon o link ja vem com a tag (detailPageURL), entao aqui so
    conferimos. O tracking_id por canal e ignorado de proposito: as tags da
    Amazon sao outras, criadas no painel de Associados.
    """
    if not url_produto:
        raise RuntimeError("Amazon nao devolveu link do produto")
    url = seguranca.validar_url_https_em_hosts(
        url_produto, _HOSTS_PRODUTO, "Link de produto da Amazon"
    )
    partes = urlsplit(url)
    parametros = [(chave, valor) for chave, valor in parse_qsl(partes.query)
                  if chave != "tag"]
    parametros.append(("tag", config.AMAZON_ASSOCIATE_TAG))
    return urlunsplit((partes.scheme, partes.netloc, partes.path,
                       urlencode(parametros), partes.fragment))
