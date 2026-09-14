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
    if not re.fullmatch(
        r"\d+(?:/(?:media|media_publish|subscribed_apps))?", recurso
    ):
        raise ValueError("Recurso da Graph API do Instagram inválido")
    return f"https://graph.facebook.com/{versao}/{recurso}"


def _corpo(resposta):
    try:
        return resposta.json() or {}
    except ValueError:
        return {}


def _erro(resposta, prefixo):
    corpo = _corpo(resposta)
    erro = corpo.get("error") or {}
    detalhe = erro.get("message") or resposta.text[:300]
    # O Graph API costuma devolver uma mensagem genérica para falhas ao
    # buscar a mídia. O subcódigo e a mensagem voltada ao usuário distinguem
    # URL inacessível (9004/2207052) de parâmetro ou permissão inválidos.
    subcodigo = erro.get("error_subcode") or erro.get("subcode")
    mensagem_usuario = erro.get("error_user_msg")
    if subcodigo:
        detalhe += f" [subcódigo {subcodigo}]"
    if mensagem_usuario and mensagem_usuario != detalhe:
        detalhe += f" — {mensagem_usuario}"
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


def _post(recurso, dados, repetir_rede=True, confirmar="id", prefixo=None):
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
            if 200 <= resposta.status_code < 300 and corpo.get(confirmar):
                return corpo
            ultimo = _erro(
                resposta, prefixo or "Instagram recusou a publicação"
            )
            if resposta.status_code != 429 and resposta.status_code < 500:
                raise ultimo
        if tentativa + 1 < tentativas:
            time.sleep(tentativa + 1)
    contexto = " sem confirmação" if not repetir_rede else ""
    raise RuntimeError(seguranca.redigir_segredos(
        f"Instagram indisponível{contexto}: {ultimo}"
    )) from None


def _assinar_webhook_mensagens() -> None:
    """Garante que a Página entregue mensagens do Instagram ao webhook do app."""
    pagina = str(config.FACEBOOK_PAGE_ID or "")
    if not pagina.isdigit():
        raise ValueError("ID da Página do Facebook inválido")
    _post(
        f"{pagina}/subscribed_apps",
        {"subscribed_fields": "messages,messaging_postbacks"},
        confirmar="success",
        prefixo="Meta recusou a inscrição do Direct automático",
    )


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
    if config.INSTAGRAM_DIRECT_ATIVO:
        try:
            _assinar_webhook_mensagens()
        except Exception as erro:
            # A inscrição é idempotente e será tentada novamente no próximo
            # Story. Uma indisponibilidade aqui não deve impedir a publicação.
            print("   ⚠️  Story será publicado, mas não foi possível ativar "
                  "o recebimento do Direct automático: "
                  f"{seguranca.redigir_segredos(erro)}")
    # O link curto já identifica o canal e abre exatamente esta oferta. Ele é
    # impresso no cartão porque a API do Instagram não aceita Link Sticker.
    imagem = story_card.gerar(oferta, link_afiliado)
    imagem_publica = site_publisher.publicar_imagem_story(imagem)
    # A Meta faz o download por conta própria, sem cookies. Faça a mesma
    # verificação e dê uma pequena janela para a leitura distribuída do D1
    # antes de criar o contêiner.
    site_publisher.verificar_imagem_publica_story(imagem_publica, len(imagem))
    time.sleep(3)
    container = _post(
        f"{conta}/media",
        {"media_type": "STORIES", "image_url": imagem_publica},
    )
    container_id = str(container.get("id") or "")
    _aguardar_container(container_id)
    # Uma falha de rede aqui pode ter ocorrido depois da publicação. Não
    # repetimos automaticamente para não arriscar um Story duplicado.
    publicado = _post(
        f"{conta}/media_publish", {"creation_id": container_id},
        repetir_rede=False,
    )
    if config.INSTAGRAM_DIRECT_ATIVO:
        try:
            site_publisher.registrar_story_instagram(
                publicado.get("id"), container_id, oferta, link_afiliado
            )
        except Exception as erro:
            # O Story já foi publicado. Falhar aqui não pode provocar uma
            # segunda publicação na próxima rodada.
            print("   ⚠️  Story publicado, mas o Direct automático não foi "
                  f"registrado: {seguranca.redigir_segredos(erro)}")
