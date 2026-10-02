"""Controles pequenos de captação sem aumentar a quantidade de consultas."""
import time

import requests


def termo_da_rodada(fixo=None, opcoes=(), agora=None):
    """Alterna termos opcionais em blocos de seis horas; sem lista, mantém o atual."""
    opcoes = tuple(termo.strip() for termo in opcoes if termo and termo.strip())
    if not opcoes:
        return fixo
    instante = time.time() if agora is None else agora
    return opcoes[int(instante // (6 * 3600)) % len(opcoes)]


def buscar_pagina_com_retry(buscar, *args):
    """Repete uma única vez falhas transitórias de leitura, nunca erros de pedido."""
    try:
        return buscar(*args)
    except (requests.Timeout, requests.ConnectionError):
        time.sleep(1)
        return buscar(*args)
    except requests.HTTPError as erro:
        status = getattr(erro.response, "status_code", None)
        if status != 429 and (status is None or status < 500):
            raise
        time.sleep(1)
        return buscar(*args)
