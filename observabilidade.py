"""Eventos operacionais seguros, pesquisáveis e persistentes."""
import json
import os
import uuid

import store

_EXECUCAO_ID = (os.getenv("GITHUB_RUN_ID") or f"local-{uuid.uuid4().hex[:8]}")[:64]


def evento(tipo, *, oferta_id=None, canal=None, fonte=None, motivo=None,
           quantidade=1):
    """Registra apenas códigos e contagens; nunca URLs ou respostas remotas."""
    dados = {
        "evento": str(tipo)[:48], "execucao_id": _EXECUCAO_ID,
        "quantidade": max(0, int(quantidade or 0)),
    }
    for chave, valor, limite in (
        ("oferta_id", oferta_id, 100), ("canal", canal, 30),
        ("fonte", fonte, 30), ("motivo", motivo, 64),
    ):
        if valor not in (None, ""):
            dados[chave] = str(valor)[:limite]
    print("EVENTO " + json.dumps(dados, ensure_ascii=False, sort_keys=True))
    try:
        store.registrar_evento(
            dados["evento"], _EXECUCAO_ID, dados["quantidade"],
            dados.get("oferta_id"), dados.get("canal"), dados.get("fonte"),
            dados.get("motivo"),
        )
    except Exception:
        # Observabilidade nunca pode interromper as publicações.
        print('EVENTO {"evento":"falha_registro_observabilidade"}')

