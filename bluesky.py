"""Publica uma oferta no Bluesky (AT Protocol).

Diferente do Telegram: limite de 300 caracteres, a imagem precisa ser enviada
(upload) e o link vira um "facet" pra ficar clicavel.
"""
from datetime import datetime, timezone

import requests

import config
import seguranca
import observabilidade

NOME = "Bluesky"
TRACKING_ID = config.BLUESKY_TRACKING_ID  # vazio = usa o padrao da loja
MAX_IMAGEM_BYTES = 1_000_000


def _imagem_omitida(motivo: str, codigo="indisponivel", oferta=None):
    """Registra o fallback sem expor URL, conteúdo remoto ou credenciais."""
    print(f"   ⚠️  Bluesky publicado sem imagem: {motivo}.")
    oferta = oferta or {}
    observabilidade.evento(
        "fallback", oferta_id=oferta.get("oferta_id"), canal=NOME,
        fonte=oferta.get("fonte"), motivo=f"bluesky_imagem_{codigo}",
    )
    return None


def esta_configurada() -> bool:
    return bool(config.BLUESKY_HANDLE and config.BLUESKY_APP_PASSWORD)


def _pds() -> str:
    return seguranca.validar_origem_https_publica(
        config.BLUESKY_PDS, "PDS do Bluesky"
    )


def _preco(valor) -> str:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return str(valor)
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _sessao() -> dict:
    pds = _pds()
    r = requests.post(
        f"{pds}/xrpc/com.atproto.server.createSession",
        json={"identifier": config.BLUESKY_HANDLE, "password": config.BLUESKY_APP_PASSWORD},
        timeout=30,
        allow_redirects=False,
    )
    if not 200 <= r.status_code < 300:
        raise RuntimeError(seguranca.redigir_segredos(
            f"Bluesky recusou a sessao ({r.status_code}): {r.text[:300]}"
        ))
    r.raise_for_status()
    return r.json()  # tem accessJwt e did


