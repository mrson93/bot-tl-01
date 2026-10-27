"""Cliente da Creators API da Amazon (substituta da antiga PA-API).

Mesma ideia das outras lojas:
  1) buscar_ofertas()  -> lista as melhores ofertas
  2) gerar_link()      -> garante que o link tem a SUA tag de afiliado

Autenticacao em 2 passos: pega um token OAuth e usa ele nas chamadas.
"""
from html import unescape
from html.parser import HTMLParser
import json
import re
import time
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests

import captacao
import config
import seguranca
import store

NOME = "Amazon"
VALIDA_ANTES_PUBLICAR = True
TOKEN_URL = "https://api.amazon.com/auth/o2/token"
API_BASE = "https://creatorsapi.amazon/catalog/v1"
_HOSTS_LISTA = ("amzn.to", "amazon.com.br")
_HOSTS_PRODUTO = ("amazon.com.br",)
_HOSTS_IMAGEM = ("media-amazon.com", "ssl-images-amazon.com")
_MAX_HTML = 4_000_000
_STATUS_TRANSITORIOS = {429, 500, 502, 503, 504}
_ATRASOS_RETRY = (2, 5, 10)
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
              "link", "meta", "param", "source", "track", "wbr"}

_token = {"valor": None, "expira_em": 0}
# A vitrine devolve 503 com frequência para datacenters. A revalidação logo
# após a busca reaproveita a leitura desta rodada em vez de baixar de novo.
_VALIDADE_LISTA_SEGUNDOS = 15 * 60
_cache_lista = {"url": None, "em": 0.0, "ofertas": None}


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
            "product-badge-message": "badgeMessage",
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
    if len(tags) != 1 or tags[0] not in (
        config.AMAZON_ASSOCIATE_TAG, *config.AMAZON_LIST_SOURCE_TAGS
    ):
        raise ValueError("Produto da Amazon não contém uma tag de afiliado autorizada")
    # A vitrine pode usar outro ID da mesma conta. Publicamos sempre com o ID do bot.
    url = gerar_link(url)
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
    # Selo que a própria Amazon mostra na vitrine, ex.: "Menor preço em 365 dias".
    selo = re.search(r"Menor preço em (\d+) dias", card.get("badgeMessage") or "", re.I)
    if selo:
        oferta["menorPrecoLojaDias"] = int(selo.group(1))
    return oferta


_CABECALHOS_LISTA = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
}
# A página da lista só traz os primeiros produtos; o resto vem em páginas do
# "Carregar mais", cada uma com o token da próxima.
_MAX_PAGINAS_LISTA = 8
_PAUSA_PAGINAS = 1.5
_ESTADO_ROLAGEM = re.compile(
    r'data-a-state="\{&quot;key&quot;:&quot;listScrollState&quot;\}">(\{.*?\})</script>', re.S)
_TOKEN_PAGINA = re.compile(r'name="pageToken" value="([^"]+)"')
_MAIS_PAGINAS = re.compile(r'name="shouldListLoadMoreFlag" value="(\w+)"')


def _baixar_lista(url, sessao=None):
    if sessao is None:
        with requests.Session() as nova:
            nova.headers.update(_CABECALHOS_LISTA)
            return _baixar_lista(url, nova)
    atual = url
    # A vitrine usa cookies de sessão e devolve 503 de forma intermitente para
    # datacenters. Preservar a sessão entre redirecionamentos e espaçar as
    # tentativas evita transformar uma oscilação curta em falha da rodada.
    for _ in range(6):
        atual = seguranca.validar_url_https_em_hosts(
            atual, _HOSTS_LISTA, "Lista da Amazon"
        )
        for tentativa in range(len(_ATRASOS_RETRY) + 1):
            try:
                resposta = sessao.get(
                    atual, timeout=30, allow_redirects=False, stream=True,
                )
            except requests.RequestException:
                if tentativa == len(_ATRASOS_RETRY):
                    raise
                time.sleep(_ATRASOS_RETRY[tentativa])
                continue
            if (resposta.status_code not in _STATUS_TRANSITORIOS
                    or tentativa == len(_ATRASOS_RETRY)):
                break
            resposta.close()
            time.sleep(_ATRASOS_RETRY[tentativa])
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


_CHAVE_RESERVA = "amazon_lista_reserva"


