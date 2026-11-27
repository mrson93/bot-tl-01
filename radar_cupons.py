"""Radar de cupons: lê canais públicos do Telegram e avisa o admin.

Nunca publica nada sozinho. Cupons de outros canais podem ser "nominais" (de
outro afiliado, que leva a comissão) ou de uso único; o admin confere na loja
e, se for um cupom público, publica com /cupom (que já usa o nosso link).
Lê a página pública t.me/s/<canal>, sem conta nem API do Telegram.
"""
import html
import json
import re
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

import config
import monitor
import seguranca
import store

FUSO = ZoneInfo("America/Sao_Paulo")
_CHAVE_VISTOS = "radar_cupons_vistos"
_CANAL = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,31}$")
_MENSAGEM = re.compile(
    r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>.*?<time[^>]*datetime="([^"]+)"',
    re.S,
)
# Código: perto de "cupom/código/use", 4 a 20 letras e números em maiúsculas,
# com pelo menos uma letra (preço e data não contam).
_CODIGO = re.compile(
    r"(?:cupom|cupon|c[oó]digo|c[oó]d\.?|use|aplique|voucher)\s*(?:de\s+desconto)?\s*[:\-–]?\s*"
    r"[\"'“`]?([A-Z0-9][A-Z0-9_-]{3,19})\b",
    re.I,
)
_NAO_CODIGO = {"OFF", "AQUI", "LINK", "NOVO", "HOJE", "SHOPEE", "AMAZON", "PRIME", "FRETE", "GRATIS",
               "GRÁTIS", "DESCONTO", "VALIDO", "VÁLIDO", "ABAIXO", "ACIMA", "ATIVE", "RESGATE", "APP"}
_LOJAS = (("Shopee", r"shopee|shope\.ee"), ("Amazon", r"amazon|amzn"),
          ("Mercado Livre", r"mercado\s*livre|meli\.la|mercadolivre"),
          ("AliExpress", r"aliexpress|s\.click"), ("Magalu", r"magalu|magazine\s*luiza"),
          ("Shein", r"shein"), ("Kabum", r"kabum"))


def _texto(trecho_html):
    sem_tags = re.sub(r"<br\s*/?>", "\n", trecho_html)
    sem_tags = re.sub(r"<[^>]+>", " ", sem_tags)
    return " ".join(html.unescape(sem_tags).split())


def _loja(texto):
    for nome, padrao in _LOJAS:
        if re.search(padrao, texto, re.I):
            return nome
    return "?"


def codigos(texto):
    """Códigos de cupom citados numa mensagem (sem repetir)."""
    achados = []
    for codigo in _CODIGO.findall(texto):
        codigo = codigo.strip("-_").upper()
        if (len(codigo) < 4 or codigo in _NAO_CODIGO or not re.search(r"[A-Z]", codigo)
                or codigo.isdigit() or codigo in achados):
            continue
        achados.append(codigo)
    return achados


def mensagens(pagina_html, agora, horas=24):
    """(texto, momento) das mensagens das últimas `horas` da página pública do canal."""
    resultado = []
    for corpo, quando in _MENSAGEM.findall(pagina_html):
        try:
            momento = datetime.fromisoformat(quando.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        if agora - momento <= horas * 3600:
            resultado.append((_texto(corpo), momento))
    return resultado


def ler_canal(canal, agora, sessao=requests):
    if not _CANAL.match(canal):
        raise ValueError(f"Canal inválido: {canal!r}")
    resposta = sessao.get(f"https://t.me/s/{canal}", timeout=20, allow_redirects=False,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; radar-cupons)"})
    if resposta.status_code != 200:
        raise RuntimeError(f"t.me respondeu {resposta.status_code}")
    achados = []
    for texto, _momento in mensagens(resposta.text, agora):
        for codigo in codigos(texto):
            achados.append({"canal": canal, "codigo": codigo, "loja": _loja(texto),
                            "trecho": texto[:140]})
    return achados


def executar(agora=None, sessao=requests) -> int:
    """Nas horas configuradas, junta os códigos novos dos canais e manda ao admin."""
    canais = [c.strip().lstrip("@") for c in config.RADAR_CUPONS_CANAIS if c.strip()]
    if not canais:
        return 0
    agora = agora or datetime.now(timezone.utc)
    local = agora.astimezone(FUSO)
    if local.hour not in config.RADAR_CUPONS_HORAS:
        return 0
    chave_hora = f"radar_cupons:{local.strftime('%Y-%m-%d-%H')}"
    if store._estado(chave_hora):
        return 0
    store._definir_estado(chave_hora, "feito")
    try:
        vistos = json.loads(store._estado(_CHAVE_VISTOS) or "{}")
    except (TypeError, ValueError):
        vistos = {}
    limite_vistos = agora.timestamp() - 7 * 86400
    vistos = {codigo: quando for codigo, quando in vistos.items() if quando > limite_vistos}
    novos, falhas = [], []
    for canal in canais[:20]:
        try:
            for achado in ler_canal(canal, agora.timestamp(), sessao):
                chave = f"{achado['loja']}:{achado['codigo']}"
                if chave in vistos:
                    continue
                vistos[chave] = agora.timestamp()
                novos.append(achado)
        except Exception as erro:
            falhas.append(f"{canal} ({seguranca.redigir_segredos(erro)[:40]})")
        time.sleep(1)
    store._definir_estado(_CHAVE_VISTOS, json.dumps(vistos))
    print(f"🎟 Radar de cupons: {len(novos)} código(s) novo(s) em {len(canais)} canal(is)"
          + (f"; falharam: {', '.join(falhas)}" if falhas else "") + ".")
    if not novos:
        return 0
    linhas = ["🎟 Radar de cupons (confira na loja antes de publicar)", ""]
    for achado in novos[:15]:
        linhas.append(f"• {achado['loja']} · {achado['codigo']} — @{achado['canal']}")
        linhas.append(f"  {achado['trecho']}")
    if len(novos) > 15:
        linhas.append(f"… e mais {len(novos) - 15}.")
    linhas += ["", "Se for cupom público (não nominal de outro afiliado), publique com /cupom."]
    monitor.enviar_mensagem_privada("\n".join(linhas)[:3900], sessao)
    return len(novos)
