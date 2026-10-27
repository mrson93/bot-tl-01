"""Resumo diário privado e opcional do funcionamento do bot."""
from datetime import datetime, timedelta

import requests

import aliexpress
import config
import seguranca
import shopee
import shortlinks
import site_publisher
import store
import desempenho


def _numero(valor):
    return f"{float(valor):.2f}".replace(".", ",")


def _top(contadores, limite=3):
    return sorted((contadores or {}).items(), key=lambda item: (-item[1], item[0]))[:limite]


def _resumo_editorial(cliques, limite=3):
    editorial=(cliques or {}).get("editorial") or {}
    visitas=int(editorial.get("visitas") or 0)
    quantidade=int(editorial.get("cliques") or 0)
    if not visitas and not quantidade:
        return []
    taxa=100*quantidade/visitas if visitas else 0
    linhas=[f"Blog: {quantidade} cliques em {visitas} exposicoes ({_numero(taxa)}%)"]
    materias=sorted((editorial.get("por_materia") or {}).items(),
                    key=lambda item:(-int(item[1].get("cliques") or 0),item[0]))[:limite]
    materias=[(slug,dados) for slug,dados in materias if int(dados.get("cliques") or 0)>0]
    if materias:
        linhas.append("Materias do blog mais clicadas: " + "; ".join(
            f"{slug.replace('-', ' ')} ({dados.get('cliques',0)})" for slug,dados in materias
        ))
    produtos=sorted((editorial.get("por_produto") or {}).values(),
                    key=lambda item:(-int(item.get("cliques") or 0),item.get("product_name","")))[:limite]
    produtos=[item for item in produtos if int(item.get("cliques") or 0)>0]
    if produtos:
        linhas.append("Modelos do blog mais clicados: " + "; ".join(
            f"{str(item.get('product_name') or 'Produto')[:40]} ({item.get('cliques',0)})"
            for item in produtos
        ))
    return linhas


def _somar_cliques(resumos):
    total = {"total": 0, "visitas": 0, "por_canal": {}, "por_fonte": {},
             "por_fonte_canal": {}, "por_oferta": {}, "por_origem": {},
             "editorial": {"visitas": 0, "cliques": 0, "por_materia": {},
                           "por_produto": {}, "por_loja": {}, "por_origem": {}}}
    for resumo in resumos:
        total["total"] += int(resumo.get("total") or 0)
        total["visitas"] += int(resumo.get("visitas") or 0)
        for campo in ("por_canal", "por_fonte", "por_oferta", "por_origem"):
            for chave, valor in (resumo.get(campo) or {}).items():
                total[campo][chave] = total[campo].get(chave, 0) + int(valor or 0)
        for fonte, canais in (resumo.get("por_fonte_canal") or {}).items():
            destino = total["por_fonte_canal"].setdefault(fonte, {})
            for canal, quantidade in canais.items():
                destino[canal] = destino.get(canal, 0) + int(quantidade or 0)
        editorial=total["editorial"]
        for campo in ("visitas", "cliques"):
            editorial[campo]+=int((resumo.get("editorial") or {}).get(campo) or 0)
        for campo in ("por_materia", "por_produto", "por_loja", "por_origem"):
            for chave,metricas in ((resumo.get("editorial") or {}).get(campo) or {}).items():
                destino=editorial[campo].setdefault(chave,{"visitas":0,"cliques":0})
                for tipo in ("visitas","cliques"):
                    destino[tipo]+=int(metricas.get(tipo) or 0)
                if metricas.get("product_name"):
                    destino["product_name"]=metricas["product_name"]
    return total


LOJAS = ("Amazon", "Mercado Livre", "Shopee", "AliExpress")


def _cliques_marketplaces(resumo):
    """Resume cliques por loja e os canais conhecidos.

    Amazon e Mercado Livre aparecem sempre: não têm vendas no relatório, então
    o clique é o único sinal delas. Shopee e AliExpress só quando houve clique.
    """
    if not resumo:
        return []
    linhas = []
    por_fonte = resumo.get("por_fonte") or {}
    por_fonte_canal = resumo.get("por_fonte_canal") or {}
    for fonte in LOJAS:
        quantidade = int(por_fonte.get(fonte) or 0)
        if not quantidade and fonte in ("Shopee", "AliExpress"):
            continue
        canais = por_fonte_canal.get(fonte) or {}
        detalhe = " · ".join(
            f"{canal} {qtd}" for canal, qtd in sorted(canais.items()) if qtd
        )
        linhas.append(f"{fonte}: {quantidade}" + (f" ({detalhe})" if detalhe else ""))
    return linhas


