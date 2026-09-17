"""Cliente opcional do redirecionador próprio, com fallback para o afiliado."""
from urllib.parse import urlparse

import requests

import config
import seguranca


def esta_configurado():
    return bool(config.SHORTLINK_API_URL and config.SHORTLINK_BASE_URL
                and config.SHORTLINK_API_TOKEN)


def _mesma_origem(url, base):
    a, b = urlparse(url), urlparse(base)
    return a.scheme == b.scheme == "https" and a.netloc.lower() == b.netloc.lower()


def eh_proprio(url):
    """Confirma se o endereço usa o domínio curto configurado."""
    if not config.SHORTLINK_BASE_URL:
        return False
    try:
        return _mesma_origem(
            seguranca.validar_url_https_publica(url, "Link curto"),
            seguranca.validar_url_https_publica(
                config.SHORTLINK_BASE_URL, "Base de links"
            ),
        )
    except ValueError:
        return False


def criar(destino, oferta_id, canal, fonte):
    """Registra um destino afiliado; nunca devolve URL de outra origem."""
    destino = seguranca.validar_url_https_publica(destino, "Link de afiliado")
    api = seguranca.validar_url_https_publica(config.SHORTLINK_API_URL,
                                               "API de links")
    base = seguranca.validar_url_https_publica(config.SHORTLINK_BASE_URL,
                                                "Base de links")
    resposta = requests.post(
        api.rstrip("/") + "/api/links",
        headers={"Authorization": f"Bearer {config.SHORTLINK_API_TOKEN}"},
        json={"destination": destino, "offer_id": str(oferta_id),
              "channel": str(canal), "source": str(fonte)},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Redirecionador recusou o link ({resposta.status_code})")
    curto = seguranca.validar_url_https_publica(
        (resposta.json() or {}).get("short_url"), "Link curto"
    )
    if not _mesma_origem(curto, base):
        raise RuntimeError("Redirecionador devolveu link fora do dominio configurado")
    return curto


def resumo_cliques(inicio, fim):
    api = seguranca.validar_url_https_publica(config.SHORTLINK_API_URL,
                                               "API de links")
    resposta = requests.get(
        api.rstrip("/") + "/api/stats",
        headers={"Authorization": f"Bearer {config.SHORTLINK_API_TOKEN}"},
        params={"start": int(inicio.timestamp()), "end": int(fim.timestamp())},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Redirecionador recusou o relatorio ({resposta.status_code})")
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