def _upload_imagem(jwt: str, url_imagem: str, oferta=None):
    """Baixa a imagem do produto e envia pro Bluesky. Retorna o 'blob' ou None."""
    if not url_imagem:
        return _imagem_omitida("imagem ausente na oferta", "ausente", oferta)
    try:
        url_imagem = seguranca.validar_url_https_em_hosts(
            url_imagem, config.IMAGEM_HOSTS_PERMITIDOS, "URL da imagem"
        )
        url_imagem = seguranca.validar_url_https_publica(
            url_imagem, "URL da imagem", resolver=True
        )
    except ValueError:
        return _imagem_omitida("URL da imagem rejeitada pela segurança", "seguranca", oferta)
    pds = _pds()
    try:
        img = requests.get(
            url_imagem, timeout=30, stream=True, allow_redirects=False
        )
    except requests.RequestException:
        return _imagem_omitida("falha ao baixar a imagem", "download", oferta)
    try:
        if not 200 <= img.status_code < 300:
            if 300 <= img.status_code < 400:
                return _imagem_omitida("redirecionamento não permitido")
            return _imagem_omitida(f"download recusado (HTTP {img.status_code})")
        img.raise_for_status()
        tipo = img.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if tipo and not tipo.lower().startswith("image/"):
            return _imagem_omitida("conteúdo recebido não é uma imagem")
        try:
            tamanho = int(img.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            tamanho = 0
        if tamanho > MAX_IMAGEM_BYTES:
            return _imagem_omitida("imagem original maior que 1 MB")

        dados = bytearray()
        for pedaco in img.iter_content(chunk_size=64 * 1024):
            if not pedaco:
                continue
            dados.extend(pedaco)
            if len(dados) > MAX_IMAGEM_BYTES:
                return _imagem_omitida("imagem baixada ultrapassou 1 MB")
    finally:
        img.close()

    try:
        r = requests.post(
            f"{pds}/xrpc/com.atproto.repo.uploadBlob",
            data=bytes(dados),
            headers={
                "Authorization": f"Bearer {jwt}",
                "Content-Type": img.headers.get("Content-Type", "image/jpeg"),
            },
            timeout=30,
            allow_redirects=False,
        )
    except requests.RequestException:
        return _imagem_omitida("falha ao enviar a imagem ao Bluesky")
    if not 200 <= r.status_code < 300:
        return _imagem_omitida(f"upload recusado pelo Bluesky (HTTP {r.status_code})")
    r.raise_for_status()
    blob = r.json().get("blob")
    if not blob:
        return _imagem_omitida("Bluesky não retornou o identificador da imagem")
    return blob


def montar_texto(oferta: dict, link_afiliado: str) -> tuple:
    """Monta o texto (<=300 chars) e devolve (texto, inicio_do_link_em_bytes)."""
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    preco = oferta.get("price") or oferta.get("priceMin")
    desconto = float(oferta.get("priceDiscountRate") or 0)

    import telegram_poster as fmt  # reaproveita a formatacao do texto

    # o "de" preferido e o que a loja informa, igual ao Telegram
    original = oferta.get("precoOriginal")
    linha_preco = ""
    sufixo_app = " no app" if oferta.get("precoNoApp") else ""
    if original and preco:
        try:
            if float(original) > float(preco):
                linha_preco = (f"💰 De R$ {_preco(original)} por "
                               f"R$ {_preco(preco)}{sufixo_app}")
            else:
                linha_preco = f"💰 R$ {_preco(preco)}{sufixo_app}" + (f" · {int(round(desconto))}% OFF" if desconto else "")
        except (ValueError, TypeError):
            linha_preco = f"💰 R$ {_preco(preco)}{sufixo_app}"
    elif preco:
        linha_preco = f"💰 R$ {_preco(preco)}{sufixo_app}" + (f" · {int(round(desconto))}% OFF" if desconto else "")

    humana = fmt.chamada_inicial(oferta)
    reputacao = []
    if oferta.get("ratingStar"):
        reputacao.append(f"⭐ {float(oferta['ratingStar']):.1f}")
    if oferta.get("sales"):
        reputacao.append(f"🛍️ {fmt._milhar(oferta['sales'])} vendidos")
    loja = str(oferta.get("shopName") or "").strip()
    if loja:
        reputacao.append(f"🏬 {loja}")
    cupom = str(oferta.get("cupom") or "").strip()
    condicao = str(oferta.get("cupomCondicao") or "").strip()[:80]
    rodape = (f"🏬 {fmt.nome_plataforma(oferta)}\n"
              f"🛒 Ver oferta {fmt.rotulo_publicidade()}: {link_afiliado}")
    motivo_repeticao = ""
    anterior = oferta.get("_preco_publicacao_anterior")
    if oferta.get("_motivo") == "queda_preco" and anterior and preco:
        try:
            queda = 100 * (float(anterior) - float(preco)) / float(anterior)
            if queda > 0:
                motivo_repeticao = f"📉 Reapareceu porque caiu {queda:.0f}% desde a última publicação"
        except (TypeError, ValueError, ZeroDivisionError):
            pass

    def montar(titulo, chamada=humana, itens_reputacao=reputacao,
               detalhe_cupom=condicao, instrucao=True, incluir_cupom=True):
        cabecalho = f"{chamada}\n\n{titulo}" if chamada else titulo
        cupom_linhas = []
        if cupom and incluir_cupom:
            cupom_linhas.append(f"🎟 Cupom: {cupom}")
            if detalhe_cupom:
                cupom_linhas.append(f"ℹ️ {detalhe_cupom}")
            if instrucao:
                cupom_linhas.append("📱 Ative no app antes de finalizar")
        # O link é obrigatório e aparece antes da reputação.
        blocos = [cabecalho, linha_preco, motivo_repeticao,
                  "\n".join(cupom_linhas), rodape,
                  " · ".join(itens_reputacao)]
        return "\n\n".join(bloco for bloco in blocos if bloco)

    titulo = fmt.limpar_titulo(
        oferta.get("productName", "Oferta"), config.TITULO_MAX_CARACTERES
    )
    texto = montar(titulo)
    if len(texto) > 300 and humana:
        humana = ""
        texto = montar(titulo, chamada="")
    if len(texto) > 300:
        excesso = len(texto) - 300
        titulo = fmt.limpar_titulo(titulo, max(50, len(titulo) - excesso - 1))
        texto = montar(titulo, chamada=humana)
    if len(texto) > 300 and loja:
        reputacao = [item for item in reputacao if not item.startswith("🏬")]
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao)
    if len(texto) > 300:
        excesso = len(texto) - 300
        titulo = fmt.limpar_titulo(titulo, max(15, len(titulo) - excesso - 1))
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao)
    if len(texto) > 300 and reputacao:
        reputacao = []
        texto = montar(titulo, chamada=humana, itens_reputacao=[])
    if len(texto) > 300 and cupom:
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao,
                       instrucao=False)
    if len(texto) > 300 and condicao:
        limite = max(0, len(condicao) - (len(texto) - 300) - 1)
        condicao = fmt.limpar_titulo(condicao, limite) if limite else ""
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao,
                       detalhe_cupom=condicao, instrucao=False)
    if len(texto) > 300:
        excesso = len(texto) - 300
        titulo = fmt.limpar_titulo(titulo, max(5, len(titulo) - excesso - 1))
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao,
                       detalhe_cupom=condicao, instrucao=False)
    if len(texto) > 300 and cupom:
        texto = montar(titulo, chamada=humana, itens_reputacao=reputacao,
                       instrucao=False, incluir_cupom=False)
    if len(texto) > 300:
        excesso = len(texto) - 300
        titulo = fmt.limpar_titulo(titulo, max(1, len(titulo) - excesso - 1))
        texto = montar(titulo, chamada="", itens_reputacao=[],
                       instrucao=False, incluir_cupom=False)
    if len(texto) > 300:
        # O link nunca é cortado. Mantemos preço, chamada de compra e o
        # máximo de título que ainda cabe no limite da rede.
        essenciais = "\n\n".join(parte for parte in (linha_preco, rodape) if parte)
        espaco = 300 - len(essenciais) - 2
        titulo = fmt.limpar_titulo(oferta.get("productName", "Oferta"), 0)
        titulo = titulo[:max(0, espaco)].rsplit(" ", 1)[0].rstrip(" ,;:-–—|/.")
        texto = "\n\n".join(parte for parte in (titulo, essenciais) if parte)
    if len(texto) > 300:
        raise RuntimeError("O link da oferta é longo demais para o Bluesky")
    inicio_link = len(texto[: texto.rindex(link_afiliado)].encode("utf-8"))
    return texto, inicio_link