def _eficiencia_lojas(cliques, posts):
    """Compara, por loja, cliques por post e fatia dos cliques com a meta."""
    if not cliques or not posts:
        return []
    por_fonte = cliques.get("por_fonte") or {}
    lojas = [f for f in LOJAS if posts.get(f) or por_fonte.get(f)]
    total_cliques = sum(int(por_fonte.get(f) or 0) for f in lojas)
    soma_metas = sum(config.percentual_loja(f) for f in lojas)
    if not lojas or not total_cliques:
        return []
    linhas = []
    for fonte in lojas:
        qtd_posts = int(posts.get(fonte) or 0)
        qtd_cliques = int(por_fonte.get(fonte) or 0)
        por_post = _numero(qtd_cliques / qtd_posts) if qtd_posts else "-"
        fatia = 100 * qtd_cliques / total_cliques
        meta = 100 * config.percentual_loja(fonte) / soma_metas if soma_metas else 0
        linhas.append(f"{fonte}: {qtd_posts} posts · {qtd_cliques} cliques · "
                      f"{por_post}/post · {fatia:.0f}% dos cliques (meta {meta:.0f}%)")
    return linhas


def _detalhes(blocos, conversoes):
    produtos = conversoes.get("produtos") or []
    if produtos:
        blocos.append("Produtos: " + "; ".join(
            f"{str(p.get('nome') or 'Produto')[:45]} ({p.get('quantidade', 0)})"
            for p in produtos[:3]
        ))
    rotulos = (
        ("Melhores horarios", "por_hora"),
        ("Categorias", "por_categoria"),
        ("Faixas de preco", "por_faixa_preco"),
        ("Faixas de desconto", "por_faixa_desconto"),
    )
    for rotulo, chave in rotulos:
        itens = _top(conversoes.get(chave))
        if itens:
            blocos.append(rotulo + ": " + ", ".join(
                f"{nome} {qtd}" for nome, qtd in itens
            ))


def _enriquecer_com_historico(conversoes):
    produtos = conversoes.get("produtos") or []
    metadados = store.metadados_ofertas(p.get("oferta_id") for p in produtos)
    if not conversoes.get("por_faixa_preco"):
        for produto in produtos:
            meta = metadados.get(produto.get("oferta_id"), {})
            if meta.get("preco") is not None:
                desempenho.somar(conversoes["por_faixa_preco"],
                                  desempenho.faixa_preco(meta["preco"]),
                                  produto.get("quantidade", 1))
    if not conversoes.get("por_faixa_desconto"):
        for produto in produtos:
            meta = metadados.get(produto.get("oferta_id"), {})
            if meta.get("desconto") is not None:
                desempenho.somar(conversoes["por_faixa_desconto"],
                                  desempenho.faixa_desconto(meta["desconto"]),
                                  produto.get("quantidade", 1))


