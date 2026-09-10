"""Cliente da API de Afiliados da Shopee (GraphQL).

Faz duas coisas:
  1) buscar_ofertas()  -> lista as melhores ofertas
  2) gerar_link()      -> transforma o link do produto no SEU link de afiliado
"""
import hashlib
import json
import re
import time
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import requests

import config
import desempenho

NOME = "Shopee"
ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql"


def esta_configurada() -> bool:
    return config.shopee_configurada()


def _headers(payload: str) -> dict:
    """Monta o cabecalho de autenticacao exigido pela Shopee.

    Assinatura = SHA256(AppId + Timestamp + Payload + Secret)
    """
    timestamp = int(time.time())
    base = f"{config.SHOPEE_APP_ID}{timestamp}{payload}{config.SHOPEE_SECRET}"
    assinatura = hashlib.sha256(base.encode("utf-8")).hexdigest()
    auth = (
        f"SHA256 Credential={config.SHOPEE_APP_ID}, "
        f"Timestamp={timestamp}, Signature={assinatura}"
    )
    return {"Content-Type": "application/json", "Authorization": auth}


def _executar(query: str) -> dict:
    """Envia uma query GraphQL e devolve o campo 'data' da resposta."""
    payload = json.dumps({"query": query}, separators=(",", ":"), ensure_ascii=False)
    resp = requests.post(ENDPOINT, data=payload.encode("utf-8"),
                         headers=_headers(payload), timeout=30)
    resp.raise_for_status()
    corpo = resp.json()
    if corpo.get("errors"):
        raise RuntimeError(f"Shopee retornou erro: {corpo['errors']}")
    return corpo.get("data", {})


def _buscar_pagina(pagina: int, list_type: int) -> list:
    """Uma pagina de uma das listas da Shopee.

    list_type 0  = lista padrao (mais variedade, comissao maior)
    list_type 2  = campeoes de venda (muito mais popular, comissao menor)
    Nao usamos sortType: testado de 1 a 6, a Shopee devolve sempre o mesmo.
    """
    keyword = (f"keyword: {json.dumps(config.SHOPEE_KEYWORD, ensure_ascii=False)}"
               if config.SHOPEE_KEYWORD else "")
    lista = f"listType: {list_type}" if list_type else ""
    query = f"""
    {{
      productOfferV2(
        {lista}
        limit: {config.SHOPEE_FETCH_LIMIT}
        page: {pagina}
        {keyword}
      ) {{
        nodes {{
          itemId
          shopId
          productName
          priceMin
          priceMax
          price
          priceDiscountRate
          ratingStar
          sales
          commissionRate
          imageUrl
          shopName
          productLink
          offerLink
        }}
      }}
    }}
    """
    data = _executar(query)
    return (data.get("productOfferV2") or {}).get("nodes") or []


def _normalizar_produto(node: dict, campeao=False) -> dict:
    """Converte tanto o feed geral quanto a consulta exata no mesmo formato."""
    produto = dict(node)
    produto["_shopee_campeao"] = bool(campeao)
    produto["fonte"] = NOME
    produto["oferta_id"] = f"shopee_{produto.get('shopId')}_{produto.get('itemId')}"
    produto["productUrl"] = produto.get("productLink") or produto.get("offerLink")
    try:
        produto["comissao"] = float(produto.get("commissionRate") or 0)
    except (TypeError, ValueError):
        produto["comissao"] = 0.0
    produto["categoria"] = desempenho.categoria_produto(
        produto.get("productName") or ""
    )
    return produto


def buscar_ofertas() -> list:
    """Busca ofertas na Shopee em todas as listas configuradas e padroniza."""
    nodes, vistos = [], {}
    for list_type in config.SHOPEE_LIST_TYPES:
        for pagina in range(1, config.SHOPEE_PAGES + 1):
            for n in _buscar_pagina(pagina, list_type):
                chave = (n.get("shopId"), n.get("itemId"))
                if chave in vistos:
                    # O mesmo item pode aparecer primeiro na lista comum. Não
                    # perca a informação de que ele também é um campeão.
                    vistos[chave]["_shopee_campeao"] |= list_type == 2
                    continue
                produto = _normalizar_produto(n, list_type == 2)
                vistos[chave] = produto
                nodes.append(produto)
    return nodes


def consultar_produtos(oferta_ids) -> dict:
    """Consulta produtos específicos para atualizar a vitrine sem republicá-los."""
    resultado = {}
    for oferta_id in oferta_ids:
        match = re.fullmatch(r"shopee_(\d+)_(\d+)", str(oferta_id))
        if not match:
            continue
        shop_id, item_id = (int(valor) for valor in match.groups())
        query = f"""
        {{
          productOfferV2(shopId: {shop_id}, itemId: {item_id}, limit: 1, page: 1) {{
            nodes {{
              itemId shopId productName priceMin priceMax price priceDiscountRate
              ratingStar sales commissionRate imageUrl shopName productLink offerLink
            }}
          }}
        }}
        """
        nodes = ((_executar(query).get("productOfferV2") or {}).get("nodes") or [])
        esperado = str(oferta_id)
        for node in nodes:
            produto = _normalizar_produto(node)
            if produto["oferta_id"] == esperado:
                resultado[esperado] = produto
                break
    return resultado


