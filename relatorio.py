"""Resumo diário privado e opcional do funcionamento do bot."""
from datetime import datetime, timedelta

import requests

import aliexpress
import config
import seguranca
import shopee
import shortlinks
import store
import desempenho


def _numero(valor):
    return f"{float(valor):.2f}".replace(".", ",")


def _top(contadores, limite=3):
    return sorted((contadores or {}).items(), key=lambda item: (-item[1], item[0]))[:limite]


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


def _texto(linhas, data, conversoes=None, conversoes_shopee=None,
           alertas=None, sem_conversao=None, cliques=None, tendencias=None,
           testes_ab=None, eventos=None):
    """Relatório curto, em blocos estáveis, para leitura rápida no Telegram."""
    sucessos = sum(qtd for _, ok, _, qtd in linhas if ok)
    falhas = sum(qtd for _, ok, _, qtd in linhas if not ok)
    por_loja, por_canal = {}, {}
    for canal, ok, fonte, qtd in linhas:
        if ok:
            por_loja[fonte or "Desconhecida"] = por_loja.get(fonte or "Desconhecida", 0) + qtd
            por_canal[canal] = por_canal.get(canal, 0) + qtd

    blocos = [f"📊 RELATÓRIO DIÁRIO · {data}", "━━━━━━━━━━━━━━", "📮 OPERAÇÃO DE ONTEM",
              f"✅ {sucessos} entregas · ⚠️ {falhas} falhas"]
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
        if cliques.get("por_canal"):
            blocos.append("Por canal: " + " · ".join(
                f"{nome} {qtd}" for nome, qtd in sorted(cliques["por_canal"].items())
            ))
        if cliques.get("por_produto"):
            blocos.append("Mais clicados: " + "; ".join(
                f"{str(nome)[:38]} ({qtd})" for nome, qtd in _top(cliques["por_produto"], 2)
            ))
        if cliques.get("somente_cliques"):
            blocos.append("Sem conversão: " + "; ".join(
                f"{str(nome)[:38]} ({qtd})" for nome, qtd in cliques["somente_cliques"][:2]
            ))

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
    if eventos.get("imagens_omitidas", 0) >= 3:
        alertas.append(
            f"Bluesky: {eventos['imagens_omitidas']} posts saíram sem imagem"
        )
    for canal in ("Telegram", "Bluesky"):
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
    cliques = None
    if shortlinks.esta_configurado():
        try:
            cliques = shortlinks.resumo_cliques(inicio_7d, agora)
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
            print("⚠️ Cliques indisponiveis: "
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
                       eventos)}, timeout=30)
    corpo = resposta.json()
    if not corpo.get("ok"):
        raise RuntimeError(f"Telegram recusou o relatório: {corpo}")
    store.marcar_relatorio_enviado(chave)
    return True