def postar(oferta: dict, link_afiliado: str) -> None:
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link de afiliado"
    )
    sess = _sessao()
    jwt, did = sess["accessJwt"], sess["did"]
    texto, inicio_link = montar_texto(oferta, link_afiliado)

    record = {
        "$type": "app.bsky.feed.post",
        "text": texto,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "facets": [{
            "index": {"byteStart": inicio_link,
                      "byteEnd": inicio_link + len(link_afiliado.encode("utf-8"))},
            "features": [{"$type": "app.bsky.richtext.facet#link", "uri": link_afiliado}],
        }],
    }

    blob = _upload_imagem(jwt, oferta.get("imageUrl"), oferta)
    if blob:
        record["embed"] = {
            "$type": "app.bsky.embed.images",
            "images": [{"alt": oferta.get("productName", "Oferta"), "image": blob}],
        }

    pds = _pds()
    r = requests.post(
        f"{pds}/xrpc/com.atproto.repo.createRecord",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"repo": did, "collection": "app.bsky.feed.post", "record": record},
        timeout=30,
        allow_redirects=False,
    )
    if not 200 <= r.status_code < 300:
        raise RuntimeError(seguranca.redigir_segredos(
            f"Bluesky recusou a postagem: {r.text}"
        ))


def postar_bom_dia(mensagem: str) -> None:
    """Publica a saudacao diaria sem link nem imagem."""
    sess = _sessao()
    record = {
        "$type": "app.bsky.feed.post",
        "text": mensagem,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    pds = _pds()
    resposta = requests.post(
        f"{pds}/xrpc/com.atproto.repo.createRecord",
        headers={"Authorization": f"Bearer {sess['accessJwt']}"},
        json={"repo": sess["did"], "collection": "app.bsky.feed.post", "record": record},
        timeout=30,
        allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(seguranca.redigir_segredos(
            f"Bluesky recusou o bom dia: {resposta.text}"
        ))


def postar_shopee_vip(link_afiliado: str, variante=0) -> None:
    """Divulga o Shopee VIP em texto curto, com o link clicável."""
    del variante  # Mantém a mesma interface usada pela campanha do Telegram.
    link_afiliado = seguranca.validar_url_https_publica(
        link_afiliado, "Link do Shopee VIP"
    )
    texto = (
        "👑 SHOPEE VIP\n\n"
        "🆓 Contas elegíveis: 1 mês grátis\n"
        "💳 Depois: R$ 9,90/mês; renovação automática\n\n"
        "✓ Frete grátis acima de R$ 10\n"
        "✓ Cupons mensais\n"
        "✓ Atendimento prioritário\n"
        "✓ 35% off Meu Pet Club\n\n"
        f"Confira as condições: {link_afiliado}"
    )
    if len(texto) > 300:
        raise ValueError("A mensagem do Shopee VIP ultrapassa 300 caracteres")
    inicio = len(texto[:texto.rindex(link_afiliado)].encode("utf-8"))
    sess = _sessao()
    record = {
        "$type": "app.bsky.feed.post",
        "text": texto,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "facets": [{
            "index": {
                "byteStart": inicio,
                "byteEnd": inicio + len(link_afiliado.encode("utf-8")),
            },
            "features": [{
                "$type": "app.bsky.richtext.facet#link", "uri": link_afiliado,
            }],
        }],
    }
    resposta = requests.post(
        f"{_pds()}/xrpc/com.atproto.repo.createRecord",
        headers={"Authorization": f"Bearer {sess['accessJwt']}"},
        json={"repo": sess["did"], "collection": "app.bsky.feed.post", "record": record},
        timeout=30, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(seguranca.redigir_segredos(
            f"Bluesky recusou Shopee VIP: {resposta.text}"
        ))


def postar_cupom(cupom: dict, link_afiliado: str) -> None:
    """Publica alerta de cupom sem imagem, mantendo o link clicavel."""
    link_afiliado = seguranca.validar_url_https_publica(link_afiliado, "Link do cupom")
    fonte = str(cupom.get("fonte") or "Loja")
    codigo = str(cupom.get("codigo") or "").strip()
    titulo = str(cupom.get("titulo") or "Voucher disponível").strip()
    condicao = str(cupom.get("condicao") or "").strip()
    rotulo = "CUPOM LIBERADO" if codigo else "VOUCHER LIBERADO"
    texto = f"🚨 {rotulo} · {fonte}\n\n🎟 {codigo or titulo}"
    if condicao:
        espaco = 300 - len(texto) - len("\nℹ️ \n\nResgate agora: ") - len(link_afiliado)
        texto += "\nℹ️ " + condicao[:max(0, espaco)].rstrip()
    texto += "\n\nResgate agora: " + link_afiliado
    inicio = len(texto[:texto.rindex(link_afiliado)].encode("utf-8"))
    sess = _sessao()
    record = {
        "$type": "app.bsky.feed.post", "text": texto,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "facets": [{"index": {"byteStart": inicio,
                                "byteEnd": inicio + len(link_afiliado.encode("utf-8"))},
                    "features": [{"$type": "app.bsky.richtext.facet#link", "uri": link_afiliado}]}],
    }
    pds = _pds()
    resposta = requests.post(
        f"{pds}/xrpc/com.atproto.repo.createRecord",
        headers={"Authorization": f"Bearer {sess['accessJwt']}"},
        json={"repo": sess["did"], "collection": "app.bsky.feed.post", "record": record},
        timeout=30, allow_redirects=False,
    )
    if not 200 <= resposta.status_code < 300:
        raise RuntimeError(seguranca.redigir_segredos(
            f"Bluesky recusou cupom: {resposta.text}"
        ))