_TERMOS_CAMPANHA = re.compile(
    r"\b(cupom|cupons|voucher|frete\s+gr[aá]tis|cashback|desconto)\b",
    re.IGNORECASE,
)


def buscar_cupons() -> list:
    """Busca campanhas oficiais da Shopee que funcionam como voucher.

    A API de afiliados não fornece necessariamente um código copiável. Nesses
    casos publicamos a campanha como voucher com link oficial para ativação.
    """
    if not config.SHOPEE_CAMPANHAS_CUPOM:
        return []
    query = """
    {
      shopeeOfferV2(limit: 50, page: 1, sortType: 1) {
        nodes {
          offerName
          offerType
          imageUrl
          offerLink
          originalLink
          periodStartTime
          periodEndTime
        }
      }
    }
    """
    nodes = ((_executar(query).get("shopeeOfferV2") or {}).get("nodes") or [])
    agora = int(time.time())
    resultado, vistos = [], set()
    for node in nodes:
        titulo = " ".join(str(node.get("offerName") or "").split())
        if not titulo or not _TERMOS_CAMPANHA.search(titulo):
            continue
        ativo_em = _timestamp_api(node.get("periodStartTime"))
        expira_em = _timestamp_api(node.get("periodEndTime"))
        if (ativo_em and ativo_em > agora) or (expira_em and expira_em <= agora):
            continue
        destino = str(node.get("originalLink") or node.get("offerLink") or "").strip()
        if not destino.startswith("https://"):
            continue
        bruto = "|".join((titulo, destino, str(expira_em or "")))
        identificador = "cupom_" + hashlib.sha256(
            bruto.encode("utf-8")
        ).hexdigest()[:24]
        if identificador in vistos:
            continue
        vistos.add(identificador)
        resultado.append({
            "id": identificador,
            "fonte": NOME,
            "codigo": "",
            "titulo": titulo,
            "tipo": "voucher",
            "condicao": "Ative na página oficial e confira as regras no aplicativo.",
            "destino": destino,
            "ativo_em": ativo_em,
            "expira_em": expira_em,
            "_fonte_obj": __import__(__name__),
        })
    return resultado


def _timestamp_api(valor):
    """Normaliza timestamps da Shopee expressos em segundos ou milissegundos."""
    try:
        numero = int(float(valor))
    except (TypeError, ValueError):
        return None
    return int(numero / 1000) if numero > 10_000_000_000 else numero


