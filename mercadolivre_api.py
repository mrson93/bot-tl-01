"""Mais vendidos do Mercado Livre pela API oficial (sozinha ou junto da lista manual).

O acesso vem do aplicativo autorizado com scripts/autorizar_mercadolivre.py.
O Mercado Livre troca o refresh token a cada renovação, então o mais recente
fica no estado criptografado do bot; o access token (cerca de 6 h) também é
reaproveitado entre rodadas para renovar o mínimo possível.

Nada é publicado sem os parâmetros de afiliado confirmados
(MERCADOLIVRE_AFILIADO_PARAMETROS): sem eles não há como garantir comissão.
"""
import time
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

import config
import seguranca
import store

API = "https://api.mercadolibre.com"
_HOSTS_PRODUTO = ("mercadolivre.com.br",)
_HOSTS_IMAGEM = ("mlstatic.com",)
_CHAVE_REFRESH = "ml_refresh_token"
_CHAVE_ACESSO = "ml_access_token"
_CHAVE_EXPIRA = "ml_access_expira"
_CHAVE_RODIZIO = "ml_categoria_rodizio"
_CHAVE_PRAZO_BLOQUEADO = "ml_prazo_bloqueado_ate"


# Contagem por etapa da última busca, para o log (sem dados de produto).
diagnostico = {}


def _anotar(chave, quantidade=1):
    diagnostico[chave] = diagnostico.get(chave, 0) + quantidade


def _motivo(erro) -> str:
    status = getattr(getattr(erro, "response", None), "status_code", None)
    return f"http_{status}" if status else type(erro).__name__


class AcessoRevogado(RuntimeError):
    """O refresh token deixou de valer: é preciso rodar a autorização de novo."""


def esta_configurada() -> bool:
    return bool(config.MERCADOLIVRE_CLIENT_ID and config.MERCADOLIVRE_CLIENT_SECRET
                and (config.MERCADOLIVRE_REFRESH_TOKEN or store._estado(_CHAVE_REFRESH)))


def pode_publicar() -> bool:
    return esta_configurada() and bool(parametros_afiliado())


def parametros_afiliado() -> list:
    return [(chave, valor) for chave, valor in
            parse_qsl(config.MERCADOLIVRE_AFILIADO_PARAMETROS.lstrip("?"))
            if chave.startswith(("matt_", "tracking")) and valor]


def _access_token(agora=None) -> str:
    momento = int(agora or time.time())
    salvo = store._estado(_CHAVE_ACESSO)
    expira = int(store._estado(_CHAVE_EXPIRA) or 0)
    if salvo and momento < expira - 300:
        return salvo
    refresh = store._estado(_CHAVE_REFRESH) or config.MERCADOLIVRE_REFRESH_TOKEN
    resposta = requests.post(f"{API}/oauth/token", data={
        "grant_type": "refresh_token", "client_id": config.MERCADOLIVRE_CLIENT_ID,
        "client_secret": config.MERCADOLIVRE_CLIENT_SECRET, "refresh_token": refresh,
    }, headers={"Accept": "application/json"}, timeout=30)
    corpo = resposta.json() if resposta.content else {}
    if resposta.status_code in {400, 401} and corpo.get("error") == "invalid_grant":
        raise AcessoRevogado("Autorização do Mercado Livre expirou ou foi revogada")
    resposta.raise_for_status()
    # Grava o novo refresh token antes de qualquer outra chamada: o anterior
    # já não vale mais.
    store._definir_estado(_CHAVE_REFRESH, corpo["refresh_token"])
    store._definir_estado(_CHAVE_ACESSO, corpo["access_token"])
    store._definir_estado(_CHAVE_EXPIRA, momento + int(corpo.get("expires_in") or 21600))
    return corpo["access_token"]


def _get(caminho, params=None):
    resposta = requests.get(f"{API}{caminho}", params=params, timeout=30,
                            headers={"Authorization": f"Bearer {_access_token()}",
                                     "Accept": "application/json"})
    resposta.raise_for_status()
    return resposta.json()


