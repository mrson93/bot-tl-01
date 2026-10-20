"""Publica no Facebook pelo Buffer usando a API GraphQL oficial."""
from io import BytesIO
import os
import re
import time
from typing import Optional

from PIL import Image
import requests

import seguranca
import site_publisher
import store


API_URL = "https://api.buffer.com"
_CHANNEL_ID = re.compile(r"^[0-9a-f]{24}$", re.IGNORECASE)
_MAX_IMAGEM_HOSPEDADA = 850_000
# O Buffer costuma ficar em "sending" por mais de 4 s. Esperar um pouco mais
# evita registrar como falha um post que já está saindo (e gastar outra rodada).
_ESPERAS_ENVIO = (2, 3, 5, 8)

_CREATE_POST = """
mutation CreateFacebookPost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id status } }
    ... on MutationError { message }
  }
}
""".strip()

_GET_POST = """
query BufferPost($input: PostInput!) {
  post(input: $input) { id status }
}
""".strip()

_EDIT_POST = """
mutation RetryBufferPost($input: EditPostInput!) {
  editPost(input: $input) {
    ... on PostActionSuccess { post { id status } }
    ... on MutationError { message }
  }
}
""".strip()


class FalhaHospedagemCard(RuntimeError):
    """O card não chegou a ser enviado ao Buffer e pode usar outra imagem."""


def _credenciais() -> tuple[str, str]:
    return (
        os.getenv("BUFFER_API_KEY", "").strip(),
        os.getenv("BUFFER_FACEBOOK_CHANNEL_ID", "").strip(),
    )


def esta_configurado() -> bool:
    chave, canal = _credenciais()
    return bool(len(chave) >= 20 and _CHANNEL_ID.fullmatch(canal))


def _compactar_para_hospedagem(conteudo: bytes) -> bytes:
    """Mantém o card abaixo do limite do endpoint público temporário."""
    if len(conteudo) <= _MAX_IMAGEM_HOSPEDADA:
        return conteudo
    with Image.open(BytesIO(conteudo)) as imagem:
        rgb = imagem.convert("RGB")
        for qualidade in (76, 68, 60):
            saida = BytesIO()
            rgb.save(saida, format="JPEG", quality=qualidade, optimize=True)
            compactada = saida.getvalue()
            if len(compactada) <= _MAX_IMAGEM_HOSPEDADA:
                return compactada
    raise RuntimeError("Não foi possível compactar o card para publicação")


def _url_imagem(card: Optional[bytes],
                imagem_original: Optional[str]) -> Optional[str]:
    if card:
        conteudo = _compactar_para_hospedagem(card)
        url = site_publisher.publicar_imagem_story(conteudo)
        site_publisher.verificar_imagem_publica_story(url, len(conteudo))
        return url
    if imagem_original:
        try:
            return seguranca.validar_url_https_publica(
                imagem_original, "Imagem da oferta"
            )
        except ValueError:
            return None
    return None


def publicar_no_canal(texto: str, card: Optional[bytes],
                      imagem_original: Optional[str], canal: str,
                      metadata: Optional[dict] = None,
                      api_key: Optional[str] = None) -> str:
    """Cria um post imediato em um canal conectado ao Buffer."""
    chave = (api_key or os.getenv("BUFFER_API_KEY", "")).strip()
    if len(chave) < 20 or not _CHANNEL_ID.fullmatch(canal):
        raise RuntimeError("Buffer não configurado para o canal")

    try:
        url_imagem = _url_imagem(card, imagem_original)
    except (OSError, RuntimeError, ValueError) as erro:
        if card:
            raise FalhaHospedagemCard(str(erro)) from None
        raise
    entrada = {
        "text": str(texto),
        "channelId": canal,
        "schedulingType": "automatic",
        "mode": "shareNow",
        "assets": ([{"image": {"url": url_imagem}}] if url_imagem else []),
    }
    if metadata:
        entrada["metadata"] = metadata
    try:
        resposta = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {chave}",
                "Content-Type": "application/json",
            },
            json={"query": _CREATE_POST, "variables": {"input": entrada}},
            timeout=30,
            allow_redirects=False,
        )
    except requests.RequestException:
        # Uma falha de transporte pode ocorrer depois de o Buffer aceitar o
        # post. Não repetimos automaticamente para não criar duplicatas.
        raise RuntimeError(
            "Buffer indisponível sem confirmação da publicação"
        ) from None

    try:
        corpo = resposta.json() or {}
    except ValueError:
        corpo = {}
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(f"Buffer recusou a publicação ({resposta.status_code})")
    if corpo.get("errors"):
        raise RuntimeError("Buffer recusou a publicação pela API")

    resultado = (corpo.get("data") or {}).get("createPost") or {}
    post_id = str((resultado.get("post") or {}).get("id") or "")
    if post_id:
        return post_id
    if resultado.get("message"):
        detalhe = seguranca.redigir_segredos(resultado["message"])[:300]
        raise RuntimeError(f"Buffer recusou os dados da publicação: {detalhe}")
    raise RuntimeError("Buffer respondeu sem confirmar a publicação")