def _lista_reserva():
    """Última leitura boa salva no estado, se ainda estiver dentro do limite."""
    try:
        salvo = json.loads(store._estado(_CHAVE_RESERVA) or "null")
    except (ValueError, TypeError):
        return None, 0
    if not salvo or salvo.get("url") != config.AMAZON_LIST_URL:
        return None, 0
    idade = (time.time() - float(salvo.get("em") or 0)) / 60
    if idade > config.AMAZON_LISTA_RESERVA_MINUTOS:
        return None, idade
    return salvo.get("ofertas") or None, idade


def _paginas_seguintes(html, sessao):
    """Baixa as páginas do "Carregar mais"; uma falha só encerra a paginação."""
    achado = _ESTADO_ROLAGEM.search(html)
    if not achado:
        return []
    try:
        estado = json.loads(achado.group(1))
    except ValueError:
        return []
    vitrine, lista = str(estado.get("vanityHandle") or ""), str(estado.get("listId") or "")
    if not re.fullmatch(r"[\w-]{1,64}", vitrine) or not re.fullmatch(r"[A-Z0-9]{6,20}", lista):
        return []
    token, continuar = estado.get("pageToken"), estado.get("shouldListLoadMoreFlag")
    paginas, produtos = [], html.count("single-product-item-link")
    for _ in range(_MAX_PAGINAS_LISTA):
        if not (token and continuar) or produtos >= config.AMAZON_FETCH_LIMIT:
            break
        time.sleep(_PAUSA_PAGINAS)
        url = (f"https://www.amazon.com.br/shop/{vitrine}/api/listItems?"
               + urlencode({"listId": lista, "pageToken": token}))
        try:
            pagina = _baixar_lista(url, sessao)
        except (requests.RequestException, RuntimeError) as erro:
            status = getattr(getattr(erro, "response", None), "status_code", None)
            print(f"   ⚠️  Lista da Amazon: parei na página {len(paginas) + 2} "
                  f"({status or type(erro).__name__}); seguindo com o que veio.")
            break
        paginas.append(pagina)
        produtos += pagina.count("single-product-item-link")
        proximo = _TOKEN_PAGINA.search(pagina)
        token = unescape(proximo.group(1)) if proximo else None
        mais = _MAIS_PAGINAS.search(pagina)
        continuar = bool(mais and mais.group(1).lower() == "true")
    return paginas


def _buscar_lista() -> list:
    parser = _ParserLista()
    with requests.Session() as sessao:
        sessao.headers.update(_CABECALHOS_LISTA)
        return _ler_lista(parser, sessao)


def _ler_lista(parser, sessao) -> list:
    try:
        html = _baixar_lista(config.AMAZON_LIST_URL, sessao)
    except requests.HTTPError as erro:
        status = getattr(erro.response, "status_code", None)
        reserva, idade = (_lista_reserva() if status in _STATUS_TRANSITORIOS
                          else (None, 0))
        if not reserva:
            raise
        # A vitrine recusa datacenters com 503 em boa parte das rodadas; a
        # leitura recente evita perder a Amazon na rodada inteira por isso.
        print(f"   ⚠️  Amazon recusou a lista ({status}); usando a leitura "
              f"de {int(idade)} min atrás.")
        _cache_lista.update(url=config.AMAZON_LIST_URL, em=time.monotonic(),
                            ofertas=[dict(oferta) for oferta in reserva])
        return [dict(oferta) for oferta in reserva]
    for pagina in [html, *_paginas_seguintes(html, sessao)]:
        parser.feed(pagina)
    ofertas = {}
    for card in parser.ofertas[:config.AMAZON_FETCH_LIMIT]:
        try:
            oferta = _normalizar_lista(card)
            ofertas.setdefault(oferta["oferta_id"], oferta)
        except (TypeError, ValueError):
            continue
    if not ofertas:
        raise RuntimeError("Nenhuma oferta válida encontrada na lista da Amazon")
    _cache_lista.update(url=config.AMAZON_LIST_URL, em=time.monotonic(),
                        ofertas=[dict(oferta) for oferta in ofertas.values()])
    try:
        store._definir_estado(_CHAVE_RESERVA, json.dumps({
            "url": config.AMAZON_LIST_URL, "em": time.time(),
            "ofertas": list(ofertas.values()),
        }, ensure_ascii=False))
    except Exception as erro:
        print(f"   ⚠️  Não salvei a reserva da lista da Amazon: {erro}")
    return list(ofertas.values())


