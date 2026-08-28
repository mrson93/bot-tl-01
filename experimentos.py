"""Atribuição determinística de variantes, sem dados pessoais."""
import hashlib

import config


def atribuir(oferta: dict) -> str:
    if not config.AB_TEST_ATIVO:
        return "controle"
    identidade = f"{config.AB_TEST_NOME}:{oferta.get('oferta_id') or ''}"
    digest = hashlib.sha256(identidade.encode("utf-8")).digest()
    return "A" if digest[0] % 2 == 0 else "B"


def aplicar(oferta: dict) -> dict:
    oferta["experimento"] = config.AB_TEST_NOME
    oferta["variante"] = oferta.get("variante") or atribuir(oferta)
    return oferta


def usa_chamada_humana(oferta: dict) -> bool:
    return not config.AB_TEST_ATIVO or oferta.get("variante") != "B"