def consultar_status(post_id: str, api_key: Optional[str] = None) -> str:
    """Consulta a entrega real; criar um post não significa que ele foi enviado."""
    chave = (api_key or os.getenv("BUFFER_API_KEY", "")).strip()
    try:
        resposta = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {chave}",
                     "Content-Type": "application/json"},
            json={"query": _GET_POST, "variables": {"input": {"id": post_id}}},
            timeout=20, allow_redirects=False,
        )
        corpo = resposta.json() or {}
    except (requests.RequestException, ValueError):
        raise RuntimeError("Não foi possível confirmar a entrega pelo Buffer") from None
    if not 200 <= resposta.status_code < 300 or corpo.get("errors"):
        raise RuntimeError("Buffer recusou a consulta do estado da publicação")
    status = str(((corpo.get("data") or {}).get("post") or {}).get("status") or "")
    if status not in {"draft", "error", "needs_approval", "scheduled", "sending", "sent"}:
        raise RuntimeError("Buffer não informou o estado da publicação")
    return status


def retentar_post_com_erro(post_id: str, api_key: Optional[str] = None) -> None:
    """Reenvia o mesmo registro em erro, sem criar um segundo post na fila."""
    chave = (api_key or os.getenv("BUFFER_API_KEY", "")).strip()
    try:
        resposta = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"},
            json={"query": _EDIT_POST,
                  "variables": {"input": {"id": post_id, "mode": "shareNow"}}},
            timeout=30, allow_redirects=False,
        )
        corpo = resposta.json() or {}
    except (requests.RequestException, ValueError):
        raise RuntimeError("Não foi possível reenviar o post em erro no Buffer") from None
    resultado = (corpo.get("data") or {}).get("editPost") or {}
    if (not 200 <= resposta.status_code < 300 or corpo.get("errors")
            or str((resultado.get("post") or {}).get("id") or "") != post_id):
        raise RuntimeError("Buffer recusou reenviar o post em erro")


def publicar_confirmado(oferta_id: str, canal_nome: str, criar,
                        api_key: Optional[str] = None) -> str:
    """Evita duplicar posts em fila e só confirma entrega quando status=sent."""
    info = store.buffer_post_info(oferta_id, canal_nome)
    post_id = info[0] if info else None
    if not post_id:
        post_id = str(criar())
        store.registrar_buffer_post(oferta_id, canal_nome, post_id)
        info = store.buffer_post_info(oferta_id, canal_nome)
    for tentativa in range(len(_ESPERAS_ENVIO) + 1):
        status = consultar_status(post_id, api_key)
        if status == "sent":
            return post_id
        if status == "error" and info:
            criado_em, ultimo_retry = info[1], info[2]
            agora = int(time.time())
            if agora - criado_em >= 86400 and (not ultimo_retry or agora - ultimo_retry >= 86400):
                store.marcar_retry_buffer(oferta_id, canal_nome, agora)
                retentar_post_com_erro(post_id, api_key)
                info = store.buffer_post_info(oferta_id, canal_nome)
                continue
        if status not in {"sending"} or tentativa == len(_ESPERAS_ENVIO):
            break
        time.sleep(_ESPERAS_ENVIO[tentativa])
    raise RuntimeError(f"Buffer recebeu o post {post_id}, mas estado atual: {status}")


def publicar(texto: str, card: Optional[bytes],
             imagem_original: Optional[str] = None) -> str:
    """Cria um post imediato no canal do Facebook conectado ao Buffer."""
    _, canal = _credenciais()
    return publicar_no_canal(
        texto, card, imagem_original, canal,
        {"facebook": {"type": "post"}},
    )
