"""Cliente da Creators API da Amazon (substituta da antiga PA-API).

Mesma ideia das outras lojas:
  1) buscar_ofertas()  -> lista as melhores ofertas
  2) gerar_link()      -> garante que o link tem a SUA tag de afiliado

Autenticacao em 2 passos: pega um token OAuth e usa ele nas chamadas.
"""
import time

import requests

import config
import seguranca

NOME = "Amazon"
TOKEN_URL = "https://api.amazon.com/auth/o2/token"
API_BASE = "https://creatorsapi.amazon/catalog/v1"

_token = {"valor": None, "expira_em": 0}


def esta_configurada() -> bool:
    return bool(config.AMAZON_CREDENTIAL_ID
                and config.AMAZON_CREDENTIAL_SECRET
                and config.AMAZON_ASSOCIATE_TAG)


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


def buscar_ofertas() -> list:
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


def gerar_link(url_produto: str, tracking_id: str = None, etiquetas=None) -> str:
    """Garante que o link tem a SUA tag de afiliado.

    Na Amazon o link ja vem com a tag (detailPageURL), entao aqui so
    conferimos. O tracking_id por canal e ignorado de proposito: as tags da
    Amazon sao outras, criadas no painel de Associados.
    """
    if not url_produto:
        raise RuntimeError("Amazon nao devolveu link do produto")
    tag = config.AMAZON_ASSOCIATE_TAG
    if f"tag={tag}" in url_produto:
        return url_produto
    juncao = "&" if "?" in url_produto else "?"
    return f"{url_produto}{juncao}tag={tag}"
