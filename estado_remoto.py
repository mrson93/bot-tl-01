"""Restaura e valida o SQLite criptografado guardado no GitHub Actions."""
import argparse
import base64
import hashlib
import io
import os
import re
import sqlite3
import tempfile
import time
import zipfile
import zlib
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import seguranca

DB = Path(__file__).parent / "postadas.db"
DB_CRIPTOGRAFADO = Path(__file__).parent / "postadas.db.enc"
HASH_INICIAL = Path(__file__).parent / ".estado-inicial.sha256"
SEM_REMOTO = Path(__file__).parent / ".estado-sem-remoto"
# O banco guarda histórico agregado e retratos diários de vendas. Dois megabytes
# eram insuficientes para o volume normal e transformavam crescimento legítimo
# em uma parada total. Os limites continuam explícitos para impedir downloads
# descontrolados e arquivos-bomba.
MAX_BANCO = 32 * 1024 * 1024
MAX_DOWNLOAD = MAX_BANCO + 1024 * 1024  # margem para criptografia e contêiner ZIP
MAX_ARTEFATOS_TENTADOS = 10
TAMANHO_PARTE_ISSUE = 50_000
MAX_PARTES_ISSUE = 128
MAX_PAGINAS_COMENTARIOS = 10
MAGIA = b"DEAL-SIGNAL-STATE-1\x00"
MAGIA_COMPACTADA = b"DEAL-SIGNAL-STATE-2\x00"
CONTEXTO = b"bot-state:v1"
PADRAO_MANIFESTO = re.compile(
    r"<!-- bot-state-manifest:v1:([0-9a-f]{64}):(\d+):(\d+) -->"
)
PADRAO_PARTE = re.compile(
    r"\A<!-- bot-state-part:v1:([0-9a-f]{64}):(\d+)/(\d+) -->\n"
    r"([A-Za-z0-9+/=]+)\Z"
)
PADRAO_RELEASE = re.compile(
    r"<!-- bot-state-release:v1:([0-9a-f]{64}):(\d+):([A-Za-z0-9._-]+) -->"
)
ARQUIVO_BRANCH = "postadas.db.enc"


def _hash(caminho=DB):
    if not caminho.exists():
        return ""
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


def _headers(token):
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _validar_sqlite(caminho):
    with sqlite3.connect(caminho) as con:
        resultado = con.execute("PRAGMA integrity_check").fetchone()
    if not resultado or resultado[0] != "ok":
        raise RuntimeError("O estado remoto falhou na verificacao de integridade")


