"""Pequenas barreiras de seguranca usadas nas integracoes externas."""
import ipaddress
import re
import socket
from urllib.parse import urlsplit

import config


_TOKEN_TELEGRAM = re.compile(
    r"(api\.telegram\.org/bot)[^/\s]+", re.IGNORECASE
)


def validar_url_https_publica(valor, nome="URL", resolver=False) -> str:
    """Aceita apenas HTTPS sem credenciais e sem IP local/privado."""
    texto = str(valor or "").strip()
    if not texto or any(ord(caractere) < 33 for caractere in texto):
        raise ValueError(f"{nome} invalida ou insegura")
    try:
        partes = urlsplit(texto)
        _ = partes.port  # tambem detecta portas malformadas
    except ValueError as erro:
        raise ValueError(f"{nome} invalida ou insegura") from erro
    if partes.scheme.lower() != "https" or not partes.hostname:
        raise ValueError(f"{nome} invalida ou insegura")
    if partes.username or partes.password:
        raise ValueError(f"{nome} invalida ou insegura")

    host = partes.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost"):
        raise ValueError(f"{nome} invalida ou insegura")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if resolver:
            try:
                enderecos = socket.getaddrinfo(
                    host, partes.port or 443, type=socket.SOCK_STREAM
                )
            except socket.gaierror as erro:
                raise ValueError(f"{nome} invalida ou insegura") from erro
            if not enderecos:
                raise ValueError(f"{nome} invalida ou insegura")
            for endereco in enderecos:
                try:
                    ip_resolvido = ipaddress.ip_address(endereco[4][0])
                except ValueError as erro:
                    raise ValueError(f"{nome} invalida ou insegura") from erro
                if not ip_resolvido.is_global:
                    raise ValueError(f"{nome} invalida ou insegura")
    else:
        if not ip.is_global:
            raise ValueError(f"{nome} invalida ou insegura")
    return texto


def validar_url_https_em_hosts(valor, hosts, nome="URL") -> str:
    """Restringe uma URL pública aos domínios explicitamente permitidos."""
    texto = validar_url_https_publica(valor, nome)
    host = (urlsplit(texto).hostname or "").rstrip(".").lower()
    permitidos = tuple(str(item).rstrip(".").lower() for item in hosts if item)
    if not permitidos or not any(host == item or host.endswith(f".{item}")
                                 for item in permitidos):
        raise ValueError(f"{nome} invalida ou insegura")
    return texto


def validar_origem_https_publica(valor, nome="URL") -> str:
    """Valida uma origem base, sem caminho, consulta ou fragmento."""
    texto = validar_url_https_publica(valor, nome)
    partes = urlsplit(texto)
    if partes.path not in ("", "/") or partes.query or partes.fragment:
        raise ValueError(f"{nome} invalida ou insegura")
    return f"https://{partes.netloc}"


def redigir_segredos(valor) -> str:
    """Remove credenciais de mensagens antes de imprimir ou salvar no banco."""
    texto = str(valor)
    nomes = (
        "TELEGRAM_BOT_TOKEN",
        "BLUESKY_APP_PASSWORD",
        "FACEBOOK_PAGE_ACCESS_TOKEN",
        "SHOPEE_SECRET",
        "ALIEXPRESS_APP_SECRET",
        "AMAZON_CREDENTIAL_ID",
        "AMAZON_CREDENTIAL_SECRET",
        "SITE_API_TOKEN",
    )
    for nome in nomes:
        segredo = getattr(config, nome, "")
        if segredo and len(segredo) >= 4:
            texto = texto.replace(segredo, "[SEGREDO]")
    return _TOKEN_TELEGRAM.sub(r"\1[SEGREDO]", texto)