def _texto_detalhado(linhas, data, conversoes=None, conversoes_shopee=None,
           alertas=None, sem_conversao=None, cliques=None, tendencias=None,
           testes_ab=None):
    sucessos = sum(qtd for _, ok, _, qtd in linhas if ok)
    falhas = sum(qtd for _, ok, _, qtd in linhas if not ok)
    por_loja = {}
    por_canal = {}
    for canal, ok, fonte, qtd in linhas:
        if ok:
            por_loja[fonte or "Desconhecida"] = por_loja.get(fonte or "Desconhecida", 0) + qtd
            por_canal[canal] = por_canal.get(canal, 0) + qtd
    blocos = [f"📊 Resumo do bot — {data}", f"✅ Entregas: {sucessos}", f"⚠️ Falhas: {falhas}"]
    if por_canal:
        blocos.append("Canais: " + ", ".join(f"{k} {v}" for k, v in sorted(por_canal.items())))
    if por_loja:
        blocos.append("Lojas: " + ", ".join(f"{k} {v}" for k, v in sorted(por_loja.items())))
    blocos.append("")
    if conversoes is None:
        blocos.append("Conversoes AliExpress: indisponiveis")
    else:
        blocos.append("AliExpress (ultimos 7 dias)")
        blocos.append(
            f"Pagos: {conversoes['pagos']} | "
            f"Confirmados: {conversoes['confirmados']} | "
            f"Invalidos: {conversoes['invalidos']}")
        if conversoes["por_tracking"]:
            blocos.append("Tracking: " + ", ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(conversoes["por_tracking"].items())))
        if conversoes["comissoes"]:
            blocos.append("Comissao: " + ", ".join(
                f"{moeda} {_numero(valor)}"
                for moeda, valor in sorted(conversoes["comissoes"].items())))
        for canal, moedas in sorted(
                conversoes.get("comissoes_por_tracking", {}).items()):
            blocos.append(f"Comissao {canal}: " + ", ".join(
                f"{moeda} {_numero(valor)}" for moeda, valor in sorted(moedas.items())
            ))
        _detalhes(blocos, conversoes)
    blocos.append("")
    if conversoes_shopee is None:
        blocos.append("Conversoes Shopee: indisponiveis")
    else:
        blocos.append("Shopee (ultimos 7 dias)")
        blocos.append(
            f"Pendentes: {conversoes_shopee['pendentes']} | "
            f"Concluidas: {conversoes_shopee['concluidas']} | "
            f"Canceladas: {conversoes_shopee['canceladas']}")
        if conversoes_shopee.get("outros"):
            blocos.append(f"Outros status: {conversoes_shopee['outros']}")
        if conversoes_shopee["por_tracking"]:
            blocos.append("Tracking: " + ", ".join(
                f"{nome} {qtd}"
                for nome, qtd in sorted(conversoes_shopee["por_tracking"].items())))
        blocos.append(
            f"Comissao estimada: BRL {_numero(conversoes_shopee['comissao_estimada'])} | "
            f"liquida: BRL {_numero(conversoes_shopee['comissao_liquida'])}")
        if conversoes_shopee.get("comissao_por_tracking"):
            blocos.append("Comissao por canal: " + ", ".join(
                f"{canal} BRL {_numero(valor)}" for canal, valor in
                sorted(conversoes_shopee["comissao_por_tracking"].items())
            ))
        _detalhes(blocos, conversoes_shopee)
    blocos.append("")
    if cliques is None:
        blocos.append("Cliques: aguardando link proprio aprovado e ativado")
    else:
        blocos.append(f"Cliques (ultimos 7 dias): {cliques['total']}")
        if cliques["por_canal"]:
            blocos.append("Cliques por canal: " + ", ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(cliques["por_canal"].items())
            ))
        if cliques.get("por_origem"):
            blocos.append("Visitas por origem: " + ", ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(cliques["por_origem"].items())
            ))
        if cliques.get("por_produto"):
            blocos.append("Produtos mais clicados: " + "; ".join(
                f"{str(nome)[:45]} ({qtd})"
                for nome, qtd in _top(cliques["por_produto"])
            ))
        if cliques.get("somente_cliques"):
            blocos.append("Com cliques e sem conversao: " + "; ".join(
                f"{str(nome)[:45]} ({qtd})"
                for nome, qtd in cliques["somente_cliques"][:3]
            ))
        blocos.extend(_resumo_editorial(cliques))
    if alertas:
        blocos.append("")
        blocos.append("Alertas")
        blocos.extend(f"⚠️ {alerta}" for alerta in alertas)
    if sem_conversao:
        blocos.append("Sem conversao identificada: " + "; ".join(
            f"{fonte} — {str(titulo)[:45]}" for _, fonte, titulo in sem_conversao
        ))
    if tendencias:
        blocos.append("")
        blocos.append("Tendencia semanal")
        for fonte, periodos in sorted(tendencias.items()):
            atual, anterior = periodos.get("atual", {}), periodos.get("anterior", {})
            if not atual.get("dias"):
                continue
            taxa = (100 * atual.get("conversoes", 0) / atual.get("posts", 1)
                    if atual.get("posts") else 0)
            texto = (f"{fonte}: {atual.get('posts', 0)} posts, "
                     f"{atual.get('conversoes', 0)} conversoes, taxa {taxa:.1f}%")
            if anterior.get("dias"):
                texto += f" | semana anterior: {anterior.get('conversoes', 0)} conversoes"
            blocos.append(texto)
    testes_validos = [t for t in (testes_ab or []) if t.get("posts", 0) >= 10]
    if testes_validos:
        blocos.append("")
        blocos.append("Teste A/B (30 dias)")
        blocos.extend(
            f"{t['variante']}: {t['posts']} posts, {t['conversoes']} conversoes, "
            f"comissao {_numero(t['comissao'])}"
            for t in sorted(testes_validos, key=lambda item: item["variante"])
        )
    return "\n".join(blocos)


