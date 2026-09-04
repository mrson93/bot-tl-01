"""Publica na vitrine própria sem interferir nos canais sociais."""
from urllib.parse import urlsplit, urlunsplit

import requests

import config
import seguranca

NOME = "Site"


def esta_configurado():
    return bool(config.SITE_ATIVO and config.SITE_API_URL and config.SITE_API_TOKEN)


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
        }, timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou a oferta ({resposta.status_code})")


def resumo_cliques(inicio, fim):
    """Lê somente contagens agregadas, sem dados dos visitantes."""
    partes = urlsplit(seguranca.validar_url_https_publica(
        config.SITE_API_URL, "API do site"
    ))
    api = urlunsplit((partes.scheme, partes.netloc, "/api/stats", "", ""))
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
