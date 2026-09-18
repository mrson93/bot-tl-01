"""Janelas locais e cotas de publicação por turno (horário de Brasília)."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

_FUSO = ZoneInfo("America/Sao_Paulo")

# Manhã < tarde < noite. O Facebook fica abaixo do teto do Buffer (35/24 h)
# e o X abaixo do teto de contas não verificadas (50/24 h).
COTAS = {
    "Ofertas": {"manha": 10, "tarde": 20, "noite": 30},
    "Facebook": {"manha": 5, "tarde": 10, "noite": 15},
    "X": {"manha": 8, "tarde": 15, "noite": 22},
    "Instagram Stories": {"manha": 8, "tarde": 15, "noite": 22},
}


def janela(agora=None):
    atual = agora or datetime.now(_FUSO)
    atual = atual.replace(tzinfo=_FUSO) if atual.tzinfo is None else atual.astimezone(_FUSO)
    data = atual.date()
    if atual.hour < 1:
        data -= timedelta(days=1)
        turno = "noite"
    elif atual.hour < 12:
        turno = "manha"
    elif atual.hour < 18:
        turno = "tarde"
    else:
        turno = "noite"
    if turno == "manha":
        inicio = datetime.combine(data, time(6), _FUSO)
        fim = datetime.combine(data, time(12), _FUSO)
    elif turno == "tarde":
        inicio = datetime.combine(data, time(12), _FUSO)
        fim = datetime.combine(data, time(18), _FUSO)
    else:
        inicio = datetime.combine(data, time(18), _FUSO)
        fim = datetime.combine(data + timedelta(days=1), time(1), _FUSO)
    return turno, int(inicio.timestamp()), int(fim.timestamp())