def _valor_moeda(moeda, valor):
    simbolos = {"BRL": "R$", "USD": "US$", "EUR": "€"}
    return f"{simbolos.get(moeda, moeda)} {_numero(valor)}"


def _tracking(resumo):
    itens = resumo.get("por_tracking") or {}
    return " · ".join(f"{nome}: {qtd}" for nome, qtd in sorted(itens.items()))


def _destaques(resumo, fonte):
    """Só os sinais úteis para decidir o que publicar a seguir."""
    if not resumo:
        return []
    linhas = []
    produtos = resumo.get("produtos") or []
    if produtos:
        linhas.append("Produtos: " + "; ".join(
            f"{str(item.get('nome') or 'Produto')[:38]} ({item.get('quantidade', 0)})"
            for item in produtos[:2]
        ))
    for titulo, chave in (("Horários", "por_hora"), ("Categorias", "por_categoria"),
                          ("Preço", "por_faixa_preco"), ("Desconto", "por_faixa_desconto")):
        itens = _top(resumo.get(chave), 2)
        if itens:
            linhas.append(titulo + ": " + ", ".join(f"{nome} {qtd}" for nome, qtd in itens))
    return [f"{fonte} — {linha}" for linha in linhas]


def _vencedora_ab(testes, minimo_posts=30):
    """Indica uma variante só com amostra mínima e vantagem clara de conversão."""
    if len(testes) != 2 or any(t.get("posts", 0) < minimo_posts for t in testes):
        return ""
    taxas = sorted(((t.get("conversoes", 0) / t["posts"], t) for t in testes),
                   key=lambda par: par[0], reverse=True)
    (melhor, vencedor), (pior, perdedor) = taxas
    diferenca = vencedor.get("conversoes", 0) - perdedor.get("conversoes", 0)
    if melhor <= 0 or melhor < pior * 1.5 or diferenca < 5:
        return ""
    return (f"Variante {vencedor['variante']} converte mais "
            f"({100 * melhor:.1f}% vs {100 * pior:.1f}% por post). "
            "Considere mantê-la e encerrar o teste.")


_ROTULOS_FALHA = {"bloqueio": "bloqueio da loja", "pagina_mudou": "página mudou",
                  "conexao": "sem conexão", "erro": "erro"}


def linhas_saude_fontes(saude):
    """Uma linha por loja: rodadas lidas com sucesso e o motivo das falhas."""
    linhas = []
    for fonte, item in sorted((saude or {}).items()):
        falhas = sum(item["falhas"].values())
        total = item["ok"] + falhas
        if not total:
            continue
        icone = "✅" if not falhas else "⚠️" if item["ok"] >= falhas else "❌"
        texto = f"{icone} {fonte}: {item['ok']}/{total} rodadas"
        if falhas:
            texto += " · " + " · ".join(
                f"{_ROTULOS_FALHA.get(motivo, motivo)} {qtd}"
                for motivo, qtd in sorted(item["falhas"].items(), key=lambda par: -par[1]))
        linhas.append(texto)
    return linhas


def alertas_saude_fontes(saude):
    alertas = []
    for fonte, item in sorted((saude or {}).items()):
        falhas = sum(item["falhas"].values())
        total = item["ok"] + falhas
        if total >= 4 and item["ok"] < total / 2:
            principal = max(item["falhas"], key=item["falhas"].get)
            dica = (" — o formato da página mudou e o bot precisa de ajuste"
                    if principal == "pagina_mudou" else "")
            alertas.append(f"{fonte} funcionou em só {item['ok']} de {total} rodadas"
                           f" ({_ROTULOS_FALHA.get(principal, principal)}){dica}")
    return alertas


