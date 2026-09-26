"""Diario remoto pequeno que impede republicacoes quando o snapshot falha.

O SQLite continua sendo o estado completo. Esta camada registra a intencao antes
de chamar cada rede social; assim, um erro posterior no GitHub Actions nao faz a
proxima execucao esquecer uma publicacao que pode ja estar visivel.
"""
import hashlib
import json
import os
import time

import requests

import store

MAX_OFERTAS = 180
MAX_BYTES = 40_000


class DiarioRemotoIndisponivel(RuntimeError):
    """Falha sistêmica que deve interromper a rodada antes de publicar."""


def _configuracao():
    repositorio = os.getenv("GITHUB_REPOSITORY", "").strip()
    token = os.getenv("GH_TOKEN", "").strip()
    issue = os.getenv("BOT_JOURNAL_ISSUE", "").strip()
    ativo = os.getenv("IDEMPOTENCIA_REMOTA_ATIVA", "").lower() == "true"
    if not ativo:
        return None
    if not repositorio or not token or not issue.isdigit():
        raise RuntimeError("Diario remoto sem credenciais do GitHub")
    partes = repositorio.split("/")
    if (len(partes) != 2 or not all(
            p and p.replace("-", "").replace("_", "").isalnum()
            for p in partes)):
        raise RuntimeError("GITHUB_REPOSITORY invalido")
    return repositorio, token, issue


def _headers(token):
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _url(repositorio, issue):
    return f"https://api.github.com/repos/{repositorio}/issues/{issue}"


def _vazio():
    return {"v": 1, "ofertas": {}, "bom_dia": {}}


def _ler(sessao=requests):
    configuracao = _configuracao()
    if configuracao is None:
        return None, None
    repositorio, token, issue = configuracao
    resposta = sessao.get(_url(repositorio, issue), headers=_headers(token),
                          timeout=20, allow_redirects=False)
    resposta.raise_for_status()
    try:
        diario = json.loads(resposta.json().get("body") or "{}")
    except (TypeError, ValueError) as erro:
        raise RuntimeError("Diario remoto invalido") from erro
    if not isinstance(diario, dict):
        raise RuntimeError("Diario remoto invalido")
    diario.setdefault("ofertas", {})
    diario.setdefault("bom_dia", {})
    return diario, (repositorio, token, issue)


def _salvar(diario, contexto, sessao=requests):
    repositorio, token, issue = contexto
    ofertas = diario.get("ofertas", {})
    if len(ofertas) > MAX_OFERTAS:
        recentes = sorted(ofertas.items(), key=lambda item: item[1].get("t", 0),
                           reverse=True)[:MAX_OFERTAS]
        diario["ofertas"] = dict(recentes)
    hoje = time.strftime("%Y-%m-%d")
    diario["bom_dia"] = {
        data: canais for data, canais in diario.get("bom_dia", {}).items()
        if data >= hoje
    }
    valor = json.dumps(diario, ensure_ascii=False, separators=(",", ":"))
    # A quantidade fixa não basta: títulos, lojas e a lista de canais tornam
    # cada registro variável. Remove os mais antigos pelo tamanho serializado,
    # preservando a reserva recém-criada e espaço para a próxima atualização.
    if len(valor.encode("utf-8")) > MAX_BYTES:
        recentes = sorted(diario["ofertas"].items(),
                           key=lambda item: item[1].get("t", 0), reverse=True)
        while recentes and len(valor.encode("utf-8")) > MAX_BYTES:
            recentes.pop()
            diario["ofertas"] = dict(recentes)
            valor = json.dumps(diario, ensure_ascii=False, separators=(",", ":"))
    if len(valor.encode("utf-8")) > MAX_BYTES:
        raise DiarioRemotoIndisponivel("Diario remoto excedeu o limite seguro")
    headers = _headers(token)
    resposta = sessao.patch(_url(repositorio, issue), headers=headers,
                            json={"body": valor}, timeout=20,
                            allow_redirects=False)
    resposta.raise_for_status()


def _chave(oferta_id, fonte):
    bruto = f"{fonte}|{oferta_id}".encode("utf-8")
    return hashlib.sha256(bruto).hexdigest()[:20]


def sincronizar(sessao=requests):
    """Reaplica no SQLite reservas recentes feitas antes das publicacoes."""
    diario, _ = _ler(sessao)
    if diario is None:
        return 0
    total = 0
    for item in diario.get("ofertas", {}).values():
        oid = str(item.get("i") or "")
        fonte = str(item.get("f") or "")
        if not oid or not fonte:
            continue
        preco = float(item.get("p") or 0)
        momento = int(item.get("t") or time.time())
        for canal in item.get("c") or []:
            store.registrar_entrega(oid, str(canal), True, preco, fonte,
                                    agora=momento)
            total += 1
        store.marcar_postada(
            oid, preco=preco, fonte=fonte, agora=momento,
            titulo=str(item.get("n") or "") or None,
            categoria=str(item.get("g") or "") or None,
            loja=str(item.get("l") or "") or None,
        )
    for data, canais in diario.get("bom_dia", {}).items():
        for canal in canais or []:
            store.marcar_bom_dia_enviado(data, str(canal))
    return total


def reservar_oferta(oferta_id, canal, preco, fonte, sessao=requests, oferta=None):
    """Reserva antes do POST externo; False significa que ja foi reservado."""
    try:
        diario, contexto = _ler(sessao)
    except Exception as erro:
        raise DiarioRemotoIndisponivel(str(erro)) from erro
    if diario is None:
        return True
    chave = _chave(oferta_id, fonte)
    item = diario["ofertas"].get(chave, {})
    canais = list(item.get("c") or [])
    if canal in canais:
        return False
    canais.append(canal)
    oferta = oferta or {}
    diario["ofertas"][chave] = {
        "i": str(oferta_id), "f": str(fonte), "p": float(preco or 0),
        "t": int(time.time()), "c": canais,
        "n": " ".join(str(oferta.get("productName") or "").split())[:100],
        "g": str(oferta.get("categoria") or "")[:30],
        "l": " ".join(str(oferta.get("shopName") or "").split())[:50],
    }
    try:
        _salvar(diario, contexto, sessao)
    except DiarioRemotoIndisponivel:
        raise
    except Exception as erro:
        raise DiarioRemotoIndisponivel(str(erro)) from erro
    return True


def reservar_bom_dia(data, canal, sessao=requests):
    try:
        diario, contexto = _ler(sessao)
    except Exception as erro:
        raise DiarioRemotoIndisponivel(str(erro)) from erro
    if diario is None:
        return True
    canais = list(diario["bom_dia"].get(str(data)) or [])
    if canal in canais:
        return False
    canais.append(canal)
    diario["bom_dia"][str(data)] = canais
    try:
        _salvar(diario, contexto, sessao)
    except DiarioRemotoIndisponivel:
        raise
    except Exception as erro:
        raise DiarioRemotoIndisponivel(str(erro)) from erro
    return True