def _decimal(valor) -> Decimal:
    """Converte valores monetarios da API sem perder centavos."""
    try:
        return Decimal(str(valor or "0").replace(",", ".").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _origem_tracking(utm_content) -> str:
    """Reduz o UTM da Shopee ao canal, evitando dezenas de etiquetas no resumo."""
    texto = str(utm_content or "").lower()
    if "telegram" in texto:
        return "telegram"
    if "bsky" in texto or "bluesky" in texto:
        return "bsky"
    if "facebook" in texto:
        return "facebook"
    if not any(c.isalnum() for c in texto):
        return "sem_tracking"
    return "outros"


def _conversoes(inicio, fim):
    """Percorre o relatorio oficial sem solicitar IDs de pedidos ou compradores."""
    scroll_id = ""
    scrolls_vistos = set()
    while True:
        scroll = f", scrollId: {json.dumps(scroll_id)}" if scroll_id else ""
        query = f"""
        query {{
          conversionReport(
            purchaseTimeStart: {int(inicio.timestamp())}
            purchaseTimeEnd: {int(fim.timestamp())}
            limit: 100{scroll}
          ) {{
            nodes {{
              purchaseTime
              conversionStatus
              estimatedTotalCommission
              netCommission
              utmContent
              orders {{
                items {{
                  shopId
                  itemId
                  itemName
                  itemPrice
                  qty
                  itemCommission
                  itemTotalCommission
                  categoryLv1Name
                }}
              }}
            }}
            pageInfo {{
              hasNextPage
              scrollId
            }}
          }}
        }}
        """
        pagina = _executar(query).get("conversionReport") or {}
        yield from pagina.get("nodes") or []

        info = pagina.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            return
        proximo = str(info.get("scrollId") or "")
        if not proximo or proximo in scrolls_vistos:
            raise RuntimeError("Shopee devolveu paginacao invalida no relatorio")
        scrolls_vistos.add(proximo)
        scroll_id = proximo


def resumo_conversoes(inicio, fim) -> dict:
    """Agrega conversoes Shopee sem devolver ou persistir identificadores."""
    resumo = {
        "pendentes": 0,
        "concluidas": 0,
        "canceladas": 0,
        "outros": 0,
        "por_tracking": {},
        "comissao_por_tracking": {},
        "comissao_estimada": Decimal("0"),
        "comissao_liquida": Decimal("0"),
        "por_hora": {},
        "por_categoria": {},
        "por_faixa_preco": {},
        "por_faixa_desconto": {},
        "produtos": [],
    }
    produtos = {}
    contadores = {
        "PENDING": "pendentes",
        "COMPLETED": "concluidas",
        "CANCELLED": "canceladas",
    }
    for conversao in _conversoes(inicio, fim):
        status = str(conversao.get("conversionStatus") or "").upper()
        resumo[contadores.get(status, "outros")] += 1
        if status not in {"PENDING", "COMPLETED"}:
            continue

        tracking = _origem_tracking(conversao.get("utmContent"))
        resumo["por_tracking"][tracking] = (
            resumo["por_tracking"].get(tracking, 0) + 1
        )
        utm = str(conversao.get("utmContent") or "").lower()
        if "desc70mais" in utm:
            desempenho.somar(resumo["por_faixa_desconto"], "70% ou mais")
        elif "descate69" in utm:
            desempenho.somar(resumo["por_faixa_desconto"], "ate 69%")

        try:
            hora = datetime.fromtimestamp(
                int(conversao.get("purchaseTime") or 0),
                ZoneInfo("America/Sao_Paulo"),
            ).strftime("%Hh")
            desempenho.somar(resumo["por_hora"], hora)
        except (OSError, OverflowError, TypeError, ValueError):
            pass

        if status == "PENDING":
            valor_conversao = _decimal(conversao.get("estimatedTotalCommission"))
            resumo["comissao_estimada"] += valor_conversao
        else:
            valor_conversao = _decimal(conversao.get("netCommission"))
            resumo["comissao_liquida"] += valor_conversao
        resumo["comissao_por_tracking"][tracking] = (
            resumo["comissao_por_tracking"].get(tracking, Decimal("0"))
            + valor_conversao
        )

        vistos_na_conversao = set()
        for pedido in conversao.get("orders") or []:
            for item in pedido.get("items") or []:
                quantidade = max(1, int(item.get("qty") or 1))
                nome = str(item.get("itemName") or "Produto Shopee")
                categoria = (str(item.get("categoryLv1Name") or "").strip()
                             or desempenho.categoria_produto(nome))
                desempenho.somar(resumo["por_categoria"], categoria, quantidade)
                desempenho.somar(
                    resumo["por_faixa_preco"],
                    desempenho.faixa_preco(item.get("itemPrice")),
                    quantidade,
                )
                oferta_id = f"shopee_{item.get('shopId')}_{item.get('itemId')}"
                produto = produtos.setdefault(oferta_id, {
                    "oferta_id": oferta_id,
                    "nome": nome,
                    "categoria": categoria,
                    "quantidade": 0,
                    "conversoes": 0,
                    "comissao": Decimal("0"),
                })
                produto["quantidade"] += quantidade
                if oferta_id not in vistos_na_conversao:
                    produto["conversoes"] += 1
                    vistos_na_conversao.add(oferta_id)
                campo = "itemTotalCommission" if status == "PENDING" else "itemCommission"
                produto["comissao"] += _decimal(item.get(campo))

    resumo["comissao_estimada"] = round(resumo["comissao_estimada"], 2)
    resumo["comissao_liquida"] = round(resumo["comissao_liquida"], 2)
    resumo["comissao_por_tracking"] = {
        canal: round(valor, 2)
        for canal, valor in resumo["comissao_por_tracking"].items()
    }
    resumo["produtos"] = sorted(
        produtos.values(),
        key=lambda p: (p["quantidade"], p["comissao"]),
        reverse=True,
    )
    for produto in resumo["produtos"]:
        produto["comissao"] = round(produto["comissao"], 2)
    return resumo


def gerar_link(url_produto: str, subid: str = None, etiquetas=None) -> str:
    """Gera o SEU link de afiliado (curto) a partir do link do produto.

    As etiquetas viram subIds extras (a Shopee aceita ate 5), e aparecem no
    relatorio de conversao -- e assim que da para descobrir se quem compra
    prefere produto barato ou caro, desconto alto ou moderado.

    Nunca devolve o link normal do produto: sem link de afiliado nao ha
    comissao, entao e melhor pular a oferta.
    """
    # a Shopee recusa subId com hifen, underline ou acento ("invalid sub id"),
    # e um subId ruim derruba a postagem inteira -- por isso a limpeza aqui
    ids = [subid or config.SHOPEE_SUBID] + list(etiquetas or [])
    ids = [re.sub(r"[^A-Za-z0-9]", "", str(i)) for i in ids]
    ids = [i for i in ids if i][:5]
    lista = ", ".join(json.dumps(i) for i in ids)
    origem = json.dumps(str(url_produto), ensure_ascii=False)
    query = f"""
    mutation {{
      generateShortLink(input: {{
        originUrl: {origem}
        subIds: [{lista}]
      }}) {{
        shortLink
      }}
    }}
    """
    data = _executar(query)
    link = (data.get("generateShortLink") or {}).get("shortLink")
    if not link:
        raise RuntimeError("Shopee nao devolveu link de afiliado")
    return link
