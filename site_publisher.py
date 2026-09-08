"""Publica na vitrine própria sem interferir nos canais sociais."""
from urllib.parse import urlsplit, urlunsplit

import requests

import config
import seguranca

NOME = "Site"

PAGINAS_INICIAIS = {
    "Shopee": "https://shopee.com.br/",
    "AliExpress": "https://pt.aliexpress.com/",
    "Amazon": "https://www.amazon.com.br/",
}


def esta_configurado():
    return bool(config.SITE_ATIVO and config.SITE_API_URL and config.SITE_API_TOKEN)


def _api_path(path):
    partes = urlsplit(seguranca.validar_url_https_publica(
        config.SITE_API_URL, "API do site"
    ))
    return urlunsplit((partes.scheme, partes.netloc, path, "", ""))


def _timestamp(valor):
    if valor in (None, ""):
        return None
    try:
        numero = float(valor)
        return int(numero / 1000 if numero > 10_000_000_000 else numero)
    except (TypeError, ValueError):
        return None


def publicar(fonte, oferta):
    api = seguranca.validar_url_https_publica(config.SITE_API_URL, "API do site")
    destino = fonte.gerar_link(oferta.get("productUrl"), config.SITE_TRACKING_ID,
                               ["site", oferta.get("categoria") or "outros"])
    resposta = requests.post(
        api, headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={
            "id": str(oferta["oferta_id"]), "title": oferta.get("productName"),
            "price": oferta.get("price"),
            "original_price": oferta.get("precoOriginal"),
            "discount": oferta.get("priceDiscountRate"),
            "rating": oferta.get("ratingStar"), "sales": oferta.get("sales"),
            "shop": oferta.get("shopName"), "image_url": oferta.get("imageUrl"),
            "destination": destino, "source": fonte.NOME,
            "category": oferta.get("categoria") or "outros",
            "coupon_code": oferta.get("cupom"),
            "coupon_condition": oferta.get("cupomCondicao"),
            "coupon_expires_at": _timestamp(oferta.get("cupomExpiraEm")),
            "payment_label": "Preço no app" if oferta.get("precoNoApp") else None,
        }, timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou a oferta ({resposta.status_code})")


def publicar_cupom(cupom, link_afiliado):
    """Publica somente cupons oficiais, usando o mesmo segredo da vitrine."""
    destino = seguranca.validar_url_https_publica(link_afiliado, "Link do cupom")
    resposta = requests.post(
        _api_path("/api/coupons"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={
            "id": str(cupom["id"]), "source": cupom.get("fonte"),
            "code": cupom.get("codigo"), "title": cupom.get("titulo"),
            "kind": cupom.get("tipo"), "condition": cupom.get("condicao"),
            "destination": destino, "active_at": cupom.get("ativo_em"),
            "expires_at": cupom.get("expira_em"),
        }, timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou o cupom ({resposta.status_code})")


def publicar_loja(fonte):
    """Gera e publica o atalho afiliado para a página principal da loja."""
    pagina = PAGINAS_INICIAIS.get(fonte.NOME)
    if not pagina:
        raise RuntimeError(f"Loja sem página principal cadastrada: {fonte.NOME}")
    destino = fonte.gerar_link(pagina, config.SITE_TRACKING_ID,
                               ["site", "loja", fonte.NOME.lower()])
    resposta = requests.post(
        _api_path("/api/stores"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={"source": fonte.NOME, "destination": destino},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou o atalho da loja ({resposta.status_code})")


def _payload_atualizacao(oferta_id, oferta):
    """Mantém no envio apenas os dados públicos necessários à vitrine."""
    if not oferta:
        return {"id": str(oferta_id), "found": False}
    preco = oferta.get("price")
    imagem = str(oferta.get("imageUrl") or "")
    titulo = str(oferta.get("productName") or "").strip()
    try:
        valido = float(preco or 0) > 0 and imagem.startswith("https://") and bool(titulo)
    except (TypeError, ValueError):
        valido = False
    if not valido:
        return {"id": str(oferta_id), "found": False}
    return {
        "id": str(oferta_id), "found": True, "title": titulo,
        "price": preco, "original_price": oferta.get("precoOriginal"),
        "discount": oferta.get("priceDiscountRate"),
        "rating": oferta.get("ratingStar"), "sales": oferta.get("sales"),
        "shop": oferta.get("shopName"), "image_url": imagem,
        "category": oferta.get("categoria") or "outros",
        "payment_label": "Preço no app" if oferta.get("precoNoApp") else None,
    }


def atualizar_catalogo(fontes, limite=None):
    """Revalida itens antigos aos poucos, sem criar posts nas redes sociais."""
    limite = config.SITE_REFRESH_PER_RUN if limite is None else limite
    if not esta_configurado() or int(limite or 0) <= 0:
        return {"consultados": 0, "encontrados": 0}
    headers = {"Authorization": f"Bearer {config.SITE_API_TOKEN}"}
    resposta = requests.get(
        _api_path("/api/refresh-candidates"), headers=headers,
        params={"limit": max(1, min(20, int(limite)))},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(
            f"Site recusou a fila de atualização ({resposta.status_code})"
        )
    candidatos = (resposta.json() or {}).get("candidates") or []
    por_fonte = {}
    for candidato in candidatos:
        oferta_id = str(candidato.get("id") or "")
        fonte_nome = str(candidato.get("source") or "")
        if oferta_id and fonte_nome:
            por_fonte.setdefault(fonte_nome, []).append(oferta_id)

    fontes_por_nome = {fonte.NOME: fonte for fonte in fontes}
    atualizacoes = []
    for nome, ids in por_fonte.items():
        fonte = fontes_por_nome.get(nome)
        consultar = getattr(fonte, "consultar_produtos", None) if fonte else None
        if not callable(consultar):
            continue
        try:
            encontrados = consultar(ids)
        except Exception as erro:
            # Não registrar ausência quando foi a API da loja que falhou.
            print(f"   ⚠️  Atualização do catálogo em {nome} adiada: "
                  f"{seguranca.redigir_segredos(erro)}")
            continue
        atualizacoes.extend(
            _payload_atualizacao(oferta_id, encontrados.get(oferta_id))
            for oferta_id in ids
        )
    if not atualizacoes:
        return {"consultados": 0, "encontrados": 0}
    resposta = requests.post(
        _api_path("/api/refresh"), headers=headers,
        json={"updates": atualizacoes}, timeout=20, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou a atualização ({resposta.status_code})")
    return {
        "consultados": len(atualizacoes),
        "encontrados": sum(1 for item in atualizacoes if item["found"]),
    }


def resumo_cliques(inicio, fim):
    """Lê somente contagens agregadas, sem dados dos visitantes."""
    api = _api_path("/api/stats")
    resposta = requests.get(
        api, headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        params={"start": int(inicio.timestamp()), "end": int(fim.timestamp())},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou o relatório ({resposta.status_code})")
    dados = resposta.json() or {}
    return {
        "total": int(dados.get("total") or 0),
        "por_canal": {str(k): int(v) for k, v in
                      (dados.get("by_channel") or {}).items()},
        "por_fonte": {str(k): int(v) for k, v in
                      (dados.get("by_source") or {}).items()},
        "por_oferta": {str(k): int(v) for k, v in
                       (dados.get("by_offer") or {}).items()},
    }
