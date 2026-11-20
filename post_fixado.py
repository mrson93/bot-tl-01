"""Post institucional do bot de alertas, no estilo do post fixado de cada perfil.

Disparo manual único (campanha "post_fixado_alerta"). Cada rede é marcada como
enviada no estado do bot, então rodar de novo só tenta as que falharam.
Telegram e Bluesky também fixam o post; Facebook, X e Instagram não oferecem
fixação pela API usada aqui, então essas três ficam para fixar à mão.
"""
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

import bluesky
import buffer_facebook
import buffer_x
import config
import facebook
import instagram_stories
import seguranca
import store
import telegram_poster

CAMPANHA = "post_fixado_alerta"
DATA = "fixo"  # marcação única, não diária
ARTE = Path(__file__).parent / "site" / "public" / "img" / "post-bot-alertas.jpg"
ARTE_URL = "https://canaltabarato.com.br/img/post-bot-alertas.jpg"
BOT = "https://t.me/TaBaratoAlertaDePrecoBot"

TEXTO_TELEGRAM = (
    "🔥 <b>Economizar ficou mais fácil com o Canal Tá Barato!</b>\n\n"
    "🔔 <b>NOVO: avise-me quando baixar</b>\n"
    "Mande o link de um produto para o nosso bot e diga quanto quer pagar. Ele te "
    "chama no privado quando o preço chegar lá. Grátis.\n\n"
    "🌐 Site: canaltabarato.com.br\n"
    "📸 Instagram: instagram.com/ofertascanaltabarato\n"
    "𝕏 X: x.com/canaltabarato\n"
    "📘 Facebook: facebook.com/canaltabarato"
)
TEXTO_BLUESKY = (
    "🔥 Economizar ficou mais fácil com o Canal Tá Barato!\n\n"
    "🔔 NOVO: o bot avisa no Telegram quando o preço baixar: "
    "t.me/TaBaratoAlertaDePrecoBot?start=bsky\n\n"
    "🌐 canaltabarato.com.br\n"
    "📲 t.me/CanalTaBarato\n"
    "📸 instagram.com/ofertascanaltabarato\n\n"
    "👉 Siga e não perca a próxima oportunidade."
)
TEXTO_FACEBOOK = (
    "🔥 Economizar ficou mais fácil com o Canal Tá Barato!\n\n"
    "🔔 NOVO: avise-me quando baixar\n"
    "Mande o link de um produto do Mercado Livre para o nosso bot no Telegram e diga "
    "quanto quer pagar. Ele acompanha o preço e te chama no privado quando chegar lá. "
    "Sem preço, ele avisa quando for o menor preço real do histórico, sem desconto "
    "falso. É grátis.\n"
    f"👉 {BOT}?start=facebook\n\n"
    "🌐 Site: https://canaltabarato.com.br\n"
    "📲 Telegram: https://t.me/CanalTaBarato\n"
    "📸 Instagram: https://www.instagram.com/ofertascanaltabarato/\n"
    "𝕏 X: https://x.com/canaltabarato\n"
    "🦋 Bluesky: https://bsky.app/profile/canaltabarato.com.br\n\n"
    "👉 Siga o Canal Tá Barato e não perca a próxima oportunidade."
)
TEXTO_X = (
    "🔥 Economizar ficou mais fácil com o Canal Tá Barato!\n\n"
    "🔔 NOVO: nosso bot avisa no Telegram quando o preço do produto que você quer "
    "baixar. Grátis.\n"
    f"👉 {BOT}?start=x\n\n"
    "🌐 canaltabarato.com.br\n"
    "📲 t.me/CanalTaBarato"
)
TEXTO_INSTAGRAM = (
    "🔥 Economizar ficou mais fácil com o Canal Tá Barato!\n\n"
    "🔔 NOVO: avise-me quando baixar.\n"
    "Mande o link de um produto para o nosso bot no Telegram e diga quanto quer pagar. "
    "Ele te avisa no privado quando o preço chegar lá. Grátis.\n\n"
    "👉 Procure @TaBaratoAlertaDePrecoBot no Telegram ou use o link da bio.\n\n"
    "🌐 canaltabarato.com.br\n"
    "📲 t.me/CanalTaBarato\n\n"
    "#ofertas #promoção #descontos #economia #mercadolivre"
)

