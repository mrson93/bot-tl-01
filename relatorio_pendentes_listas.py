"""Lista produtos das vitrines ainda não publicados pelo bot.

Uso no GitHub Actions após restaurar o estado remoto: este comando só lê dados.
"""
from pathlib import Path
import sqlite3

import amazon
import mercadolivre


FONTES = (mercadolivre, amazon)


def ids_postados():
    banco = Path(__file__).with_name("postadas.db")
    with sqlite3.connect(f"file:{banco}?mode=ro", uri=True) as conexao:
        return {linha[0] for linha in conexao.execute("SELECT id FROM postadas")}


def pendentes_da_fonte(fonte, publicados):
    ofertas = fonte.buscar_ofertas()
    pendentes = [oferta for oferta in ofertas
                 if oferta["oferta_id"] not in publicados]
    pendentes.sort(key=lambda oferta: (
        -float(oferta.get("priceDiscountRate") or 0),
        str(oferta.get("productName") or "").casefold(),
    ))
    return len(ofertas), pendentes


def main():
    if Path(".estado-sem-remoto").exists():
        raise RuntimeError("Histórico remoto ausente; não é seguro calcular pendentes")
    publicados = ids_postados()
    falhas = []
    for fonte in FONTES:
        try:
            total, pendentes = pendentes_da_fonte(fonte, publicados)
        except Exception as erro:
            print(f"{fonte.NOME}: consulta indisponível ({type(erro).__name__}: {erro})")
            falhas.append(fonte.NOME)
            continue
        print(f"{fonte.NOME}: {len(pendentes)} ainda não publicados de {total} na lista")
        for oferta in pendentes:
            desconto = float(oferta.get("priceDiscountRate") or 0)
            print(f"- {oferta['oferta_id']} | {oferta['productName']} | "
                  f"R$ {float(oferta['price']):.2f} | {desconto:g}%")
    if falhas:
        raise RuntimeError("Não foi possível conferir: " + ", ".join(falhas))


if __name__ == "__main__":
    main()