def _compactar_estado(caminho=DB, agora=None):
    """Limita históricos técnicos e recupera espaço antes de salvar o estado."""
    if not caminho.exists():
        return
    momento = int(agora or time.time())
    dia_atual = date.fromtimestamp(momento)
    cortes_epoch = {
        "eventos": momento - 90 * 86400,
        "entregas": momento - 180 * 86400,
        "entregas_log": momento - 180 * 86400,
        "entregas_cupom": momento - 180 * 86400,
        "postadas": momento - 180 * 86400,
        "desempenho": momento - 180 * 86400,
    }
    cortes_data = {
        "vendas_produto_diarias": (dia_atual - timedelta(days=45)).isoformat(),
        "metricas_diarias": (dia_atual - timedelta(days=400)).isoformat(),
        "metricas_categoria_diarias": (dia_atual - timedelta(days=400)).isoformat(),
        "experimentos_diarios": (dia_atual - timedelta(days=400)).isoformat(),
    }
    with sqlite3.connect(caminho, timeout=30) as con:
        tabelas = {linha[0] for linha in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        colunas_epoch = {
            "eventos": "ocorrido_em", "entregas": "entregue_em",
            "entregas_log": "entregue_em", "entregas_cupom": "entregue_em",
            "postadas": "postada_em", "desempenho": "atualizado_em",
        }
        for tabela, corte in cortes_epoch.items():
            if tabela in tabelas:
                con.execute(
                    f"DELETE FROM {tabela} WHERE {colunas_epoch[tabela]}<?",
                    (corte,),
                )
        for tabela, corte in cortes_data.items():
            if tabela in tabelas:
                con.execute(f"DELETE FROM {tabela} WHERE data<?", (corte,))
        if "cupons_ativos" in tabelas:
            con.execute(
                "DELETE FROM cupons_ativos WHERE "
                "(expira_em IS NOT NULL AND expira_em<?) OR visto_em<?",
                (momento - 30 * 86400, momento - 180 * 86400),
            )
        if "estado" in tabelas:
            corte_resumos = (dia_atual - timedelta(days=30)).isoformat()
            con.execute(
                "DELETE FROM estado WHERE chave LIKE 'resumo_cupons:%' "
                "AND substr(chave,15,10)<?",
                (corte_resumos,),
            )
        con.commit()
        paginas_livres = int(con.execute("PRAGMA freelist_count").fetchone()[0])
        paginas = int(con.execute("PRAGMA page_count").fetchone()[0])
        if paginas_livres >= 128 and paginas_livres * 5 >= paginas:
            con.execute("VACUUM")
        con.execute("PRAGMA optimize")


def _chave_estado():
    valor = os.getenv("BOT_STATE_KEY", "").strip()
    try:
        preenchido = valor + "=" * (-len(valor) % 4)
        chave = base64.b64decode(preenchido, altchars=b"-_", validate=True)
    except (ValueError, TypeError) as erro:
        raise RuntimeError("BOT_STATE_KEY invalida") from erro
    if len(chave) != 32:
        raise RuntimeError("BOT_STATE_KEY precisa ter 32 bytes")
    return chave


def _criptografar(dados):
    nonce = os.urandom(12)
    # O ZIP do GitHub nao consegue compactar dados depois de criptografados.
    # Compactar antes do AES-GCM reduz cada snapshot sem expor o SQLite.
    compactados = zlib.compress(dados, level=9)
    return MAGIA_COMPACTADA + nonce + AESGCM(_chave_estado()).encrypt(
        nonce, compactados, CONTEXTO
    )


def _descriptografar(dados):
    magia = (MAGIA_COMPACTADA if dados.startswith(MAGIA_COMPACTADA)
             else MAGIA if dados.startswith(MAGIA) else None)
    if magia is None or len(dados) <= len(magia) + 28:
        raise RuntimeError("Estado remoto criptografado invalido")
    inicio = len(magia)
    nonce = dados[inicio:inicio + 12]
    try:
        conteudo = AESGCM(_chave_estado()).decrypt(
            nonce, dados[inicio + 12:], CONTEXTO
        )
    except Exception as erro:
        raise RuntimeError("Nao foi possivel autenticar o estado remoto") from erro
    if magia == MAGIA:
        return conteudo  # snapshots antigos continuam restauraveis
    try:
        descompactador = zlib.decompressobj()
        bruto = descompactador.decompress(conteudo, MAX_BANCO + 1)
        if (len(bruto) > MAX_BANCO or descompactador.unconsumed_tail
                or not descompactador.eof or descompactador.unused_data):
            raise RuntimeError("Estado remoto compactado excede o limite ou esta invalido")
        return bruto
    except zlib.error as erro:
        raise RuntimeError("Estado remoto compactado invalido") from erro


def preparar_upload():
    if not DB.exists():
        raise RuntimeError("Banco local nao encontrado para proteger")
    _compactar_estado(DB)
    _validar_sqlite(DB)
    if DB.stat().st_size > MAX_BANCO:
        raise RuntimeError("Banco local excedeu o limite mesmo apos a compactacao")
    protegido = _criptografar(DB.read_bytes())
    with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as temporario:
        temporario.write(protegido)
        caminho_temporario = Path(temporario.name)
    try:
        caminho_temporario.chmod(0o600)
        caminho_temporario.replace(DB_CRIPTOGRAFADO)
    finally:
        caminho_temporario.unlink(missing_ok=True)
    print("✅ Estado protegido e pronto para envio.")
    return True


def _configuracao_github():
    repositorio = os.getenv("GITHUB_REPOSITORY", "").strip()
    token = os.getenv("GH_TOKEN", "").strip()
    if not repositorio or not token:
        return None
    if (repositorio.count("/") != 1 or not all(
            parte and parte.replace("-", "").replace("_", "").isalnum()
            for parte in repositorio.split("/"))):
        raise RuntimeError("GITHUB_REPOSITORY invalido")
    return repositorio, token


def _numero_issue_estado():
    valor = os.getenv("BOT_STATE_ISSUE", "").strip()
    if not valor:
        return None
    if not valor.isdigit() or int(valor) <= 0:
        raise RuntimeError("BOT_STATE_ISSUE invalido")
    return int(valor)


def _tag_release_estado():
    valor = os.getenv("BOT_STATE_RELEASE_TAG", "").strip()
    if not valor:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", valor):
        raise RuntimeError("BOT_STATE_RELEASE_TAG invalida")
    return valor


def _ref_estado():
    valor = os.getenv("BOT_STATE_REF", "").strip()
    if not valor:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._/-]{1,120}", valor) or ".." in valor:
        raise RuntimeError("BOT_STATE_REF invalida")
    return valor.removeprefix("refs/heads/")