_LINK = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)+(?:com\.br|com|me|app)(?:/[^\s]*)?", re.I)


def facetas(texto):
    """Links clicáveis do Bluesky (posições em bytes UTF-8)."""
    resultado = []
    for achado in _LINK.finditer(texto):
        trecho = achado.group(0).rstrip(".,)")
        uri = trecho if trecho.startswith("http") else f"https://{trecho}"
        inicio = len(texto[:achado.start()].encode("utf-8"))
        resultado.append({
            "index": {"byteStart": inicio, "byteEnd": inicio + len(trecho.encode("utf-8"))},
            "features": [{"$type": "app.bsky.richtext.facet#link", "uri": uri}],
        })
    return resultado


def _telegram():
    api = telegram_poster.API
    with open(ARTE, "rb") as arquivo:
        corpo = requests.post(api.format(token=config.TELEGRAM_BOT_TOKEN, metodo="sendPhoto"), data={
            "chat_id": config.TELEGRAM_CHANNEL, "caption": TEXTO_TELEGRAM, "parse_mode": "HTML",
            "reply_markup": '{"inline_keyboard":[[{"text":"🔔 Criar meu alerta","url":"'
                            + BOT + '?start=telegram"}]]}',
        }, files={"photo": ("post-bot-alertas.jpg", arquivo, "image/jpeg")}, timeout=60).json()
    if not corpo.get("ok"):
        raise RuntimeError(seguranca.redigir_segredos(f"Telegram recusou: {corpo}"))
    mensagem = corpo["result"]["message_id"]
    fixado = requests.post(api.format(token=config.TELEGRAM_BOT_TOKEN, metodo="pinChatMessage"), json={
        "chat_id": config.TELEGRAM_CHANNEL, "message_id": mensagem, "disable_notification": True,
    }, timeout=30).json()
    return "publicado e fixado" if fixado.get("ok") else "publicado (sem permissão para fixar)"


def _bluesky():
    sess, pds = bluesky._sessao(), bluesky._pds()
    cabecalho = {"Authorization": f"Bearer {sess['accessJwt']}"}
    blob = requests.post(f"{pds}/xrpc/com.atproto.repo.uploadBlob", data=ARTE.read_bytes(),
                         headers={**cabecalho, "Content-Type": "image/jpeg"}, timeout=60)
    blob.raise_for_status()
    registro = {
        "$type": "app.bsky.feed.post", "text": TEXTO_BLUESKY, "facets": facetas(TEXTO_BLUESKY),
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "embed": {"$type": "app.bsky.embed.images", "images": [{
            "image": blob.json()["blob"], "alt": "Tá Barato: ofertas de verdade todos os dias. "
            "Novo: bot de alerta de preço no Telegram, t.me/TaBaratoAlertaDePrecoBot.",
            "aspectRatio": {"width": 1254, "height": 1568}}]},
        "langs": ["pt"],
    }
    criado = requests.post(f"{pds}/xrpc/com.atproto.repo.createRecord", headers=cabecalho, json={
        "repo": sess["did"], "collection": "app.bsky.feed.post", "record": registro}, timeout=30)
    criado.raise_for_status()
    post = criado.json()
    perfil = requests.get(f"{pds}/xrpc/com.atproto.repo.getRecord", headers=cabecalho, params={
        "repo": sess["did"], "collection": "app.bsky.actor.profile", "rkey": "self"}, timeout=30)
    perfil.raise_for_status()
    valor = dict(perfil.json()["value"])
    valor["pinnedPost"] = {"uri": post["uri"], "cid": post["cid"]}
    fixado = requests.post(f"{pds}/xrpc/com.atproto.repo.putRecord", headers=cabecalho, json={
        "repo": sess["did"], "collection": "app.bsky.actor.profile", "rkey": "self",
        "record": valor, "swapRecord": perfil.json().get("cid")}, timeout=30)
    return "publicado e fixado" if fixado.ok else "publicado (não consegui fixar)"


