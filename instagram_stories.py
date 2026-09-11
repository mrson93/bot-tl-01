"""Publica ofertas nos Stories de uma conta profissional do Instagram."""
import re
import time

import requests

import config
import seguranca
import site_publisher
import store
import story_card


NOME = "Instagram Stories"
TRACKING_ID = config.INSTAGRAM_TRACKING_ID
_VERSAO = re.compile(r"^v\d{1,3}\.\d{1,2}$")


def esta_configurada() -> bool:
    return bool(
        config.INSTAGRAM_STORIES_ATIVO
        and config.FACEBOOK_PAGE_ID
        and config.FACEBOOK_PAGE_ACCESS_TOKEN
        and site_publisher.esta_configurado()
    )


def pode_publicar() -> bool:
    limite = config.INSTAGRAM_MAX_STORIES_DIA
    return esta_configurada() and (
        limite == 0 or store.posts_canal_hoje(NOME) < limite
    )


def _endpoint(recurso: str) -> str:
    versao = str(config.FACEBOOK_GRAPH_API_VERSION or "")
    recurso = str(recurso or "").strip("/")
    if not _VERSAO.fullmatch(versao):
        raise ValueError("Versão da Graph API do Instagram inválida")
    if not re.fullmatch(r"\d+(?:/(?:media|media_publish))?", recurso):
        raise ValueError("Recurso da Graph API do Instagram inválido")
    return f"https://graph.facebook.com/{versao}/{recurso}"


def _corpo(resposta):
    try:
        return resposta.json() or {}
    except ValueError:
        return {}


def _erro(resposta, prefixo):
    corpo = _corpo(resposta)
    detalhe = corpo.get("error", {}).get("message") or resposta.text[:300]
    return RuntimeError(seguranca.redigir_segredos(
        f"{prefixo} ({resposta.status_code}): {detalhe}"
    ))


def _get(recurso, params):
    headers = {"Authorization": f"Bearer {config.FACEBOOK_PAGE_ACCESS_TOKEN}"}
    ultimo = None
    for tentativa in range(config.HTTP_MAX_TENTATIVAS):
        try:
            resposta = requests.get(
                _endpoint(recurso), headers=headers, params=params,
                timeout=30, allow_redirects=False,
            )
        except requests.RequestException as erro:
            ultimo = erro
        else:
            if 200 <= resposta.status_code < 300:
                return _corpo(resposta)
            ultimo = _erro(resposta, "Instagram recusou a consulta")
            if resposta.status_code != 429 and resposta.status_code < 500:
                raise ultimo
        if tentativa + 1 < config.HTTP_MAX_TENTATIVAS:
            time.sleep(tentativa + 1)
    raise RuntimeError(seguranca.redigir_segredos(
        f"Instagram indisponível durante a consulta: {ultimo}"
    )) from None


def _post(recurso, dados, repetir_rede=True):
    headers = {"Authorization": f"Bearer {config.FACEBOOK_PAGE_ACCESS_TOKEN}"}
    ultimo = None
    tentativas = config.HTTP_MAX_TENTATIVAS if repetir_rede else 1
    for tentativa in range(tentativas):
        try:
            resposta = requests.post(
                _endpoint(recurso), headers=headers, data=dados,
                timeout=30, allow_redirects=False,
            )
        except requests.RequestException as erro:
            ultimo = erro
        else:
            corpo = _corpo(resposta)
            if 200 <= resposta.status_code < 300 and corpo.get("id"):
                return corpo
            ultimo = _erro(resposta, "Instagram recusou a publicação")
            if resposta.status_code != 429 and resposta.status_code < 500:
                raise ultimo
        if tentativa + 1 < tentativas:
            time.sleep(tentativa + 1)
    contexto = " sem confirmação" if not repetir_rede else ""
    raise RuntimeError(seguranca.redigir_segredos(
        f"Instagram indisponível{contexto}: {ultimo}"
    )) from None


def _conta_instagram() -> str:
    pagina = str(config.FACEBOOK_PAGE_ID or "")
    if not pagina.isdigit():
        raise ValueError("ID da Página do Facebook inválido")
    corpo = _get(pagina, {"fields": "instagram_business_account"})
    conta = str((corpo.get("instagram_business_account") or {}).get("id") or "")
    if not conta.isdigit():
        raise RuntimeError("A Página não possui uma conta profissional do Instagram vinculada")
    perfil = _get(conta, {"fields": "id,username"})
    if str(perfil.get("username") or "").lower() != config.INSTAGRAM_USERNAME:
        raise RuntimeError(
            f"A conta do Instagram vinculada não é @{config.INSTAGRAM_USERNAME}"
        )
    return conta


def _aguardar_container(container_id: str) -> None:
    for tentativa in range(config.INSTAGRAM_CONTAINER_TENTATIVAS):
        corpo = _get(container_id, {"fields": "status_code,status"})
        status = str(corpo.get("status_code") or "").upper()
        if status == "FINISHED":
            return
        if status in {"ERROR", "EXPIRED"}:
            detalhe = str(corpo.get("status") or status)[:300]
            raise RuntimeError(f"Instagram não processou o cartão: {detalhe}")
        if tentativa + 1 < config.INSTAGRAM_CONTAINER_TENTATIVAS:
            time.sleep(2)
    raise RuntimeError("Instagram demorou demais para processar o cartão do Story")


def postar(oferta: dict, link_afiliado: str) -> None:
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado do Instagram"
    )
    conta = _conta_instagram()
    imagem = story_card.gerar(oferta, link_afiliado)
    imagem_publica = site_publisher.publicar_imagem_story(imagem)
    container = _post(
        f"{conta}/media",
        {"media_type": "STORIES", "image_url": imagem_publica},
    )
    container_id = str(container.get("id") or "")
    _aguardar_container(container_id)
    # Uma falha de rede aqui pode ter ocorrido depois da publicação. Não
    # repetimos automaticamente para não arriscar um Story duplicado.
    _post(
        f"{conta}/media_publish", {"creation_id": container_id},
        repetir_rede=False,
    )