def _api_git(repositorio, caminho):
    return f"https://api.github.com/repos/{repositorio}/git/{caminho}"


def _restaurar_de_branch(sessao, repositorio, token, ref):
    headers = _headers(token)
    resposta = sessao.get(
        _api_git(repositorio, f"ref/heads/{ref}"), headers=headers,
        timeout=30, allow_redirects=False,
    )
    if resposta.status_code == 404:
        return None
    resposta.raise_for_status()
    commit_sha = str((resposta.json().get("object") or {}).get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise RuntimeError("Referencia do estado remoto invalida")
    resposta = sessao.get(
        _api_git(repositorio, f"commits/{commit_sha}"), headers=headers,
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    tree_sha = str((resposta.json().get("tree") or {}).get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", tree_sha):
        raise RuntimeError("Commit do estado remoto invalido")
    resposta = sessao.get(
        _api_git(repositorio, f"trees/{tree_sha}"), headers=headers,
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    item = next((entrada for entrada in resposta.json().get("tree") or []
                 if entrada.get("path") == ARQUIVO_BRANCH
                 and entrada.get("type") == "blob"), None)
    blob_sha = str((item or {}).get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
        raise RuntimeError("Arquivo do estado remoto nao encontrado na branch")
    resposta = sessao.get(
        _api_git(repositorio, f"blobs/{blob_sha}"), headers=headers,
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    blob = resposta.json() or {}
    if blob.get("encoding") != "base64" or int(blob.get("size") or 0) > MAX_DOWNLOAD:
        raise RuntimeError("Blob do estado remoto invalido")
    try:
        protegido = base64.b64decode(
            str(blob.get("content") or "").replace("\n", ""), validate=True
        )
    except (ValueError, TypeError) as erro:
        raise RuntimeError("Blob do estado remoto possui base64 invalido") from erro
    if len(protegido) != int(blob.get("size") or -1):
        raise RuntimeError("Blob do estado remoto esta incompleto")
    return _descriptografar(protegido)


def salvar_branch(sessao=requests):
    """Substitui um snapshot criptografado numa branch técnica sem histórico."""
    configuracao = _configuracao_github()
    ref = _ref_estado()
    if not configuracao or not ref:
        raise RuntimeError("Armazenamento remoto por branch nao configurado")
    preparar_upload()
    protegido = DB_CRIPTOGRAFADO.read_bytes()
    if len(protegido) > MAX_DOWNLOAD:
        raise RuntimeError("Estado remoto excedeu o limite de seguranca")
    repositorio, token = configuracao
    headers = _headers(token)
    resposta = sessao.post(
        _api_git(repositorio, "blobs"), headers=headers,
        json={"content": base64.b64encode(protegido).decode("ascii"),
              "encoding": "base64"}, timeout=60, allow_redirects=False,
    )
    resposta.raise_for_status()
    blob_sha = str(resposta.json().get("sha") or "")
    resposta = sessao.post(
        _api_git(repositorio, "trees"), headers=headers,
        json={"tree": [{"path": ARQUIVO_BRANCH, "mode": "100644",
                         "type": "blob", "sha": blob_sha}]},
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    tree_sha = str(resposta.json().get("sha") or "")
    resposta = sessao.post(
        _api_git(repositorio, "commits"), headers=headers,
        json={"message": "Atualiza estado criptografado do bot",
              "tree": tree_sha},
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    commit_sha = str(resposta.json().get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise RuntimeError("GitHub nao confirmou o commit do estado")
    api_ref = _api_git(repositorio, f"refs/heads/{ref}")
    atual = sessao.get(api_ref, headers=headers, timeout=30,
                       allow_redirects=False)
    if atual.status_code == 404:
        resposta = sessao.post(
            _api_git(repositorio, "refs"), headers=headers,
            json={"ref": f"refs/heads/{ref}", "sha": commit_sha},
            timeout=30, allow_redirects=False,
        )
    else:
        atual.raise_for_status()
        resposta = sessao.patch(
            api_ref, headers=headers,
            json={"sha": commit_sha, "force": True},
            timeout=30, allow_redirects=False,
        )
    resposta.raise_for_status()
    print(f"✅ Estado remoto salvo na branch criptografada ({len(protegido)} bytes).")
    return True


def _obter_release(sessao, repositorio, token, tag, criar=False):
    api = f"https://api.github.com/repos/{repositorio}/releases"
    resposta = sessao.get(
        api, headers=_headers(token), params={"per_page": 100}, timeout=30,
        allow_redirects=False,
    )
    resposta.raise_for_status()
    for release in resposta.json() or []:
        if release.get("tag_name") == tag:
            return release
    if not criar:
        return None
    resposta = sessao.post(
        api, headers=_headers(token), json={
            "tag_name": tag,
            "target_commitish": "main",
            "name": "Estado remoto criptografado",
            "body": "Snapshot técnico criptografado; não publicar nem editar.",
            "draft": True,
            "prerelease": True,
        }, timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    return resposta.json()


def _baixar_asset_release(asset, sessao, token):
    url = str(asset.get("url") or "")
    origem = urlparse(url)
    if origem.scheme != "https" or origem.netloc.lower() != "api.github.com":
        raise RuntimeError("GitHub devolveu uma origem inesperada para o estado")
    headers = _headers(token)
    headers["Accept"] = "application/octet-stream"
    primeira = sessao.get(
        url, headers=headers, timeout=30, allow_redirects=False
    )
    if primeira.status_code not in {301, 302, 303, 307, 308}:
        primeira.raise_for_status()
        raise RuntimeError("GitHub nao forneceu o download seguro do estado")
    destino = seguranca.validar_url_https_publica(
        primeira.headers.get("Location"), "Download do estado"
    )
    download = sessao.get(destino, timeout=30, allow_redirects=False, stream=True)
    download.raise_for_status()
    conteudo = bytearray()
    try:
        for pedaco in download.iter_content(chunk_size=64 * 1024):
            conteudo.extend(pedaco)
            if len(conteudo) > MAX_DOWNLOAD:
                raise RuntimeError("Estado remoto excedeu o limite de seguranca")
    finally:
        download.close()
    return bytes(conteudo)


def _restaurar_de_release(sessao, repositorio, token, tag):
    release = _obter_release(sessao, repositorio, token, tag)
    if not release:
        return None
    manifesto = PADRAO_RELEASE.search(str(release.get("body") or ""))
    if not manifesto:
        return None
    identificador, tamanho_texto, nome = manifesto.groups()
    tamanho = int(tamanho_texto)
    if tamanho <= 0 or tamanho > MAX_DOWNLOAD:
        raise RuntimeError("Manifesto da release de estado invalido")
    asset = next((item for item in release.get("assets") or []
                  if item.get("name") == nome), None)
    if not asset:
        raise RuntimeError("Asset do estado remoto nao encontrado")
    protegido = _baixar_asset_release(asset, sessao, token)
    if len(protegido) != tamanho or hashlib.sha256(protegido).hexdigest() != identificador:
        raise RuntimeError("Asset do estado remoto falhou na verificacao")
    return _descriptografar(protegido)


def salvar_release(sessao=requests):
    """Salva o snapshot em uma release rascunho, sem e-mails ou Actions Storage."""
    configuracao = _configuracao_github()
    tag = _tag_release_estado()
    if not configuracao or not tag:
        raise RuntimeError("Armazenamento remoto por release nao configurado")
    preparar_upload()
    protegido = DB_CRIPTOGRAFADO.read_bytes()
    if len(protegido) > MAX_DOWNLOAD:
        raise RuntimeError("Estado remoto excedeu o limite de seguranca")
    repositorio, token = configuracao
    release = _obter_release(sessao, repositorio, token, tag, criar=True)
    release_id = release.get("id")
    if not release_id:
        raise RuntimeError("Release do estado remoto invalida")
    identificador = hashlib.sha256(protegido).hexdigest()
    nome = f"bot-state-{identificador[:16]}.enc"
    assets = release.get("assets") or []
    novo = next((asset for asset in assets if asset.get("name") == nome), None)
    if not novo:
        upload = (
            f"https://uploads.github.com/repos/{repositorio}/releases/"
            f"{release_id}/assets"
        )
        headers = _headers(token)
        headers["Content-Type"] = "application/octet-stream"
        resposta = sessao.post(
            upload, headers=headers, params={"name": nome}, data=protegido,
            timeout=60, allow_redirects=False,
        )
        resposta.raise_for_status()
        novo = resposta.json()
    manifesto = (
        f"<!-- bot-state-release:v1:{identificador}:{len(protegido)}:{nome} -->\n"
        "Snapshot técnico criptografado; não publicar nem editar."
    )
    resposta = sessao.patch(
        f"https://api.github.com/repos/{repositorio}/releases/{release_id}",
        headers=_headers(token), json={"body": manifesto, "draft": True},
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    novo_id = novo.get("id")
    for asset in assets:
        asset_id = asset.get("id")
        if not asset_id or asset_id == novo_id:
            continue
        try:
            exclusao = sessao.delete(
                f"https://api.github.com/repos/{repositorio}/releases/assets/{asset_id}",
                headers=_headers(token), timeout=30, allow_redirects=False,
            )
            if exclusao.status_code not in {204, 404}:
                exclusao.raise_for_status()
        except Exception as erro:
            print(f"⚠️ Asset antigo do estado nao removido: {type(erro).__name__}")
    print(f"✅ Estado remoto salvo na release rascunho ({len(protegido)} bytes).")
    return True


def _listar_comentarios_issue(api_issue, sessao, token):
    comentarios = []
    for pagina in range(1, MAX_PAGINAS_COMENTARIOS + 1):
        resposta = sessao.get(
            f"{api_issue}/comments", headers=_headers(token),
            params={"per_page": 100, "page": pagina}, timeout=30,
            allow_redirects=False,
        )
        resposta.raise_for_status()
        lote = resposta.json() or []
        comentarios.extend(lote)
        if len(lote) < 100:
            return comentarios
    raise RuntimeError("Estado remoto possui comentarios demais")


def _restaurar_de_issue(sessao, repositorio, token, numero_issue):
    api_issue = f"https://api.github.com/repos/{repositorio}/issues/{numero_issue}"
    resposta = sessao.get(
        api_issue, headers=_headers(token), timeout=30, allow_redirects=False
    )
    if resposta.status_code == 404:
        return None
    resposta.raise_for_status()
    corpo = str((resposta.json() or {}).get("body") or "")
    manifesto = PADRAO_MANIFESTO.search(corpo)
    if not manifesto:
        return None
    identificador, total_texto, tamanho_texto = manifesto.groups()
    total = int(total_texto)
    tamanho = int(tamanho_texto)
    if total <= 0 or total > MAX_PARTES_ISSUE or tamanho > MAX_DOWNLOAD:
        raise RuntimeError("Manifesto do estado remoto invalido")
    partes = {}
    for comentario in _listar_comentarios_issue(api_issue, sessao, token):
        encontrado = PADRAO_PARTE.fullmatch(str(comentario.get("body") or ""))
        if not encontrado or encontrado.group(1) != identificador:
            continue
        indice = int(encontrado.group(2))
        if int(encontrado.group(3)) != total or not 1 <= indice <= total:
            continue
        partes[indice] = encontrado.group(4)
    if len(partes) != total:
        raise RuntimeError("Snapshot do estado remoto esta incompleto")
    try:
        protegido = base64.b64decode(
            "".join(partes[i] for i in range(1, total + 1)), validate=True
        )
    except (ValueError, TypeError) as erro:
        raise RuntimeError("Snapshot do estado remoto possui base64 invalido") from erro
    if len(protegido) != tamanho or hashlib.sha256(protegido).hexdigest() != identificador:
        raise RuntimeError("Snapshot do estado remoto falhou na verificacao")
    return _descriptografar(protegido)


def salvar_issue(sessao=requests):
    """Salva um snapshot criptografado numa issue, sem consumir Actions Storage."""
    configuracao = _configuracao_github()
    numero_issue = _numero_issue_estado()
    if not configuracao or not numero_issue:
        raise RuntimeError("Armazenamento remoto por issue nao configurado")
    preparar_upload()
    protegido = DB_CRIPTOGRAFADO.read_bytes()
    codificado = base64.b64encode(protegido).decode("ascii")
    partes = [codificado[i:i + TAMANHO_PARTE_ISSUE]
              for i in range(0, len(codificado), TAMANHO_PARTE_ISSUE)]
    if not partes or len(partes) > MAX_PARTES_ISSUE:
        raise RuntimeError("Estado remoto excedeu a capacidade segura da issue")
    repositorio, token = configuracao
    api_issue = f"https://api.github.com/repos/{repositorio}/issues/{numero_issue}"
    antigos = _listar_comentarios_issue(api_issue, sessao, token)
    identificador = hashlib.sha256(protegido).hexdigest()
    total = len(partes)
    novos_ids = set()
    for indice, parte in enumerate(partes, 1):
        corpo = (
            f"<!-- bot-state-part:v1:{identificador}:{indice}/{total} -->\n{parte}"
        )
        resposta = sessao.post(
            f"{api_issue}/comments", headers=_headers(token), json={"body": corpo},
            timeout=30, allow_redirects=False,
        )
        resposta.raise_for_status()
        comentario_id = (resposta.json() or {}).get("id")
        if comentario_id:
            novos_ids.add(int(comentario_id))
    manifesto = (
        f"<!-- bot-state-manifest:v1:{identificador}:{total}:{len(protegido)} -->\n"
        "Snapshot criptografado do bot. Conteudo tecnico; nao editar."
    )
    resposta = sessao.patch(
        api_issue, headers=_headers(token), json={"body": manifesto},
        timeout=30, allow_redirects=False,
    )
    resposta.raise_for_status()
    removidos = 0
    for comentario in antigos:
        comentario_id = comentario.get("id")
        if not comentario_id or int(comentario_id) in novos_ids:
            continue
        try:
            exclusao = sessao.delete(
                f"https://api.github.com/repos/{repositorio}/issues/comments/{comentario_id}",
                headers=_headers(token), timeout=30, allow_redirects=False,
            )
            if exclusao.status_code not in {204, 404}:
                exclusao.raise_for_status()
            removidos += 1
        except Exception as erro:
            print(f"⚠️ Comentario antigo do estado nao removido: {type(erro).__name__}")
    print(f"✅ Estado remoto salvo sem Actions Storage ({total} parte(s), "
          f"{removidos} antiga(s) removida(s)).")
    return True


def _baixar_e_validar(artefato, sessao, token):
    """Baixa um snapshot e devolve o SQLite autenticado, ainda em memória."""
    url_arquivo = str(artefato.get("archive_download_url") or "")
    origem = urlparse(url_arquivo)
    if origem.scheme != "https" or origem.netloc.lower() != "api.github.com":
        raise RuntimeError("GitHub devolveu uma origem inesperada para o estado")
    primeira = sessao.get(url_arquivo, headers=_headers(token),
                          timeout=30, allow_redirects=False)
    if primeira.status_code not in {301, 302, 303, 307, 308}:
        primeira.raise_for_status()
        raise RuntimeError("GitHub nao forneceu o download seguro do estado")
    destino = seguranca.validar_url_https_publica(
        primeira.headers.get("Location"), "Download do estado"
    )
    download = sessao.get(destino, timeout=30, allow_redirects=False, stream=True)
    download.raise_for_status()
    tamanho_declarado = download.headers.get("Content-Length")
    if isinstance(tamanho_declarado, str) and tamanho_declarado.isdigit():
        if int(tamanho_declarado) > MAX_DOWNLOAD:
            download.close()
            raise RuntimeError("Estado remoto excedeu o limite de seguranca")
    conteudo = bytearray()
    try:
        for pedaco in download.iter_content(chunk_size=64 * 1024):
            conteudo.extend(pedaco)
            if len(conteudo) > MAX_DOWNLOAD:
                raise RuntimeError("Estado remoto excedeu o limite de seguranca")
    finally:
        download.close()
    with zipfile.ZipFile(io.BytesIO(conteudo)) as arquivo:
        membros = [m for m in arquivo.infolist() if not m.is_dir()]
        if len(membros) != 1:
            raise RuntimeError("Artefato de estado possui conteudo inesperado")
        if membros[0].file_size > MAX_BANCO:
            raise RuntimeError("Banco remoto excedeu o limite de seguranca")
        nome = Path(membros[0].filename).name
        dados_armazenados = arquivo.read(membros[0])
    if nome != "postadas.db.enc":
        raise RuntimeError("Artefato de estado nao esta criptografado")
    dados = _descriptografar(dados_armazenados)
    if len(dados) > MAX_BANCO:
        raise RuntimeError("Banco remoto excedeu o limite de seguranca")
    return dados


def restaurar(obrigatorio=False, sessao=requests):
    configuracao = _configuracao_github()
    if not configuracao:
        HASH_INICIAL.write_text(_hash(), encoding="ascii")
        return False
    repositorio, token = configuracao
    ref = _ref_estado()
    if ref:
        dados_branch = _restaurar_de_branch(
            sessao, repositorio, token, ref
        )
        if dados_branch is not None:
            with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as temporario:
                temporario.write(dados_branch)
                caminho_temporario = Path(temporario.name)
            try:
                _validar_sqlite(caminho_temporario)
                caminho_temporario.replace(DB)
            finally:
                caminho_temporario.unlink(missing_ok=True)
            SEM_REMOTO.unlink(missing_ok=True)
            HASH_INICIAL.write_text(_hash(), encoding="ascii")
            print("✅ Estado remoto restaurado da branch e validado.")
            return True
    tag_release = _tag_release_estado()
    if tag_release:
        dados_release = _restaurar_de_release(
            sessao, repositorio, token, tag_release
        )
        if dados_release is not None:
            with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as temporario:
                temporario.write(dados_release)
                caminho_temporario = Path(temporario.name)
            try:
                _validar_sqlite(caminho_temporario)
                caminho_temporario.replace(DB)
            finally:
                caminho_temporario.unlink(missing_ok=True)
            SEM_REMOTO.unlink(missing_ok=True)
            HASH_INICIAL.write_text(_hash(), encoding="ascii")
            print("✅ Estado remoto restaurado da release e validado.")
            return True
    numero_issue = _numero_issue_estado()
    if numero_issue:
        dados_issue = _restaurar_de_issue(
            sessao, repositorio, token, numero_issue
        )
        if dados_issue is not None:
            with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as temporario:
                temporario.write(dados_issue)
                caminho_temporario = Path(temporario.name)
            try:
                _validar_sqlite(caminho_temporario)
                caminho_temporario.replace(DB)
            finally:
                caminho_temporario.unlink(missing_ok=True)
            SEM_REMOTO.unlink(missing_ok=True)
            HASH_INICIAL.write_text(_hash(), encoding="ascii")
            print("✅ Estado remoto restaurado da issue e validado.")
            return True
    # Migração: enquanto existir, o último artefato válido inicializa a issue.
    api = f"https://api.github.com/repos/{repositorio}/actions/artifacts"
    resposta = sessao.get(api, headers=_headers(token),
                          params={"name": "bot-state", "per_page": 100},
                          timeout=30, allow_redirects=False)
    resposta.raise_for_status()
    artefatos = [a for a in (resposta.json().get("artifacts") or [])
                 if not a.get("expired")]
    artefatos.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    if not artefatos:
        if obrigatorio:
            raise RuntimeError("Nenhum estado remoto valido foi encontrado")
        SEM_REMOTO.write_text("1", encoding="ascii")
        HASH_INICIAL.write_text(_hash(), encoding="ascii")
        return False

    dados = None
    ultimo_erro = None
    for artefato in artefatos[:MAX_ARTEFATOS_TENTADOS]:
        try:
            dados = _baixar_e_validar(artefato, sessao, token)
            break
        except Exception as erro:
            ultimo_erro = erro
            print(f"⚠️ Snapshot {artefato.get('id', 'desconhecido')} ignorado: "
                  f"{type(erro).__name__}")
    if dados is None:
        detalhe = str(ultimo_erro or "erro desconhecido")
        raise RuntimeError(
            f"Nenhum dos snapshots recentes pode ser restaurado: {detalhe}"
        ) from ultimo_erro
    with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as temporario:
        temporario.write(dados)
        caminho_temporario = Path(temporario.name)
    try:
        _validar_sqlite(caminho_temporario)
        caminho_temporario.replace(DB)
    finally:
        caminho_temporario.unlink(missing_ok=True)
    SEM_REMOTO.unlink(missing_ok=True)
    HASH_INICIAL.write_text(_hash(), encoding="ascii")
    print("✅ Estado remoto restaurado e validado.")
    return True


def verificar_alteracao():
    inicial = HASH_INICIAL.read_text(encoding="ascii").strip() if HASH_INICIAL.exists() else ""
    alterado = SEM_REMOTO.exists() or _hash() != inicial
    saida = os.getenv("GITHUB_OUTPUT", "").strip()
    if saida:
        with open(saida, "a", encoding="utf-8") as arquivo:
            arquivo.write(f"changed={'true' if alterado else 'false'}\n")
    print(f"Estado alterado: {'sim' if alterado else 'nao'}")
    return alterado


def limpar_artefatos_antigos(manter=2, sessao=requests):
    """Remove snapshots redundantes; preserva os mais novos para recuperacao."""
    repositorio = os.getenv("GITHUB_REPOSITORY", "").strip()
    token = os.getenv("GH_TOKEN", "").strip()
    if not repositorio or not token:
        return 0
    api = f"https://api.github.com/repos/{repositorio}/actions/artifacts"
    resposta = sessao.get(api, headers=_headers(token),
                          params={"name": "bot-state", "per_page": 100},
                          timeout=30, allow_redirects=False)
    resposta.raise_for_status()
    artefatos = [a for a in resposta.json().get("artifacts", [])
                 if not a.get("expired")]
    artefatos.sort(key=lambda a: a.get("created_at") or "", reverse=True)
    removidos = 0
    for artefato in artefatos[max(1, int(manter)):]:
        identificador = artefato.get("id")
        if not identificador:
            continue
        exclusao = sessao.delete(
            f"{api}/{identificador}", headers=_headers(token), timeout=30,
            allow_redirects=False,
        )
        if exclusao.status_code not in {204, 404}:
            exclusao.raise_for_status()
        removidos += 1
    print(f"🧹 {removidos} snapshot(s) redundante(s) removido(s).")
    return removidos


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "acao", choices=("restaurar", "alterado", "preparar", "salvar", "limpar")
    )
    parser.add_argument("--obrigatorio", action="store_true")
    args = parser.parse_args()
    if args.acao == "restaurar":
        restaurar(args.obrigatorio)
    elif args.acao == "preparar":
        preparar_upload()
    elif args.acao == "salvar":
        if _ref_estado():
            salvar_branch()
        else:
            salvar_release()
    elif args.acao == "limpar":
        limpar_artefatos_antigos()
    else:
        verificar_alteracao()


if __name__ == "__main__":
    main()