def _facebook():
    _, canal = buffer_facebook._credenciais()
    buffer_facebook.publicar_no_canal(TEXTO_FACEBOOK, None, ARTE_URL, canal,
                                      {"facebook": {"type": "post"}})
    return "enviado pelo Buffer (fixe à mão)"


def _x():
    buffer_facebook.publicar_no_canal(TEXTO_X, None, ARTE_URL, buffer_x._canal(),
                                      api_key=buffer_x._chave())
    return "enviado pelo Buffer (fixe à mão)"


def _instagram():
    conta = instagram_stories._conta_instagram()
    container = instagram_stories._post(f"{conta}/media", {"image_url": ARTE_URL, "caption": TEXTO_INSTAGRAM})
    container_id = str(container.get("id") or "")
    instagram_stories._aguardar_container(container_id)
    instagram_stories._post(f"{conta}/media_publish", {"creation_id": container_id}, repetir_rede=False)
    return "publicado no feed (fixe à mão)"


def _graph(caminho):
    versao = str(config.FACEBOOK_GRAPH_API_VERSION or "")
    return f"https://graph.facebook.com/{versao}/{caminho}"


def trocar_facebook():
    """Publica no Facebook pela Graph API com a arte e apaga o post só de texto."""
    if store.campanha_enviada(DATA, CAMPANHA, "Facebook com arte"):
        print("   · Facebook com arte: já feito.")
        return False
    cabecalho = {"Authorization": f"Bearer {config.FACEBOOK_PAGE_ACCESS_TOKEN}"}
    feed = requests.get(facebook._endpoint("posts"), headers=cabecalho, timeout=30,
                        params={"fields": "id,message,full_picture,created_time", "limit": 15})
    feed.raise_for_status()
    antigos = [post["id"] for post in feed.json().get("data") or []
               if str(post.get("message") or "").startswith("🔥 Economizar ficou mais fácil")
               and "TaBaratoAlertaDePrecoBot" in str(post.get("message") or "")
               and not post.get("full_picture")]
    novo = facebook._publicar("photos", {"message": TEXTO_FACEBOOK}, arquivo=ARTE.read_bytes())
    post_id = str(novo.get("post_id") or novo.get("id"))
    store.marcar_campanha_enviada(DATA, CAMPANHA, "Facebook com arte")
    print("   ✅ Facebook: publicado com a arte.")
    fixado = requests.post(_graph(post_id), headers=cabecalho, data={"is_pinned": "true"}, timeout=30)
    print("   ✅ Facebook: fixado." if fixado.ok else
          f"   ⚠️ Facebook: não consegui fixar ({fixado.status_code}); fixe à mão.")
    for antigo in antigos:
        apagado = requests.delete(_graph(antigo), headers=cabecalho, timeout=30)
        print("   🗑 Facebook: post antigo sem arte apagado." if apagado.ok else
              f"   ⚠️ Facebook: não consegui apagar o post antigo ({apagado.status_code}).")
    if not antigos:
        print("   ⚠️ Facebook: não achei o post antigo sem arte para apagar.")
    return True


REDES = (
    ("Telegram", telegram_poster.esta_configurada, _telegram),
    ("Bluesky", bluesky.esta_configurada, _bluesky),
    ("Facebook", buffer_facebook.esta_configurado, _facebook),
    ("X", buffer_x.esta_configurada, _x),
    ("Instagram", instagram_stories.esta_configurada, _instagram),
)


def executar():
    if not ARTE.exists():
        print("❌ Arte do post fixado não encontrada.")
        return False
    publicadas = 0
    for nome, configurada, publicar in REDES:
        if store.campanha_enviada(DATA, CAMPANHA, nome):
            print(f"   · {nome}: já publicado antes.")
            continue
        if not configurada():
            print(f"   ⚠️ {nome}: não configurado.")
            continue
        try:
            resultado = publicar()
        except Exception as erro:
            print(f"   ❌ {nome}: {seguranca.redigir_segredos(erro)[:200]}")
            continue
        store.marcar_campanha_enviada(DATA, CAMPANHA, nome)
        publicadas += 1
        print(f"   ✅ {nome}: {resultado}.")
    return publicadas > 0