def _texto(linhas, data, conversoes=None, conversoes_shopee=None,
           alertas=None, sem_conversao=None, cliques=None, tendencias=None,
           testes_ab=None, eventos=None, diario_ali=None, diario_shopee=None,
           cliques_dia=None, saude=None, posts_7d=None):
    """Relatório curto, em blocos estáveis, para leitura rápida no Telegram."""
    sucessos = sum(qtd for _, ok, _, qtd in linhas if ok)
    falhas = sum(qtd for _, ok, _, qtd in linhas if not ok)
    por_loja, por_canal = {}, {}
    for canal, ok, fonte, qtd in linhas:
        if ok:
            por_loja[fonte or "Desconhecida"] = por_loja.get(fonte or "Desconhecida", 0) + qtd
            por_canal[canal] = por_canal.get(canal, 0) + qtd

    vendas_dia = {}
    for fonte, resumo, campos in (
        ("AliExpress", diario_ali, ("pagos", "confirmados")),
        ("Shopee", diario_shopee, ("pendentes", "concluidas")),
    ):
        vendas_dia[fonte] = (sum(int(resumo.get(campo, 0)) for campo in campos)
                             if resumo is not None else None)
    disponiveis = [v for v in vendas_dia.values() if v is not None]
    total_vendas = (str(sum(disponiveis)) if disponiveis else "indisponível")
    if disponiveis and len(disponiveis) < len(vendas_dia):
        total_vendas += " (parcial)"
    total_cliques = str(cliques_dia["total"]) if cliques_dia is not None else "indisponível"
    total_visitas = (str(cliques_dia.get("visitas", 0))
                     if cliques_dia is not None else "indisponível")
    cliques_lojas_dia = _cliques_marketplaces(cliques_dia)
    blocos = [f"📊 RELATÓRIO DIÁRIO · {data}", "━━━━━━━━━━━━━━",
              "📈 RESULTADOS DE ONTEM · 00h–23h59",
              f"👁 Visitas no site: {total_visitas}",
              f"🔗 Cliques: {total_cliques} (saídas para lojas)",
              f"🛒 Vendas: {total_vendas} (Shopee + AliExpress)",
              " · ".join(f"{fonte}: {valor if valor is not None else 'indisponível'}"
                         for fonte, valor in vendas_dia.items()),
              "Amazon e Mercado Livre: vendas não incluídas (painéis sem API de relatório).",
              "Vendas = conversões válidas; inclui pendentes, exclui canceladas.",
              "", "📮 OPERAÇÃO DE ONTEM",
              f"✅ {sucessos} entregas · ⚠️ {falhas} falhas"]
    if cliques_lojas_dia:
        blocos.insert(6, "Cliques por loja: " + " · ".join(cliques_lojas_dia))
        blocos.insert(7, "Mercado Livre: só cliques do site; os das redes ficam no painel de afiliados.")
    if por_canal:
        blocos.append("Canais: " + " · ".join(f"{nome} {qtd}" for nome, qtd in sorted(por_canal.items())))
    if por_loja:
        blocos.append("Lojas: " + " · ".join(f"{nome} {qtd}" for nome, qtd in sorted(por_loja.items())))
    eventos = eventos or {}
    tipos = eventos.get("por_tipo") or {}
    rejeicoes = eventos.get("rejeicoes") or {}
    fallbacks = eventos.get("fallbacks") or {}
    if tipos or rejeicoes or fallbacks:
        blocos.extend(["", "🧭 DIAGNÓSTICO"])
        if tipos.get("ofertas_recebidas") is not None:
            blocos.append(
                f"Ofertas: {tipos.get('ofertas_recebidas', 0)} recebidas · "
                f"{tipos.get('ofertas_elegiveis', 0)} elegíveis · "
                f"{tipos.get('ofertas_rejeitadas', 0)} rejeitadas"
            )
        if rejeicoes:
            blocos.append("Filtros: " + " · ".join(
                f"{motivo.replace('_', ' ')} {qtd}"
                for motivo, qtd in sorted(rejeicoes.items(), key=lambda item: (-item[1], item[0]))[:5]
            ))
        if fallbacks:
            rotulos_fallback = {
                "telegram_foto_para_texto": "Telegram foto→texto",
                "bluesky_imagem_ausente": "Bluesky sem imagem",
                "bluesky_imagem_seguranca": "Bluesky imagem bloqueada",
                "bluesky_imagem_download": "Bluesky falha na imagem",
                "bluesky_imagem_indisponivel": "Bluesky imagem indisponível",
            }
            blocos.append("Alternativas usadas: " + " · ".join(
                f"{rotulos_fallback.get(motivo, motivo.replace('_', ' '))} {qtd}"
                for motivo, qtd in sorted(fallbacks.items())
            ))
        falhas_canal = eventos.get("falhas_por_canal") or {}
        if falhas_canal:
            blocos.append("Falhas: " + " · ".join(
                f"{canal} {qtd}" for canal, qtd in sorted(falhas_canal.items())
            ))

    linhas_saude = linhas_saude_fontes(saude)
    if linhas_saude:
        blocos.extend(["", "🩺 SAÚDE DAS LOJAS · ONTEM"])
        blocos.extend(linhas_saude)

    blocos.extend(["", "💰 RESULTADO · ÚLTIMOS 7 DIAS"])
    if conversoes_shopee:
        blocos.extend([
            "🛍 Shopee",
            f"✅ {conversoes_shopee['concluidas']} concluídas · ⏳ {conversoes_shopee['pendentes']} pendentes · ❌ {conversoes_shopee['canceladas']} canceladas",
            f"Comissão: R$ {_numero(conversoes_shopee['comissao_estimada'])} estimada · R$ {_numero(conversoes_shopee['comissao_liquida'])} líquida",
        ])
        tracking = _tracking(conversoes_shopee)
        if tracking:
            blocos.append("Por canal: " + tracking)
        if conversoes_shopee.get("comissao_por_tracking"):
            blocos.append("Comissão por canal: " + " · ".join(
                f"{canal} R$ {_numero(valor)}" for canal, valor in sorted(conversoes_shopee["comissao_por_tracking"].items())
            ))
    if conversoes:
        blocos.extend([
            "🛒 AliExpress",
            f"✅ {conversoes['confirmados']} confirmados · ⏳ {conversoes['pagos']} pagos · ❌ {conversoes['invalidos']} inválidos",
        ])
        if conversoes.get("comissoes"):
            blocos.append("Comissão: " + " · ".join(
                _valor_moeda(moeda, valor) for moeda, valor in sorted(conversoes["comissoes"].items())
            ))
        tracking = _tracking(conversoes)
        if tracking:
            blocos.append("Por canal: " + tracking)
        for canal, moedas in sorted(conversoes.get("comissoes_por_tracking", {}).items()):
            blocos.append(f"Comissão {canal}: " + " · ".join(
                _valor_moeda(moeda, valor) for moeda, valor in sorted(moedas.items())
            ))
    if not conversoes and not conversoes_shopee:
        blocos.append("Dados de conversão indisponíveis hoje.")

    destaques = _destaques(conversoes_shopee, "Shopee") + _destaques(conversoes, "AliExpress")
    if destaques:
        blocos.extend(["", "✨ DESTAQUES"])
        blocos.extend(f"• {item}" for item in destaques[:6])

    if cliques:
        blocos.extend(["", f"🔗 CLIQUES · {cliques['total']} nos últimos 7 dias"])
        cliques_lojas = _cliques_marketplaces(cliques)
        if cliques_lojas:
            blocos.append("Por loja: " + " · ".join(cliques_lojas))
        eficiencia = _eficiencia_lojas(cliques, posts_7d)
        if eficiencia:
            blocos.append("Cliques por post, por loja:")
            blocos.extend(f"• {linha}" for linha in eficiencia)
            if "Mercado Livre" in " ".join(eficiencia):
                blocos.append("(Mercado Livre conta só os cliques do site.)")
        if cliques.get("por_canal"):
            blocos.append("Por canal: " + " · ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(cliques["por_canal"].items())
            ))
        if cliques.get("por_origem"):
            blocos.append("Origem das visitas: " + " · ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(cliques["por_origem"].items())
            ))
        if cliques.get("por_produto"):
            blocos.append("Mais clicados: " + "; ".join(
                f"{str(nome)[:38]} ({qtd})" for nome, qtd in _top(cliques["por_produto"], 2)
            ))
        if cliques.get("somente_cliques"):
            blocos.append("Sem conversão: " + "; ".join(
                f"{str(nome)[:38]} ({qtd})" for nome, qtd in cliques["somente_cliques"][:2]
            ))
        blocos.extend(_resumo_editorial(cliques,2))

    atencao = list(alertas or [])
    if sem_conversao:
        atencao.append("Sem conversão: " + "; ".join(
            f"{fonte} — {str(titulo)[:36]}" for _, fonte, titulo in sem_conversao[:2]
        ))
    if atencao:
        blocos.extend(["", "⚠️ ATENÇÃO"])
        blocos.extend(f"• {item}" for item in atencao[:4])

    linhas_tendencia = []
    for fonte, periodos in sorted((tendencias or {}).items()):
        atual, anterior = periodos.get("atual", {}), periodos.get("anterior", {})
        if not atual.get("dias"):
            continue
        taxa = 100 * atual.get("conversoes", 0) / atual.get("posts", 1) if atual.get("posts") else 0
        texto = f"{fonte}: {atual.get('posts', 0)} posts · {atual.get('conversoes', 0)} conversões · {taxa:.1f}%"
        if anterior.get("dias"):
            texto += f" (antes: {anterior.get('conversoes', 0)})"
        linhas_tendencia.append(texto)
    if linhas_tendencia:
        blocos.extend(["", "📈 TENDÊNCIA SEMANAL"])
        blocos.extend(f"• {item}" for item in linhas_tendencia[:3])

    testes_validos = [item for item in (testes_ab or []) if item.get("posts", 0) >= 10]
    if testes_validos:
        blocos.extend(["", "🧪 TESTE A/B · 30 DIAS"])
        blocos.extend(
            f"• {item['variante']}: {item['posts']} posts · {item['conversoes']} conversões · comissão R$ {_numero(item['comissao'])}"
            for item in sorted(testes_validos, key=lambda item: item["variante"])
        )
        vencedora = _vencedora_ab(testes_validos)
        if vencedora:
            blocos.append(f"➡️ {vencedora}")

    texto = "\n".join(blocos)
    if len(texto) <= 3900:
        return texto
    return texto[:3900].rsplit("\n", 1)[0] + "\n\n… detalhes extras omitidos para caber no Telegram."


