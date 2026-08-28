"""Restaura e valida o SQLite criptografado guardado no GitHub Actions."""
import argparse
import base64
import hashlib
import io
import os
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import seguranca

DB = Path(__file__).parent / "postadas.db"
DB_CRIPTOGRAFADO = Path(__file__).parent / "postadas.db.enc"
HASH_INICIAL = Path(__file__).parent / ".estado-inicial.sha256"
SEM_REMOTO = Path(__file__).parent / ".estado-sem-remoto"
MAX_DOWNLOAD = 2_000_000
MAGIA = b"DEAL-SIGNAL-STATE-1\x00"
CONTEXTO = b"bot-state:v1"


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
    return MAGIA + nonce + AESGCM(_chave_estado()).encrypt(nonce, dados, CONTEXTO)


def _descriptografar(dados):
    if not dados.startswith(MAGIA) or len(dados) <= len(MAGIA) + 28:
        raise RuntimeError("Estado remoto criptografado invalido")
    inicio = len(MAGIA)
    nonce = dados[inicio:inicio + 12]
    try:
        return AESGCM(_chave_estado()).decrypt(nonce, dados[inicio + 12:], CONTEXTO)
    except Exception as erro:
        raise RuntimeError("Nao foi possivel autenticar o estado remoto") from erro


def preparar_upload():
    if not DB.exists():
        raise RuntimeError("Banco local nao encontrado para proteger")
    _validar_sqlite(DB)
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


def restaurar(obrigatorio=False, sessao=requests):
    repositorio = os.getenv("GITHUB_REPOSITORY", "").strip()
    token = os.getenv("GH_TOKEN", "").strip()
    if not repositorio or not token:
        HASH_INICIAL.write_text(_hash(), encoding="ascii")
        return False
    if not all(parte and parte.replace("-", "").replace("_", "").isalnum()
               for parte in repositorio.split("/")) or repositorio.count("/") != 1:
        raise RuntimeError("GITHUB_REPOSITORY invalido")
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

    url_arquivo = str(artefatos[0].get("archive_download_url") or "")
    origem = urlparse(url_arquivo)
    if origem.scheme != "https" or origem.netloc.lower() != "api.github.com":
        raise RuntimeError("GitHub devolveu uma origem inesperada para o estado")
    primeira = sessao.get(url_arquivo,
                          headers=_headers(token), timeout=30,
                          allow_redirects=False)
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
    with zipfile.ZipFile(io.BytesIO(conteudo)) as arquivo:
        membros = [m for m in arquivo.infolist() if not m.is_dir()]
        if len(membros) != 1:
            raise RuntimeError("Artefato de estado possui conteudo inesperado")
        if membros[0].file_size > MAX_DOWNLOAD:
            raise RuntimeError("Banco remoto excedeu o limite de seguranca")
        nome = Path(membros[0].filename).name
        dados_armazenados = arquivo.read(membros[0])
    if nome == "postadas.db.enc":
        dados = _descriptografar(dados_armazenados)
    else:
        raise RuntimeError("Artefato de estado nao esta criptografado")
    if len(dados) > MAX_DOWNLOAD:
        raise RuntimeError("Banco remoto excedeu o limite de seguranca")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("acao", choices=("restaurar", "alterado", "preparar"))
    parser.add_argument("--obrigatorio", action="store_true")
    args = parser.parse_args()
    if args.acao == "restaurar":
        restaurar(args.obrigatorio)
    elif args.acao == "preparar":
        preparar_upload()
    else:
        verificar_alteracao()


if __name__ == "__main__":
    main()
