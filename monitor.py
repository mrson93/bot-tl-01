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
    return _enviar_privado(f"🚨 Alerta do bot\n{mensagem}", sessao)


def _enviar_privado(mensagem, sessao=requests):
    if not config.TELEGRAM_ADMIN_ID or not config.TELEGRAM_BOT_TOKEN:
        return False
    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    resposta = sessao.post(url, json={"chat_id": config.TELEGRAM_ADMIN_ID,
        "text": mensagem}, timeout=30)
    corpo = resposta.json()
    if not corpo.get("ok"):
        raise RuntimeError(seguranca.redigir_segredos(
            f"Telegram recusou o alerta: {corpo}"
        ))
    return True


def enviar_mensagem_privada(mensagem, sessao=requests):
    """Envia uma atualização administrativa sem o prefixo de alerta."""
    return _enviar_privado(str(mensagem), sessao)


def enviar_resumo_publicacao(loja, titulo, resultados, sessao=requests):
    """Um aviso privado por oferta, com confirmação por destino."""
    titulo = " ".join(str(titulo or "Oferta").split())[:100]
    linhas = [f"📣 Publicação — {loja}", titulo, ""]
    linhas.extend(f"{canal}: {resultado}" for canal, resultado in resultados.items())
    return _enviar_privado("\n".join(linhas), sessao)


def avisar_estoque_lista(loja, ineditas, sessao=requests):
    """Notifica uma vez quando a lista curada fica com até cinco inéditas."""
    chave = f"estoque_lista:{loja.lower().replace(' ', '_')}"
    if ineditas > 5:
        store._definir_estado(chave, "normal")
        return False
    if store._estado(chave) == "baixo":
        return False
    mensagem = (f"📦 Lista {loja}: restam {ineditas} ofertas inéditas e elegíveis. "
                "Adicione novos produtos à lista para manter a publicação.")
    if _enviar_privado(mensagem, sessao):
        store._definir_estado(chave, "baixo")
        return True
    return False


def avisar_falha_lista(loja, erro, sessao=requests):
    """Avisa só após falhas seguidas; rearma após uma leitura bem-sucedida."""
    chave = f"falha_lista:{loja.lower().replace(' ', '_')}"
    estado = store._estado(chave)
    if estado == "alertada":
        return False
    try:
        falhas = int(estado or 0) + 1
    except ValueError:
        falhas = 1
    store._definir_estado(chave, falhas)
    limite = max(1, config.FALHAS_CONSECUTIVAS_ALERTA)
    if falhas < limite:
        return False
    detalhe = seguranca.redigir_segredos(erro)[:200]
    if _enviar_privado(f"⚠️ A lista da {loja} falhou em {falhas} rodadas "
                      "consecutivas. Nenhuma oferta dessa loja será publicada "
                      f"nesta rodada. {detalhe}", sessao):
        store._definir_estado(chave, "alertada")
        return True
    return False


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


def mensagem_falha_workflow(run, publicacao_resultado="", estado_resultado=""):
    """Distingue falha de publicação de erro técnico posterior à postagem."""
    if publicacao_resultado == "success":
        if estado_resultado == "failure":
            return (f"A execucao {run} publicou a oferta, mas falhou ao salvar "
                    "o estado. Nao execute a rodada novamente para evitar duplicacao.")
        return (f"A execucao {run} publicou a oferta, mas encontrou uma falha "
                "tecnica ao finalizar. Nao execute a rodada novamente.")
    return f"A execucao {run} falhou durante a publicacao."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow-failure", action="store_true")
    args = parser.parse_args()
    if args.workflow_failure:
        run = os.getenv("GITHUB_RUN_ID", "desconhecida")
        enviar_alerta(mensagem_falha_workflow(
            run,
            os.getenv("PUBLICACAO_RESULTADO", ""),
            os.getenv("ESTADO_RESULTADO", ""),
        ))
        return
    alerta = verificar_execucoes()
    if alerta:
        enviar_alerta(alerta)
        print(alerta)
    else:
        print("✅ Workflow do bot executando normalmente.")


if __name__ == "__main__":
    main()