def _lista_recente():
    """Leitura bem-sucedida desta execução, se ainda estiver dentro da validade."""
    if (_cache_lista["ofertas"] is None
            or _cache_lista["url"] != config.AMAZON_LIST_URL
            or time.monotonic() - _cache_lista["em"] > _VALIDADE_LISTA_SEGUNDOS):
        return None
    return [dict(oferta) for oferta in _cache_lista["ofertas"]]


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
    termo = captacao.termo_da_rodada(
        config.AMAZON_KEYWORD, config.AMAZON_KEYWORDS
    )
    if not termo:
        raise RuntimeError(
            "Amazon API exige AMAZON_KEYWORD ou AMAZON_KEYWORDS para buscar ofertas"
        )
    corpo_base["keywords"] = termo
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


_ASIN_TESTE = "B0F9Z2DV83"


def credenciais_api_configuradas() -> bool:
    return bool(config.AMAZON_CREDENTIAL_ID and config.AMAZON_CREDENTIAL_SECRET
                and config.AMAZON_ASSOCIATE_TAG)


def diagnosticar_api() -> tuple:
    """Consulta um único produto para saber se a conta já tem a PA API liberada.

    Devolve ("liberada", detalhe) ou ("recusada", motivo). Não publica nada e
    não muda o modo de busca (lista pública).
    """
    asins = [o["oferta_id"][7:] for o in (_lista_recente() or [])
             if re.fullmatch(r"amazon_[A-Z0-9]{10}", o.get("oferta_id", ""))]
    asin = asins[0] if asins else _ASIN_TESTE
    try:
        _token.update(valor=None, expira_em=0)
        _access_token()
    except Exception as erro:
        status = getattr(getattr(erro, "response", None), "status_code", "?")
        return "recusada", f"credencial não aceita ({status})"
    try:
        resposta = _chamar("getItems", {
            "partnerTag": config.AMAZON_ASSOCIATE_TAG,
            "marketplace": config.AMAZON_MARKETPLACE,
            "itemIds": [asin], "itemIdType": "ASIN",
            "resources": ["itemInfo.title", "offersV2.listings.price"],
        })
    except Exception as erro:
        texto = str(erro)
        status = re.search(r"\((\d{3})\)", texto)
        codigo = re.search(r'"(?:code|__type|reason)"\s*:\s*"([^"]{1,80})"', texto)
        motivo = codigo.group(1) if codigo else texto[:120]
        return "recusada", f"{status.group(1) if status else '?'} {motivo}".strip()
    itens = _cavar(resposta, "itemsResult", "items", padrao=[]) or []
    return "liberada", f"{len(itens)} produto(s) retornado(s)"


def buscar_ofertas() -> list:
    if config.AMAZON_LIST_URL:
        return _buscar_lista()
    return _buscar_api()


def consultar_produtos(ids) -> dict:
    procurados = {str(item) for item in ids if item}
    if not procurados:
        return {}
    if not config.AMAZON_LIST_URL:
        asins = [item[7:] for item in sorted(procurados)
                 if re.fullmatch(r"amazon_[A-Z0-9]{10}", item)]
        if not asins:
            return {}
        resultado = {}
        for inicio in range(0, len(asins), 10):
            resposta = _chamar("getItems", {
                "partnerTag": config.AMAZON_ASSOCIATE_TAG,
                "marketplace": config.AMAZON_MARKETPLACE,
                "itemIds": asins[inicio:inicio + 10],
                "itemIdType": "ASIN",
                "resources": ["itemInfo.title", "images.primary.large",
                              "offersV2.listings.price",
                              "offersV2.listings.availability"],
            })
            itens = _cavar(resposta, "itemsResult", "items", padrao=[]) or []
            for item in itens:
                disponibilidade = _cavar(item, "offersV2", "listings", "availability", "type")
                if (disponibilidade and str(disponibilidade).replace("_", "").upper()
                        not in {"INSTOCK", "INSTOCKSCARCE"}):
                    continue
                oferta = _normalizar(item)
                if (oferta["oferta_id"] in procurados and oferta["price"] > 0
                        and oferta.get("productUrl") and oferta.get("imageUrl")):
                    resultado[oferta["oferta_id"]] = oferta
        return resultado
    return {
        oferta["oferta_id"]: oferta
        for oferta in (_lista_recente() or buscar_ofertas())
        if oferta["oferta_id"] in procurados
    }


def revalidar_oferta(oferta: dict):
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
