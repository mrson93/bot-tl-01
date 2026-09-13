"""Monitor externo do workflow e emissor mínimo de alertas privados."""
import argparse
import os
from datetime import datetime, timezone

import requests

import config
import seguranca
import store


def _repositorio_valido(repositorio):
    return (repositorio.count("/") == 1 and all(
        parte and parte.replace("-", "").replace("_", "").replace(".", "").isalnum()
        for parte in repositorio.split("/")
    ))


def enviar_alerta(mensagem, sessao=requests):
    if not config.TELEGRAM_ADMIN_ID or not config.TELEGRAM_BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    resposta = sessao.post(url, json={"chat_id": config.TELEGRAM_ADMIN_ID,
        "text": f"🚨 Alerta do bot\n{mensagem}"}, timeout=30)
    corpo = resposta.json()
    if not corpo.get("ok"):
        raise RuntimeError(seguranca.redigir_segredos(
            f"Telegram recusou o alerta: {corpo}"
        ))
    return True


def registrar_resultado_canal(canal, sucesso, erro=""):
    """Alerta uma vez por sequência de falhas e rearma após a recuperação."""
    if sucesso:
        store.limpar_alerta_falha_canal(canal)
        return False

    falhas = store.falhas_consecutivas(canal)
    limite = max(1, config.FALHAS_CONSECUTIVAS_ALERTA)
    if falhas < limite or store.falha_canal_ja_alertada(canal):
        return False

    detalhe = seguranca.redigir_segredos(erro)[:350]
    mensagem = f"{canal}: {falhas} publicações consecutivas falharam."
    if detalhe:
        mensagem += f" Último erro: {detalhe}"
    if enviar_alerta(mensagem):
        store.marcar_falha_canal_alertada(canal)
        return True
    return False


def verificar_execucoes(agora=None, sessao=requests, limite_minutos=20):
    agora = agora or datetime.now(timezone.utc)
    repositorio = os.getenv("GITHUB_REPOSITORY", "")
    token = os.getenv("GH_TOKEN", "")
    if not repositorio or not token:
        raise RuntimeError("Monitor sem acesso ao GitHub")
    if not _repositorio_valido(repositorio):
        raise RuntimeError("GITHUB_REPOSITORY invalido")
    url = (f"https://api.github.com/repos/{repositorio}/actions/workflows/"
           "bot.yml/runs")
    resposta = sessao.get(url, headers={"Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"}, params={"per_page": 5},
        timeout=30, allow_redirects=False)
    resposta.raise_for_status()
    execucoes = [run for run in (resposta.json().get("workflow_runs") or [])
                 if run.get("conclusion") != "skipped"]
    if not execucoes:
        return "Nenhuma execucao do workflow do bot foi encontrada."
    ultima = execucoes[0]
    criada = datetime.fromisoformat(str(ultima["created_at"]).replace("Z", "+00:00"))
    atraso = (agora - criada).total_seconds() / 60
    if atraso > limite_minutos:
        return f"Nenhuma execucao nova ha {int(atraso)} minutos."
    if ultima.get("status") == "completed" and ultima.get("conclusion") != "success":
        return f"A ultima execucao terminou como {ultima.get('conclusion')}."
    return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow-failure", action="store_true")
    args = parser.parse_args()
    if args.workflow_failure:
        run = os.getenv("GITHUB_RUN_ID", "desconhecida")
        enviar_alerta(f"A execucao {run} falhou antes de concluir.")
        return
    alerta = verificar_execucoes()
    if alerta:
        enviar_alerta(alerta)
        print(alerta)
    else:
        print("✅ Workflow do bot executando normalmente.")


if __name__ == "__main__":
    main()