def enviar_se_devido(agora=None, forcar=False):
    agora = agora or datetime.now()
    if not config.TELEGRAM_ADMIN_ID or not config.TELEGRAM_BOT_TOKEN:
        return False
    if (not forcar and
            (agora.hour, agora.minute) <
            (config.RELATORIO_HORA, config.RELATORIO_MINUTO)):
        return False
    ontem = (agora - timedelta(days=1)).date()
    chave = ontem.isoformat()
    if not forcar and store.relatorio_enviado(chave):
        return False
    inicio = datetime.combine(ontem, datetime.min.time()).timestamp()
    fim = inicio + 86400
    conversoes = None
    conversoes_shopee = None
    diario_ali = None
    diario_shopee = None
    inicio_7d = agora - timedelta(days=7)
    if aliexpress.esta_configurada():
        try:
            conversoes = aliexpress.resumo_conversoes(inicio_7d, agora)
            _enriquecer_com_historico(conversoes)
            store.salvar_desempenho("AliExpress", conversoes.get("produtos"))
            try:
                diario_ali = aliexpress.resumo_conversoes(
                    datetime.fromtimestamp(inicio), datetime.fromtimestamp(fim)
                )
            except Exception as erro:
                print("⚠️ Serie diaria AliExpress indisponivel: "
                      f"{seguranca.redigir_segredos(erro)}")
        except Exception as erro:
            print("⚠️ Conversoes AliExpress indisponiveis: "
                  f"{seguranca.redigir_segredos(erro)}")
    if shopee.esta_configurada():
        try:
            conversoes_shopee = shopee.resumo_conversoes(inicio_7d, agora)
            _enriquecer_com_historico(conversoes_shopee)
            store.salvar_desempenho("Shopee", conversoes_shopee.get("produtos"))
            try:
                diario_shopee = shopee.resumo_conversoes(
                    datetime.fromtimestamp(inicio), datetime.fromtimestamp(fim)
                )
            except Exception as erro:
                print("⚠️ Serie diaria Shopee indisponivel: "
                      f"{seguranca.redigir_segredos(erro)}")
        except Exception as erro:
            print("⚠️ Conversoes Shopee indisponiveis: "
                  f"{seguranca.redigir_segredos(erro)}")
    publicacoes = store.publicacoes_por_fonte(inicio_7d.timestamp(), agora.timestamp())
    validas = {
        "AliExpress": ((conversoes or {}).get("pagos", 0)
                       + (conversoes or {}).get("confirmados", 0)),
        "Shopee": ((conversoes_shopee or {}).get("pendentes", 0)
                   + (conversoes_shopee or {}).get("concluidas", 0)),
    }
    alertas = [
        f"{fonte}: {qtd} posts em 7 dias e nenhuma conversao"
        for fonte, qtd in sorted(publicacoes.items())
        if qtd >= config.RELATORIO_ALERTA_MIN_POSTS and not validas.get(fonte, 0)
    ]
    eventos = store.resumo_eventos(inicio, fim)
    saude = store.saude_fontes(inicio, fim)
    alertas = alertas_saude_fontes(saude) + alertas
    if eventos.get("imagens_omitidas", 0) >= 3:
        alertas.append(
            f"Bluesky: {eventos['imagens_omitidas']} posts saíram sem imagem"
        )
    for loja, estoque in sorted(store.estoque_listas().items()):
        if estoque["ineditas"] <= config.ESTOQUE_LISTA_ALERTA:
            alertas.append(
                f"Lista {loja}: só {estoque['ineditas']} produto(s) inédito(s) "
                f"de {estoque['total']}; adicione itens novos"
            )
    for canal in ("Telegram", "Bluesky", "Facebook", "X", "Instagram Stories", "Site"):
        falhas = store.falhas_consecutivas(canal)
        if falhas >= config.FALHAS_CONSECUTIVAS_ALERTA:
            alertas.append(f"{canal}: {falhas} entregas consecutivas falharam")
    ids_convertidos = {
        p.get("oferta_id")
        for resumo in (conversoes, conversoes_shopee) if resumo
        for p in resumo.get("produtos") or []
    }
    sem_conversao = store.ofertas_sem_conversao(
        inicio_7d.timestamp(), ids_convertidos
    )
    cliques_resumos, cliques_dia_resumos = [], []
    provedores_cliques = []
    if shortlinks.esta_configurado():
        provedores_cliques.append(("links próprios", shortlinks))
    if site_publisher.esta_configurado():
        provedores_cliques.append(("site", site_publisher))
    for nome_provedor, provedor in provedores_cliques:
        try:
            cliques_dia_resumos.append(provedor.resumo_cliques(
                datetime.fromtimestamp(inicio), datetime.fromtimestamp(fim)
            ))
        except Exception as erro:
            print(f"⚠️ Cliques de ontem ({nome_provedor}) indisponiveis: "
                  f"{seguranca.redigir_segredos(erro)}")
        try:
            cliques_resumos.append(provedor.resumo_cliques(inicio_7d, agora))
        except Exception as erro:
            print(f"⚠️ Cliques ({nome_provedor}) indisponiveis: "
                  f"{seguranca.redigir_segredos(erro)}")
    cliques = _somar_cliques(cliques_resumos) if cliques_resumos else None
    cliques_dia = (_somar_cliques(cliques_dia_resumos)
                   if cliques_dia_resumos else None)
    if cliques is not None:
        try:
            metas_cliques = store.metadados_ofertas(cliques["por_oferta"])
            cliques["por_produto"] = {
                (metas_cliques.get(oid, {}).get("titulo") or oid): qtd
                for oid, qtd in cliques["por_oferta"].items()
            }
            cliques["somente_cliques"] = sorted((
                (metas_cliques.get(oid, {}).get("titulo") or oid, qtd)
                for oid, qtd in cliques["por_oferta"].items()
                if oid not in ids_convertidos
            ), key=lambda item: (-item[1], item[0]))
        except Exception as erro:
            print("⚠️ Detalhes dos cliques indisponiveis: "
                  f"{seguranca.redigir_segredos(erro)}")

    publicacoes_dia = store.publicacoes_por_fonte(inicio, fim)
    publicacoes_dia_canal = store.publicacoes_por_fonte_canal(inicio, fim)
    for fonte, resumo_diario in (("AliExpress", diario_ali),
                                 ("Shopee", diario_shopee)):
        if resumo_diario is None:
            continue
        posts_canal = {
            str(canal).lower(): qtd
            for canal, qtd in publicacoes_dia_canal.get(fonte, {}).items()
        }
        store.salvar_metricas_diarias(
            chave, fonte, resumo_diario, posts_canal,
            posts_total=publicacoes_dia.get(fonte, 0)
        )
        store.salvar_experimentos_diarios(
            chave, fonte, resumo_diario.get("produtos"), inicio, fim
        )
    tendencias = store.tendencias_diarias(agora.date())
    testes_ab = store.resumo_experimentos(agora.date())
    url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
    resposta = requests.post(url, json={"chat_id": config.TELEGRAM_ADMIN_ID,
        "text": _texto(store.resumo_periodo(inicio, fim), ontem.strftime("%d/%m/%Y"),
                       conversoes, conversoes_shopee, alertas,
                       sem_conversao, cliques, tendencias, testes_ab,
                       eventos, diario_ali=diario_ali,
                       diario_shopee=diario_shopee,
                       cliques_dia=cliques_dia, saude=saude,
                       posts_7d=publicacoes)}, timeout=30)
    corpo = resposta.json()
    if not corpo.get("ok"):
        raise RuntimeError(f"Telegram recusou o relatório: {corpo}")
    store.marcar_relatorio_enviado(chave)
    return True
