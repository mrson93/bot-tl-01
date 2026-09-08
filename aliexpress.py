"""Cliente da API de Afiliados do AliExpress (plataforma aberta Alibaba).

Mesma ideia da Shopee:
  1) buscar_ofertas()  -> lista as melhores ofertas
  2) gerar_link()      -> transforma o link do produto no SEU link de afiliado

OBS: o formato exato da assinatura da Alibaba so da pra validar 100% com as
credenciais reais. O codigo segue o padrao documentado (HMAC-SHA256); se a
primeira chamada real falhar na assinatura, o ajuste e feito so na funcao _assinar.
"""
import hashlib
import hmac
import time

import requests

import config
import desempenho

NOME = "AliExpress"
ENDPOINT = "https://api-sg.aliexpress.com/sync"


def esta_configurada() -> bool:
    return config.aliexpress_configurada()


def _assinar(params: dict) -> str:
    """Assinatura da Alibaba: ordena os parametros, junta chave+valor e aplica
    HMAC-SHA256 com o App Secret. Resultado em hexadecimal MAIUSCULO."""
    base = "".join(f"{k}{params[k]}" for k in sorted(params))
    return hmac.new(
        config.ALIEXPRESS_APP_SECRET.encode("utf-8"),
        base.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest().upper()


def _chamar(metodo: str, negocio: dict) -> dict:
    """Monta os parametros de sistema + negocio, assina e chama a API."""
    params = {
        "app_key": config.ALIEXPRESS_APP_KEY,
        "method": metodo,
        "sign_method": "sha256",
        "timestamp": str(int(time.time() * 1000)),  # milissegundos
        "v": "2.0",
    }
    params.update({k: v for k, v in negocio.items() if v not in (None, "")})
    params["sign"] = _assinar(params)

    resp = requests.post(ENDPOINT, data=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _extrair_resultado(resposta: dict, chave_final: str):
    """Navega na resposta da Alibaba ate o 'result' (a estrutura vem aninhada)."""
    for chave, valor in resposta.items():
        if chave.endswith("_response") and isinstance(valor, dict):
            result = (valor.get("resp_result") or {}).get("result") or {}
            return result.get(chave_final) or {}
    # alguns gateways ja devolvem 'resp_result' na raiz
    result = (resposta.get("resp_result") or {}).get("result") or {}
    return result.get(chave_final) or {}


def _num(txt, padrao=0.0):
    """Converte '94.5%' ou '12.34' em numero. '%' vira o proprio numero."""
    try:
        return float(str(txt).replace("%", "").replace(",", ".").strip())
    except (TypeError, ValueError):
        return padrao


def _buscar_pagina(pagina: int) -> list:
    resposta = _chamar("aliexpress.affiliate.product.query", {
        "keywords": config.ALIEXPRESS_KEYWORD,
        "sort": config.ALIEXPRESS_SORT,
        "page_no": pagina,
        "page_size": config.ALIEXPRESS_FETCH_LIMIT,
        "target_currency": config.ALIEXPRESS_CURRENCY,
        "target_language": config.ALIEXPRESS_LANGUAGE,
        "ship_to_country": config.ALIEXPRESS_SHIP_TO,
        "tracking_id": config.ALIEXPRESS_TRACKING_ID,
    })
    produtos = _extrair_resultado(resposta, "products")
    lista = produtos.get("product") if isinstance(produtos, dict) else produtos
    return lista or []


def _normalizar_produto(p: dict) -> dict:
    """Converte respostas da busca e do detalhe no formato comum do bot."""
    # nota vem como "94.5%" (percentual de avaliacoes positivas) -> vira 0-5
    rating = round(_num(p.get("evaluate_rate")) / 20, 1)
    preco_normal = _num(p.get("target_sale_price") or p.get("sale_price"))
    preco_app = _num(p.get("target_app_sale_price") or p.get("app_sale_price"))
    somente_app = bool(preco_app and preco_normal and preco_app < preco_normal)
    promocao = p.get("promo_code_info") or {}
    if isinstance(promocao, list):
        promocao = promocao[0] if promocao else {}
    cupom = promocao.get("promo_code") if isinstance(promocao, dict) else None
    pagina_cupom = promocao.get("code_promotionurl") if isinstance(promocao, dict) else None
    destino = pagina_cupom or p.get("product_detail_url")
    return {
        "fonte": NOME,
        "oferta_id": f"aliexpress_{p.get('product_id')}",
        "productName": p.get("product_title", "Oferta"),
        "price": preco_app if somente_app else preco_normal,
        "precoNoApp": somente_app,
        "precoOriginal": _num(p.get("target_original_price")) or None,
        "priceDiscountRate": _num(p.get("discount")),
        "ratingStar": rating,
        "sales": int(_num(p.get("lastest_volume"))),
        "comissao": _num(p.get("commission_rate")) / 100,
        "shopName": p.get("shop_name") or "AliExpress",
        "categoria": (p.get("first_level_category_name")
                       or desempenho.categoria_produto(p.get("product_title"))),
        "cupom": cupom,
        "cupomCondicao": (promocao.get("code_value")
                           if isinstance(promocao, dict) else None),
        "cupomAtivoEm": (promocao.get("code_availabletime_start")
                          if isinstance(promocao, dict) else None),
        "cupomExpiraEm": (promocao.get("code_availabletime_end")
                           if isinstance(promocao, dict) else None),
        "cupomResgate": bool(cupom and pagina_cupom),
        "imageUrl": p.get("product_main_image_url"),
        "productUrl": destino,
    }


def buscar_ofertas() -> list:
    """Busca ofertas no AliExpress (varias paginas) na mesma forma que a Shopee usa."""
    lista, vistos = [], set()
    for pagina in range(1, config.ALIEXPRESS_PAGES + 1):
        for p in _buscar_pagina(pagina):
            pid = p.get("product_id")
            if pid not in vistos:
                vistos.add(pid)
                lista.append(p)
    return [_normalizar_produto(produto) for produto in lista]


def consultar_produtos(oferta_ids) -> dict:
    """Atualiza vários produtos numa única chamada oficial de detalhe."""
    ids = []
    for oferta_id in oferta_ids:
        texto = str(oferta_id)
        if texto.startswith("aliexpress_") and texto[11:].isdigit():
            ids.append(texto[11:])
    if not ids:
        return {}
    resposta = _chamar("aliexpress.affiliate.productdetail.get", {
        "product_ids": ",".join(ids),
        "target_currency": config.ALIEXPRESS_CURRENCY,
        "target_language": config.ALIEXPRESS_LANGUAGE,
        "ship_to_country": config.ALIEXPRESS_SHIP_TO,
        "tracking_id": config.ALIEXPRESS_TRACKING_ID,
    })
    produtos = _extrair_resultado(resposta, "products")
    lista = produtos.get("product") if isinstance(produtos, dict) else produtos
    if isinstance(lista, dict):
        lista = [lista]
    return {
        produto["oferta_id"]: produto
        for produto in (_normalizar_produto(item) for item in (lista or []))
        if produto.get("price") and produto.get("imageUrl")
    }


def _pedidos(status, inicio, fim):
    pagina = 1
    while True:
        resposta = _chamar("aliexpress.affiliate.order.list", {
            "start_time": inicio.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": fim.strftime("%Y-%m-%d %H:%M:%S"),
            "status": status,
            "page_no": pagina,
            "page_size": 50,
            "fields": ("tracking_id,effect_detail_status,estimated_paid_commission,"
                       "estimated_finished_commission,settled_currency,product_id,"
                       "product_title,product_count,category_id,created_time,paid_time,"
                       "finished_time"),
        })
        raiz = next((v for k, v in resposta.items()
                     if k.endswith("_response") and isinstance(v, dict)), {})
        resultado_resposta = raiz.get("resp_result") or {}
        codigo = resultado_resposta.get("resp_code")
        mensagem = str(resultado_resposta.get("resp_msg") or "")
        if str(codigo) == "405" and "empty" in mensagem.lower():
            return
        if str(codigo) != "200":
            raise RuntimeError(f"AliExpress recusou a consulta de pedidos (codigo {codigo or 'desconhecido'})")

        resultado = resultado_resposta.get("result") or {}
        pedidos = resultado.get("orders") or {}
        lista = pedidos.get("order") if isinstance(pedidos, dict) else pedidos
        if isinstance(lista, dict):
            lista = [lista]
        yield from lista or []

        total_paginas = int(resultado.get("total_page_no") or 1)
        if pagina >= total_paginas:
            return
        pagina += 1


def resumo_conversoes(inicio, fim) -> dict:
    """Devolve apenas totais de pedidos; nunca expõe IDs ou dados do comprador."""
    resumo = {
        "pagos": 0,
        "confirmados": 0,
        "invalidos": 0,
        "por_tracking": {},
        "comissoes": {},
        "comissoes_por_tracking": {},
        "por_hora": {},
        "por_categoria": {},
        "por_faixa_preco": {},
        "por_faixa_desconto": {},
        "produtos": [],
    }
    produtos = {}
    consultas = (
        ("Payment Completed", "pagos", "estimated_paid_commission"),
        ("Buyer Confirmed Receipt", "confirmados", "estimated_finished_commission"),
    )
    for status, contador, campo_comissao in consultas:
        for pedido in _pedidos(status, inicio, fim):
            detalhe = str(pedido.get("effect_detail_status") or "").lower()
            if detalhe in {"fullrefund", "antispam"}:
                resumo["invalidos"] += 1
                continue

            resumo[contador] += 1
            tracking = str(pedido.get("tracking_id") or "sem_tracking")
            resumo["por_tracking"][tracking] = resumo["por_tracking"].get(tracking, 0) + 1
            comissao = _num(pedido.get(campo_comissao))
            if comissao:
                moeda = str(pedido.get("settled_currency") or "moeda_nao_informada")
                resumo["comissoes"][moeda] = round(
                    resumo["comissoes"].get(moeda, 0) + comissao, 2)
                por_canal = resumo["comissoes_por_tracking"].setdefault(tracking, {})
                por_canal[moeda] = round(por_canal.get(moeda, 0) + comissao, 2)
            momento = (pedido.get("created_time") or pedido.get("paid_time")
                       or pedido.get("finished_time"))
            if momento:
                partes = str(momento).split()
                if len(partes) > 1 and ":" in partes[1]:
                    desempenho.somar(resumo["por_hora"], partes[1].split(":", 1)[0] + "h")

            nome = str(pedido.get("product_title") or "Produto AliExpress")
            categoria = desempenho.categoria_produto(nome)
            quantidade = max(1, int(_num(pedido.get("product_count"), 1)))
            desempenho.somar(resumo["por_categoria"], categoria, quantidade)
            oferta_id = f"aliexpress_{pedido.get('product_id')}"
            produto = produtos.setdefault(oferta_id, {
                "oferta_id": oferta_id,
                "nome": nome,
                "categoria": categoria,
                "quantidade": 0,
                "conversoes": 0,
                "comissoes": {},
            })
            produto["quantidade"] += quantidade
            produto["conversoes"] += 1
            if comissao:
                moeda = str(pedido.get("settled_currency") or "moeda_nao_informada")
                produto["comissoes"][moeda] = round(
                    produto["comissoes"].get(moeda, 0) + comissao, 2
                )
    resumo["produtos"] = sorted(
        produtos.values(), key=lambda p: p["quantidade"], reverse=True
    )
    return resumo


def _gerar(url_produto: str, tracking_id: str):
    resposta = _chamar("aliexpress.affiliate.link.generate", {
        "promotion_link_type": "0",
        "source_values": url_produto,
        "tracking_id": tracking_id,
    })
    links = _extrair_resultado(resposta, "promotion_links")
    lista = links.get("promotion_link") if isinstance(links, dict) else links
    if not lista:
        return None
    primeiro = lista[0] if isinstance(lista, list) else lista
    return primeiro.get("promotion_link")


def gerar_link(url_produto: str, tracking_id: str = None, etiquetas=None) -> str:
    """Gera o SEU link de afiliado (curto) a partir do link do produto.

    Se o tracking_id pedido nao existir na conta, cai no padrao em vez de
    deixar a oferta sem link. NUNCA devolve o link normal do produto: sem
    link de afiliado nao ha comissao, entao e melhor pular a oferta.
    """
    padrao = config.ALIEXPRESS_TRACKING_ID
    link = _gerar(url_produto, tracking_id or padrao)
    if not link and tracking_id and tracking_id != padrao:
        print(f"   ⚠️  tracking_id '{tracking_id}' nao funcionou; usando '{padrao}'")
        link = _gerar(url_produto, padrao)
    if not link:
        raise RuntimeError("AliExpress nao devolveu link de afiliado")
    return link