def categorias_da_rodada() -> list:
    """Revezamento das categorias configuradas, poucas por rodada."""
    categorias = list(config.MERCADOLIVRE_CATEGORIAS)
    if not categorias:
        return []
    inicio = int(store._estado(_CHAVE_RODIZIO) or 0) % len(categorias)
    escolhidas = [categorias[(inicio + i) % len(categorias)]
                  for i in range(min(config.MERCADOLIVRE_CATEGORIAS_POR_RODADA, len(categorias)))]
    store._definir_estado(_CHAVE_RODIZIO, inicio + len(escolhidas))
    return escolhidas


def link_afiliado(url: str) -> str:
    url = seguranca.validar_url_https_em_hosts(url, _HOSTS_PRODUTO, "Produto do Mercado Livre")
    partes = urlsplit(url)
    parametros = [(c, v) for c, v in parse_qsl(partes.query) if not c.startswith("matt_")]
    parametros += parametros_afiliado()
    return urlunsplit((partes.scheme, partes.netloc, partes.path, urlencode(parametros), ""))


def _imagem(dados) -> str:
    fotos = dados.get("pictures") or []
    url = (fotos[0].get("secure_url") or fotos[0].get("url")) if fotos else dados.get("thumbnail")
    url = str(url or "").replace("http://", "https://")
    return seguranca.validar_url_https_em_hosts(url, _HOSTS_IMAGEM, "Imagem do Mercado Livre")


def _oferta(identificador, titulo, preco, original, url, imagem, posicao) -> dict:
    preco, original = float(preco or 0), float(original or 0)
    desconto = round((1 - preco / original) * 100) if original > preco > 0 else 0
    return {
        "fonte": "Mercado Livre", "oferta_id": f"mercadolivre_{identificador}",
        "productName": " ".join(str(titulo or "").split()), "price": preco,
        "precoOriginal": original or None, "priceDiscountRate": desconto,
        # Sem o vendedor real, "Mercado Livre" como loja faria todos os mais
        # vendidos dividirem o limite diário por loja; vazio fica fora dele.
        "ratingStar": None, "sales": None, "shopName": "",
        "imageUrl": imagem, "productUrl": link_afiliado(url), "comissao": None,
        "_ml_mais_vendido": posicao,
    }


