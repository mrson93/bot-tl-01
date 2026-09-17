"""Publica na vitrine própria sem interferir nos canais sociais."""
import base64
import time
from urllib.parse import urlsplit, urlunsplit

import requests

import config
import seguranca

NOME = "Site"

PAGINAS_INICIAIS = {
    "Shopee": "https://shopee.com.br/",
    "AliExpress": "https://pt.aliexpress.com/",
    "Amazon": "https://www.amazon.com.br/",
    "Mercado Livre": None,
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


def publicar_imagem_story(conteudo: bytes) -> str:
    """Hospeda temporariamente um JPEG para a Meta buscar durante a publicação."""
    if not esta_configurado():
        raise RuntimeError("Site não configurado para hospedar a imagem do Story")
    if not isinstance(conteudo, bytes) or not conteudo.startswith(b"\xff\xd8\xff"):
        raise ValueError("Imagem do Story deve ser um JPEG válido")
    if len(conteudo) > 850_000:
        raise ValueError("Imagem do Story excede 850 KB")
    resposta = requests.post(
        _api_path("/api/story-assets"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={"image_base64": base64.b64encode(conteudo).decode("ascii")},
        timeout=20, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(
            f"Site recusou a imagem do Story ({resposta.status_code})"
        )
    try:
        url = (resposta.json() or {}).get("url")
    except ValueError:
        url = None
    return seguranca.validar_url_https_publica(url, "Imagem pública do Story")


def verificar_imagem_publica_story(url: str, tamanho_esperado: int) -> None:
    """Confere o contrato público que a Meta usará para buscar o JPEG."""
    url = seguranca.validar_url_https_publica(url, "Imagem pública do Story")
    ultimo = None
    for tentativa in range(4):
        try:
            resposta = requests.get(
                url, stream=True, timeout=15, allow_redirects=False,
                headers={"User-Agent": "CanalTaBarato/1.0"},
            )
        except requests.RequestException:
            ultimo = RuntimeError("Não foi possível validar a imagem pública do Story")
        else:
            try:
                content_type = str(resposta.headers.get("Content-Type") or "").lower()
                content_length = int(resposta.headers.get("Content-Length") or 0)
                if not 200 <= resposta.status_code < 300:
                    raise RuntimeError(
                        f"Imagem pública do Story retornou HTTP {resposta.status_code}"
                    )
                if not content_type.startswith("image/jpeg"):
                    raise RuntimeError(
                        "Imagem pública do Story não retornou Content-Type image/jpeg"
                    )
                if content_length and content_length != int(tamanho_esperado):
                    raise RuntimeError("Imagem pública do Story retornou tamanho inesperado")
                primeiro = next(resposta.iter_content(3), b"")
                if not primeiro.startswith(b"\xff\xd8\xff"):
                    raise RuntimeError("Imagem pública do Story não retornou um JPEG válido")
                return
            except RuntimeError as erro:
                ultimo = erro
                # O upload D1 pode levar um instante para aparecer no ponto que
                # atenderá a Meta. Só repetimos falhas transitórias de leitura.
                if resposta.status_code not in {404, 408, 425, 429} and resposta.status_code < 500:
                    raise
            finally:
                resposta.close()
        if tentativa < 3:
            time.sleep(tentativa + 1)
    raise ultimo or RuntimeError("Não foi possível validar a imagem pública do Story")


def registrar_story_instagram(media_id, container_id, oferta: dict,
                              link_afiliado: str) -> None:
    """Associa o Story à oferta usada pela resposta automática no Direct."""
    media_id = str(media_id or "")
    if not media_id.isdigit():
        raise ValueError("Instagram não devolveu o ID do Story publicado")
    container_id = str(container_id or "")
    if not container_id.isdigit():
        raise ValueError("Instagram não devolveu o ID do contêiner do Story")
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link do Direct do Instagram"
    )
    resposta = requests.post(
        _api_path("/api/instagram-story-links"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={
            "media_id": media_id,
            "container_id": container_id,
            "offer_id": str(oferta.get("oferta_id") or "")[:100],
            "title": str(oferta.get("productName") or "Oferta")[:180],
            "price": oferta.get("price") or oferta.get("priceMin"),
            "link": link_afiliado,
        },
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(
            f"Site recusou o registro do Story ({resposta.status_code})"
        )


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


def publicar_shopee_vip(link_afiliado):
    """Mantém no site o atalho rastreável da assinatura Shopee VIP."""
    destino = seguranca.validar_url_https_em_hosts(
        link_afiliado, ("shopee.com.br",), "Link do Shopee VIP"
    )
    resposta = requests.post(
        _api_path("/api/stores"),
        headers={"Authorization": f"Bearer {config.SITE_API_TOKEN}"},
        json={"source": "Shopee VIP", "destination": destino},
        timeout=15, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Site recusou o Shopee VIP ({resposta.status_code})")


def link_publico_loja(slug):
    """Cria a URL pública rastreável usando a mesma origem da API do site."""
    partes = urlsplit(seguranca.validar_url_https_publica(
        config.SITE_API_URL, "API do site"
    ))
    slug = str(slug or "").strip().lower()
    if not slug or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in slug):
        raise ValueError("Atalho do site inválido")
    return urlunsplit((partes.scheme, partes.netloc, f"/loja/{slug}", "", ""))


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
        "visitas": int(dados.get("views") or 0),
        "ctr": float(dados.get("ctr") or 0),
        "por_canal": {str(k): int(v) for k, v in
                      (dados.get("by_channel") or {}).items()},
        "por_fonte": {str(k): int(v) for k, v in
                      (dados.get("by_source") or {}).items()},
        "por_oferta": {str(k): int(v) for k, v in
                       (dados.get("by_offer") or {}).items()},
        "por_origem": {str(k): int(v) for k, v in
                       (dados.get("by_traffic_source") or {}).items()},
    }
