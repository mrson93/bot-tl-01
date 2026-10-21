"""Configura o bot público de alertas depois de criado no @BotFather.

Uso (uma vez):  python3 scripts/configurar_bot_alertas.py

O token é pedido sem aparecer na tela e não é salvo em arquivo. O script
valida o bot, define comandos e descrição, gera o segredo do webhook e aponta
o webhook para o site. No fim mostra o que cadastrar no Cloudflare Pages.
"""
import getpass
import json
import re
import secrets
import sys
import urllib.error
import urllib.request

WEBHOOK_URL = "https://canaltabarato.com.br/api/telegram-alerts"

COMANDOS = [
    {"command": "start", "description": "Como funcionam os alertas"},
    {"command": "meusalertas", "description": "Ver meus alertas"},
    {"command": "remover", "description": "Remover um alerta: /remover air fryer"},
    {"command": "parar", "description": "Apagar todos os meus dados"},
    {"command": "ajuda", "description": "Ajuda"},
]
DESCRICAO = (
    "Diga o produto que você procura (ex.: air fryer, fone bluetooth) e eu aviso "
    "quando aparecer oferta dele no Tá Barato. Até 5 alertas, no máximo 6 avisos "
    "por dia. /parar apaga seus dados."
)
DESCRICAO_CURTA = "Alertas de ofertas por palavra-chave do Canal Tá Barato."


def chamar(token, metodo, dados=None):
    corpo = json.dumps(dados or {}).encode("utf-8")
    pedido = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{metodo}", data=corpo,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            resultado = json.load(resposta)
    except urllib.error.HTTPError as erro:
        resultado = json.load(erro)
    if not resultado.get("ok"):
        raise SystemExit(f"Telegram recusou {metodo}: {resultado.get('description')}")
    return resultado.get("result")


def main():
    print("Cole o token e aperte Enter. Nada vai aparecer enquanto você cola: é normal.")
    bruto = getpass.getpass("Token do bot de ALERTAS: ")
    # Alguns terminais incluem marcas invisíveis de "colar"; pegamos só o token.
    achado = re.search(r"\d{5,15}:[A-Za-z0-9_-]{30,}", bruto)
    if not bruto.strip():
        raise SystemExit("Nada foi colado. Rode de novo, cole o token e só então aperte Enter.")
    if not achado:
        raise SystemExit("Isso não parece um token do @BotFather (formato 123456:ABC...).")
    token = achado.group(0)
    bot = chamar(token, "getMe")
    usuario = bot.get("username") or ""
    print(f"✅ Bot encontrado: @{usuario}")
    resposta = input("Este é o bot NOVO de alertas (não o do painel)? [s/N] ").strip().lower()
    if resposta not in {"s", "sim"}:
        raise SystemExit("Cancelado. Use o token do bot criado só para alertas.")

    chamar(token, "setMyCommands", {"commands": COMANDOS})
    chamar(token, "setMyDescription", {"description": DESCRICAO})
    chamar(token, "setMyShortDescription", {"short_description": DESCRICAO_CURTA})

    segredo = secrets.token_urlsafe(32)
    chamar(token, "setWebhook", {
        "url": WEBHOOK_URL, "secret_token": segredo,
        "allowed_updates": ["message"], "drop_pending_updates": True,
    })
    print("✅ Comandos, descrição e webhook configurados.\n")
    print("Agora, no Cloudflare: Workers & Pages → canaltabarato → Settings →")
    print("Variables and Secrets (ambiente Production). Cadastre:\n")
    print("  TELEGRAM_ALERTS_BOT_TOKEN      (Secret)  → o mesmo token que você colou")
    print(f"  TELEGRAM_ALERTS_WEBHOOK_SECRET (Secret)  → {segredo}")
    print(f"  TELEGRAM_ALERTS_BOT_USERNAME   (Text)    → {usuario}\n")
    print("Depois faça um novo deploy do site (Deployments → Retry deployment)")
    print(f"e mande /start para @{usuario}. Mensagens enviadas antes disso o")
    print("Telegram tenta entregar de novo sozinho.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