def _fim_promocao(item_id, preco):
    """Quando termina o preço promocional atual do anúncio (epoch), se houver."""
    if not item_id:
        return None
    # O fim da promoção costuma ser visível só para o vendedor (403 para
    # afiliados). Depois de uma recusa, para de perguntar por 7 dias.
    if int(store._estado(_CHAVE_PRAZO_BLOQUEADO) or 0) > time.time():
        return None
    try:
        precos = (_get(f"/items/{item_id}/prices") or {}).get("prices") or []
    except (requests.RequestException, ValueError) as erro:
        _anotar(f"prazo_{_motivo(erro)}")
        if getattr(getattr(erro, "response", None), "status_code", None) in {401, 403}:
            store._definir_estado(_CHAVE_PRAZO_BLOQUEADO, int(time.time()) + 7 * 86400)
        return None
    for entrada in precos:
        fim = (entrada.get("conditions") or {}).get("end_time")
        if not fim or abs(float(entrada.get("amount") or 0) - float(preco or 0)) > 0.01:
            continue
        try:
            momento = datetime.fromisoformat(str(fim).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if momento > time.time():
            _anotar("com_prazo")
            return int(momento)
    return None


def _produto_catalogo(produto_id, posicao):
    dados = _get(f"/products/{produto_id}")
    vencedor = dados.get("buy_box_winner") or {}
    preco, original = vencedor.get("price"), vencedor.get("original_price")
    if not preco:
        # Sem vencedor da compra: o preço vem dos anúncios que vendem o produto.
        anuncios = (_get(f"/products/{produto_id}/items", {"limit": 5}) or {}).get("results") or []
        validos = [a for a in anuncios if a.get("price")]
        if not validos:
            _anotar("produto_sem_preco")
            return None
        melhor = min(validos, key=lambda a: float(a["price"]))
        preco, original = melhor["price"], melhor.get("original_price")
        vencedor = melhor
        _anotar("produto_preco_por_anuncio")
    url = dados.get("permalink") or f"https://www.mercadolivre.com.br/p/{produto_id}"
    oferta = _oferta(produto_id, dados.get("name"), preco, original, url, _imagem(dados), posicao)
    if original and float(original) > float(preco):
        fim = _fim_promocao(vencedor.get("item_id") or vencedor.get("id"), preco)
        if fim:
            oferta["expira_em"] = fim
    return oferta


def _itens(ids, posicoes):
    if not ids:
        return []
    resultado = []
    for bloco in _get("/items", {"ids": ",".join(ids[:20])}) or []:
        item = bloco.get("body") if isinstance(bloco, dict) and "body" in bloco else bloco
        if not isinstance(item, dict) or item.get("status") not in (None, "active"):
            _anotar("item_inativo")
            continue
        if item.get("condition") not in (None, "new"):
            _anotar("item_usado")
            continue
        oferta = _oferta(item["id"], item.get("title"), item.get("price"),
                         item.get("original_price"), item.get("permalink"),
                         _imagem(item), posicoes.get(item["id"]))
        if item.get("original_price") and float(item["original_price"]) > float(item.get("price") or 0):
            fim = _fim_promocao(item["id"], item.get("price"))
            if fim:
                oferta["expira_em"] = fim
        resultado.append(oferta)
    return resultado


def buscar_mais_vendidos() -> list:
    """Mais vendidos das categorias da rodada, só com preço e foto válidos."""
    diagnostico.clear()
    ofertas = []
    for categoria in categorias_da_rodada():
        try:
            destaques = _get(f"/highlights/MLB/category/{categoria}").get("content") or []
        except (requests.RequestException, ValueError) as erro:
            _anotar(f"destaques_{_motivo(erro)}")
            continue
        _anotar("destaques", len(destaques))
        itens, posicoes = [], {}
        for entrada in destaques:
            identificador, tipo = str(entrada.get("id") or ""), entrada.get("type")
            posicao = entrada.get("position")
            if tipo == "ITEM":
                itens.append(identificador)
                posicoes[identificador] = posicao
                continue
            if tipo != "PRODUCT":
                _anotar(f"tipo_{tipo}")
                continue
            try:
                oferta = _produto_catalogo(identificador, posicao)
                if oferta:
                    ofertas.append(oferta)
            except (requests.RequestException, ValueError, KeyError) as erro:
                _anotar(f"produto_{_motivo(erro)}")
        try:
            ofertas += _itens(itens, posicoes)
        except (requests.RequestException, ValueError, KeyError) as erro:
            _anotar(f"itens_{_motivo(erro)}")
    validas = [o for o in ofertas if o["productName"] and o["price"] > 0]
    _anotar("ofertas", len(validas))
    return validas


def resumo_diagnostico() -> str:
    return ", ".join(f"{chave}={valor}" for chave, valor in sorted(diagnostico.items())) or "vazio"


def consultar(ids) -> dict:
    """Preço atual pela API, pelo mesmo caminho da busca (catálogo ou anúncio)."""
    resultado = {}
    for oferta_id in ids:
        identificador = str(oferta_id).removeprefix("mercadolivre_")
        try:
            oferta = _produto_catalogo(identificador, None)
            if oferta:
                resultado[oferta_id] = oferta
                continue
        except (requests.RequestException, ValueError, KeyError):
            pass
        try:
            for oferta in _itens([identificador], {}):
                resultado[oferta_id] = oferta
        except (requests.RequestException, ValueError, KeyError):
            continue
    return resultado
