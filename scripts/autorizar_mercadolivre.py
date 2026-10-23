"""Autoriza o bot a ler a API do Mercado Livre e grava o acesso no GitHub.

Uso (uma vez, depois de criar o aplicativo no DevCenter):
    python3 scripts/autorizar_mercadolivre.py

O App ID e a Secret Key são pedidos no terminal (a chave não aparece). O
acesso obtido vai direto para os secrets do repositório via `gh`, sem ser
exibido nem salvo em arquivo.
"""
import base64
import getpass
import hashlib
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REDIRECT_URI = "https://canaltabarato.com.br/"
AUTH_URL = "https://auth.mercadolivre.com.br/authorization"
API = "https://api.mercadolibre.com"
CATEGORIA_TESTE = "MLB1574"  # Casa, Móveis e Decoração


def _requisicao(url, dados=None, token=None):
    cabecalhos = {"Accept": "application/json"}
    corpo = None
    if dados is not None:
        corpo = urllib.parse.urlencode(dados).encode()
        cabecalhos["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        cabecalhos["Authorization"] = f"Bearer {token}"
    pedido = urllib.request.Request(url, data=corpo, headers=cabecalhos)
    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            return resposta.status, json.load(resposta)
    except urllib.error.HTTPError as erro:
        try:
            return erro.code, json.load(erro)
        except ValueError:
            return erro.code, {}


def _gravar_secret(nome, valor):
    resultado = subprocess.run(["gh", "secret", "set", nome], input=valor,
                               text=True, capture_output=True)
    if resultado.returncode != 0:
        raise SystemExit(f"Não consegui gravar {nome} no GitHub: {resultado.stderr.strip()[:200]}")


def main():
    app_id = input("App ID do aplicativo do Mercado Livre: ").strip()
    if not app_id.isdigit():
        raise SystemExit("O App ID é só números.")
    segredo = getpass.getpass("Secret Key (não aparece na tela): ").strip()
    if len(segredo) < 10:
        raise SystemExit("Secret Key vazia ou curta demais.")

    verificador = secrets.token_urlsafe(64)[:96]
    desafio = base64.urlsafe_b64encode(
        hashlib.sha256(verificador.encode()).digest()
    ).decode().rstrip("=")
    link = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": app_id, "redirect_uri": REDIRECT_URI,
        "code_challenge": desafio, "code_challenge_method": "S256",
    })
    print("\n1) Abra este link, entre com a sua conta e clique em Permitir:\n")
    print(link)
    print("\n2) Você vai cair em canaltabarato.com.br. Copie o endereço inteiro da")
    print("   barra do navegador (começa com https://canaltabarato.com.br/?code=TG-).\n")
    retorno = input("Cole aqui o endereço: ").strip()
    codigo = urllib.parse.parse_qs(urllib.parse.urlsplit(retorno).query).get("code", [""])[0]
    if not codigo.startswith("TG-"):
        raise SystemExit("Não encontrei o código (code=TG-...) no endereço colado.")

    status, tokens = _requisicao(f"{API}/oauth/token", {
        "grant_type": "authorization_code", "client_id": app_id,
        "client_secret": segredo, "code": codigo, "redirect_uri": REDIRECT_URI,
        "code_verifier": verificador,
    })
    if status != 200 or not tokens.get("refresh_token"):
        motivo = tokens.get("message") or tokens.get("error") or status
        raise SystemExit(f"O Mercado Livre recusou a autorização: {motivo}. "
                         "Confira a URI de redirect e se o escopo offline_access está marcado.")

    _, usuario = _requisicao(f"{API}/users/me", token=tokens["access_token"])
    print(f"\n✅ Autorizado na conta: {usuario.get('nickname', '?')}")
    status_teste, mais_vendidos = _requisicao(
        f"{API}/highlights/MLB/category/{CATEGORIA_TESTE}", token=tokens["access_token"])
    if status_teste == 200:
        print(f"✅ Mais vendidos acessíveis ({len(mais_vendidos.get('content') or [])} itens no teste).")
    else:
        print(f"⚠️  Mais vendidos responderam {status_teste}; vou investigar pelo bot.")

    _gravar_secret("MERCADOLIVRE_CLIENT_ID", app_id)
    _gravar_secret("MERCADOLIVRE_CLIENT_SECRET", segredo)
    _gravar_secret("MERCADOLIVRE_REFRESH_TOKEN", tokens["refresh_token"])
    print("✅ Acesso gravado nos secrets do GitHub. Pode fechar o terminal.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
