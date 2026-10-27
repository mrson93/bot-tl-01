"""Testes automatizados do bot de ofertas."""
import atexit
import tempfile
from pathlib import Path

import estado_remoto
import store

# Nenhum teste grava no postadas.db de verdade: todos usam um banco descartável,
# e quem precisa de um banco limpo continua trocando store._DB no próprio teste.
_PASTA = tempfile.TemporaryDirectory(prefix="tabarato-testes-")
atexit.register(_PASTA.cleanup)
store._DB = Path(_PASTA.name) / "postadas.db"
estado_remoto.DB = store._DB
estado_remoto.DB_CRIPTOGRAFADO = Path(_PASTA.name) / "postadas.db.enc"
