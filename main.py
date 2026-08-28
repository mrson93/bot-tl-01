"""
BOT DE OFERTAS  ->  TELEGRAM + BLUESKY   (Shopee + AliExpress)

Como usar:
  python main.py            roda pra sempre, procurando e postando ofertas
  python main.py --once     roda so uma vez (bom pra testar)
  python main.py --check    so confere se as configuracoes estao certas
"""
import random
import sys
import time
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Faz o console do Windows aceitar emojis (evita travar ao imprimir).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

import config
import desempenho
import experimentos
import shopee
import aliexpress
import amazon
import store
import telegram_poster
import bluesky
import relatorio
import seguranca
import shortlinks

# Lojas de onde vem as ofertas.
FONTES = [shopee, aliexpress, amazon]
# Canais onde as ofertas sao publicadas.
CANAIS = [telegram_poster, bluesky]
FUSO_BRASILIA = ZoneInfo("America/Sao_Paulo")

MENSAGENS_BOM_DIA = [
    "Bom dia, pessoal! ☀️ Semana começando e eu já estou de olho nas melhores ofertas. Bora economizar! 🛍️",
    "Bom dia! ☕ Já comecei a procurar os preços e cupons que realmente valem a pena hoje. Fiquem de olho! 👀",
    "Bom dia, pessoal! 😊 Metade da semana chegando e a caça às promoções já começou. Quando aparecer coisa boa, mando aqui!",
    "Bom dia! 🌤️ Já estou de olho nas ofertas de hoje para separar só o que realmente compensar. 🛒",
    "Bom dia, pessoal! 😄 Sextou, mas a busca por preço baixo não para. Bora encontrar boas ofertas! 🔥",
    "Bom dia! ☀️ Sábado também é dia de economizar. Já estou procurando as melhores oportunidades de hoje! 🛍️",
    "Bom dia, pessoal! ☕ Domingo tranquilo e ofertas boas quando aparecerem. Vou ficar de olho por aqui! 👀",
]


def fontes_ativas():
    return [f for f in FONTES if f.esta_configurada() and config.loja_ativa(f.NOME)]


def canais_ativos():
    return [c for c in CANAIS if c.esta_configurada()]


def enviar_bom_dia_se_preciso(agora=None) -> bool:
    """Envia uma saudacao por dia, na primeira execucao da manha."""
    agora = agora or datetime.now(FUSO_BRASILIA)
    if agora.tzinfo is None:
        agora = agora.replace(tzinfo=FUSO_BRASILIA)
    else:
        agora = agora.astimezone(FUSO_BRASILIA)
    if agora.hour < 5 or agora.hour >= 12:
        return False
    data = agora.date().isoformat()
    mensagem = MENSAGENS_BOM_DIA[agora.weekday()]
    publicou = False
    for canal in (telegram_poster, bluesky):
        if not canal.esta_configurada() or store.bom_dia_enviado(data, canal.NOME):
            continue
        try:
            canal.postar_bom_dia(mensagem)
            publicou = True
            store.marcar_bom_dia_enviado(data, canal.NOME)
            print(f"☀️ Mensagem de bom dia publicada no {canal.NOME}.")
        except Exception as erro:
            erro_seguro = seguranca.redigir_segredos(erro)
            print(f"⚠️ Bom dia falhou no {canal.NOME}: {erro_seguro}")
    return publicou


def publicar(fonte, oferta: dict) -> int:
    """Publica em todos os canais ativos, cada um com seu link rastreado.
    Retorna quantos canais aceitaram."""
    ok = 0
    oid = oferta["oferta_id"]
    preco = float(oferta.get("price") or 0)
    for canal in canais_ativos():
        if not store.canal_pendente(oid, canal.NOME, preco):
            continue
        try:
            link = fonte.gerar_link(oferta.get("productUrl"),
                                    getattr(canal, "TRACKING_ID", "") or None,
                                    etiquetas(oferta))
            if shortlinks.esta_configurado():
                try:
                    link = shortlinks.criar(link, oid, canal.NOME, fonte.NOME)
                except Exception as erro_link:
                    print("   ⚠️  Link proprio indisponivel; usando afiliado oficial: "
                          f"{seguranca.redigir_segredos(erro_link)}")
            canal.postar(oferta, link)
            store.registrar_entrega(oid, canal.NOME, True, preco, fonte.NOME)
            ok += 1
        except Exception as e:
            erro = seguranca.redigir_segredos(e)[:500]
            store.registrar_entrega(oid, canal.NOME, False, preco, fonte.NOME, erro)
            print(f"   ⚠️  {canal.NOME} recusou: {erro}")
    return ok


def _timestamp_cupom(valor):
    """Converte data oficial de cupom em epoch, sem supor uma validade."""
    if valor in (None, ""):
        return None
    try:
        numero = float(valor)
        return int(numero / 1000 if numero > 10_000_000_000 else numero)
    except (TypeError, ValueError):
        pass
    try:
        return int(datetime.fromisoformat(str(valor).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def cupons_oficiais(ofertas):
    """Extrai somente cupons com codigo e pagina de resgate da API afiliada."""
    vistos, resultado = set(), []
    for oferta in ofertas:
        codigo = str(oferta.get("cupom") or "").strip()
        destino = str(oferta.get("productUrl") or "").strip()
        if not (codigo and destino and oferta.get("cupomResgate")):
            continue
        bruto = "|".join((str(oferta.get("fonte") or ""), codigo,
                           str(oferta.get("cupomCondicao") or ""), destino,
                           str(oferta.get("cupomExpiraEm") or "")))
        identificador = "cupom_" + hashlib.sha256(bruto.encode("utf-8")).hexdigest()[:24]
        if identificador in vistos:
            continue
        vistos.add(identificador)
        resultado.append({
            "id": identificador, "fonte": oferta.get("fonte"), "codigo": codigo,
            "condicao": oferta.get("cupomCondicao"), "destino": destino,
            "ativo_em": _timestamp_cupom(oferta.get("cupomAtivoEm")),
            "expira_em": _timestamp_cupom(oferta.get("cupomExpiraEm")),
            "_fonte_obj": oferta["_fonte_obj"],
        })
    return resultado


def publicar_cupons(cupons) -> int:
    """Registra e alerta uma vez por canal sobre cupons oficiais novos."""
    if not config.CUPOM_ALERTA_SEPARADO:
        return 0
    publicados = 0
    for cupom in list(cupons)[:config.CUPOM_ALERTAS_POR_RODADA]:
        store.salvar_cupom(cupom)
        for canal in canais_ativos():
            if not hasattr(canal, "postar_cupom") or not store.cupom_pendente(cupom["id"], canal.NOME):
                continue
            try:
                link = cupom["_fonte_obj"].gerar_link(
                    cupom["destino"], getattr(canal, "TRACKING_ID", "") or None,
                    ["cupom", "resgate"],
                )
                canal.postar_cupom(cupom, link)
                store.registrar_entrega_cupom(cupom["id"], canal.NOME, True)
                publicados += 1
            except Exception as erro:
                store.registrar_entrega_cupom(cupom["id"], canal.NOME, False)
                print(f"   ⚠️  Alerta de cupom falhou no {canal.NOME}: "
                      f"{seguranca.redigir_segredos(erro)}")
    return publicados


def enviar_resumo_cupons_se_preciso(agora=None) -> bool:
    """Publica no Telegram um resumo de cupons ainda ativos em horas configuradas."""
    agora = agora or datetime.now(FUSO_BRASILIA)
    if agora.hour not in config.CUPOM_RESUMO_HORAS or not telegram_poster.esta_configurada():
        return False
    chave = agora.strftime("%Y-%m-%d-%H")
    if store.resumo_cupons_enviado(chave):
        return False
    cupons = store.cupons_ativos(config.CUPOM_RESUMO_MAX_ITENS, agora.timestamp())
    if not cupons:
        return False
    fontes = {fonte.NOME: fonte for fonte in FONTES}
    links = {}
    try:
        for cupom in cupons:
            fonte = fontes.get(cupom["fonte"])
            if not fonte:
                continue
            links[cupom["id"]] = fonte.gerar_link(cupom["destino"], telegram_poster.TRACKING_ID,
                                                    ["cupom", "resumo"])
        if not links:
            return False
        telegram_poster.postar_resumo_cupons(cupons, links)
        store.marcar_resumo_cupons_enviado(chave)
        return True
    except Exception as erro:
        print(f"⚠️ Resumo de cupons falhou: {seguranca.redigir_segredos(erro)}")
        return False


def passa_no_filtro(oferta: dict) -> bool:
    """Diz se a oferta e boa o bastante para postar, segundo os filtros do .env."""
    desconto = float(oferta.get("priceDiscountRate") or 0)
    rating = float(oferta.get("ratingStar") or 0)
    vendas = oferta.get("sales")
    preco = float(oferta.get("price") or 0)

    if preco < config.MIN_PRICE:
        return False
    if desconto < config.MIN_DISCOUNT:
        return False
    # so exige nota se o produto tiver nota (produtos novos podem nao ter)
    if rating and rating < config.MIN_RATING:
        return False
    # loja que nao informa numero de vendas (ex: Amazon) fica fora desse filtro
    if vendas is not None and int(vendas) < config.MIN_SALES:
        return False
    # promocao de 80% num produto de R$ 18 rende R$ 2: ocupa o mesmo espaco no
    # canal que uma que rende R$ 40, entao exigimos um minimo por venda
    if config.MIN_GANHO and ganho_por_venda(oferta) < config.MIN_GANHO:
        return False
    return True


def ganho_por_venda(oferta: dict) -> float:
    """Quanto essa venda deve pagar de comissao, em reais."""
    return float(oferta.get("price") or 0) * float(oferta.get("comissao") or 0)


def etiquetas(oferta: dict) -> list:
    """Marcas de rastreio para descobrir DEPOIS o que converte: faixa de preco
    e faixa de desconto. Viram subIds no link da Shopee."""
    preco = float(oferta.get("price") or 0)
    faixa = "ate50" if preco < 50 else "de50a150" if preco < 150 else "acima150"
    desconto = float(oferta.get("priceDiscountRate") or 0)
    resultado = [faixa, "desc70mais" if desconto >= 70 else "descAte69"]
    variante = str(oferta.get("variante") or "")
    if variante in {"A", "B"}:
        resultado.append(f"ab{variante}")
    return resultado


def pontuacao(oferta: dict) -> float:
    """Nota da oferta: desconto e a base, a comissao e um multiplicador.

    Multiplica em vez de somar de proposito -- somando, um produto de 20% de
    desconto com comissao gorda passaria na frente de uma promocao de 60%,
    e quem le o canal quer a promocao. Assim a comissao so desempata entre
    ofertas parecidas.
    """
    desconto = float(oferta.get("priceDiscountRate") or 0)
    comissao = float(oferta.get("comissao") or 0)
    base = desconto * (1 + comissao * config.PESO_COMISSAO)
    multiplicador = oferta.get("_multiplicador_desempenho")
    if multiplicador is None:
        multiplicador = store.multiplicador_desempenho(oferta)
    nota = base * float(multiplicador) * config.peso_loja(oferta.get("fonte"))
    # Cupons retornados oficialmente pelas plataformas são escassos e podem
    # acabar antes da próxima rodada; entram no topo sem ignorar filtros.
    if str(oferta.get("cupom") or "").strip():
        nota += config.CUPOM_PRIORIDADE_BONUS
    return nota


def dentro_do_horario() -> bool:
    hora = datetime.now().hour
    if config.HORA_INICIO <= config.HORA_FIM:
        return config.HORA_INICIO <= hora <= config.HORA_FIM
    # janela que atravessa a meia-noite (ex: 6 as 1 = 06:00 ate 01:59)
    return hora >= config.HORA_INICIO or hora <= config.HORA_FIM


def minutos_para_proximo(agora=None) -> int:
    """Sorteia uma vez o intervalo real; o resultado sera persistido."""
    agora = agora or datetime.now()
    minimo, maximo = config.MIN_MINUTOS_ENTRE_POSTS, config.MAX_MINUTOS_ENTRE_POSTS
    if agora.hour not in config.HORAS_PICO:
        minimo = config.MIN_MINUTOS_FORA_PICO
        maximo = config.MAX_MINUTOS_FORA_PICO
    return random.randint(min(minimo, maximo), max(minimo, maximo))


def agendar_proxima(tentativa_curta=False, agora=None):
    agora = agora or datetime.now()
    minutos = config.RETRY_MINUTES if tentativa_curta else minutos_para_proximo(agora)
    alvo = int(agora.timestamp()) + minutos * 60
    store.definir_proximo_post(alvo)
    print(f"⏰ Proxima tentativa: {datetime.fromtimestamp(alvo).strftime('%H:%M')} ({minutos} min).")


def buscar_candidatos(fonte) -> list:
    """Busca e filtra uma loja; a publicação acontece só após comparar todas."""
    print(f"🔎 Buscando ofertas em {fonte.NOME}...")
    try:
        ofertas = fonte.buscar_ofertas()
    except Exception as e:
        erro = seguranca.redigir_segredos(e)
        print(f"   ❌ Erro ao buscar ofertas em {fonte.NOME}: {erro}")
        return []

    print(f"   {len(ofertas)} ofertas recebidas. Aplicando filtros...")

    nomes_canais = [c.NOME for c in canais_ativos()]
    candidatos = []
    for oferta in ofertas:
        oferta["fonte"] = oferta.get("fonte") or fonte.NOME
        oferta["categoria"] = (oferta.get("categoria")
                               or desempenho.categoria_produto(oferta))
        oferta["_fonte_obj"] = fonte
        experimentos.aplicar(oferta)
        if not oferta.get("oferta_id") or not passa_no_filtro(oferta):
            continue
        oid = oferta["oferta_id"]
        preco = float(oferta.get("price") or 0)
        motivo = store.avaliar_elegibilidade(oid, preco,
            config.DIAS_ANTES_DE_REPETIR, config.QUEDA_PRECO_REPOST_PERCENT)
        # Uma entrega que falhou continua elegivel mesmo durante o cooldown.
        if motivo or store.ha_canal_pendente(oid, nomes_canais, preco):
            oferta["_motivo"] = motivo or "canal_pendente"
            candidatos.append(oferta)
    return candidatos


def _ordenar_candidatos(candidatos):
    candidatos = list(candidatos)
    recentes = store.ofertas_recentes(config.DIVERSIDADE_JANELA_POSTS)
    multiplicadores = store.multiplicadores_desempenho(candidatos)
    for oferta in candidatos:
        chave_historico = (str(oferta.get("fonte") or ""),
                           str(oferta.get("oferta_id") or ""))
        oferta["_multiplicador_desempenho"] = multiplicadores.get(
            chave_historico, 1.0
        )
        oferta["_semelhante_recente"] = any(
            desempenho.produtos_semelhantes(
                oferta, recente.get("titulo"), config.SIMILARIDADE_MAXIMA
            ) for recente in recentes[:1]
        )
        categorias_recentes = [r.get("categoria") for r in recentes]
        oferta["_diversidade"] = (
            0 if oferta["_semelhante_recente"] else
            1 if oferta.get("categoria") in categorias_recentes else 2
        )
    prioridade = {"canal_pendente": 4, "queda_preco": 3,
                  "inedita": 2, "repescagem": 1}

    def chave(oferta):
        motivo = oferta.get("_motivo")
        if motivo == "repescagem":
            comercial = -store.quando_postada(oferta["oferta_id"])
        else:
            comercial = pontuacao(oferta)
        # Desconto e o criterio principal: uma oferta menos descontada so entra
        # quando nao houver outra elegivel com desconto maior. Comissao,
        # desempenho e variedade continuam apenas como desempate comercial.
        desconto = float(oferta.get("priceDiscountRate") or 0)
        return prioridade.get(motivo, 0), desconto, oferta.get("_diversidade", 2), comercial

    return sorted(candidatos, key=chave, reverse=True)


def _publicar_fila(fila, limite):
    """Publica a fila global já comparada e devolve a quantidade aceita."""
    postadas = 0
    for oferta in fila:
        if postadas >= limite:
            break
        fonte = oferta["_fonte_obj"]
        oid = oferta["oferta_id"]

        if publicar(fonte, oferta) == 0:
            continue
        store.marcar_postada(
            oid, oferta.get("price"), oferta.get("priceDiscountRate"), fonte.NOME,
            titulo=oferta.get("productName"), categoria=oferta.get("categoria"),
            experimento=oferta.get("experimento"), variante=oferta.get("variante")
        )
        postadas += 1
        nome = (oferta.get("productName") or "")[:50]
        print(f"   ✅ Postado ({fonte.NOME}): {nome}...")

        if postadas < limite:
            time.sleep(config.DELAY_BETWEEN_POSTS_SECONDS)
    return postadas


def rodar_loja(fonte, limite: int) -> int:
    """Compatibilidade para executar uma loja isoladamente."""
    return _publicar_fila(_ordenar_candidatos(buscar_candidatos(fonte)), limite)


def rodar_uma_vez() -> int:
    """Busca lojas em paralelo e compara todas as ofertas antes de publicar."""
    limite = config.limite_posts_por_rodada()
    lojas = fontes_ativas()
    candidatos = []
    if lojas:
        with ThreadPoolExecutor(max_workers=len(lojas)) as executor:
            futuros = {executor.submit(buscar_candidatos, fonte): fonte for fonte in lojas}
            for futuro in as_completed(futuros):
                try:
                    candidatos.extend(futuro.result())
                except Exception as erro:
                    fonte = futuros[futuro]
                    print(f"   ❌ Falha inesperada em {fonte.NOME}: "
                          f"{seguranca.redigir_segredos(erro)}")
    alertas_cupom = publicar_cupons(cupons_oficiais(candidatos))
    total = _publicar_fila(
        _ordenar_candidatos(candidatos), limite
    )
    print(f"🏁 Rodada concluida. {total} oferta(s) e {alertas_cupom} alerta(s) de cupom.")
    return total + alertas_cupom


def checar() -> bool:
    faltando = config.validar()
    if faltando:
        print("❌ Faltam configuracoes no .env: " + ", ".join(faltando))
        print("   Copie o arquivo .env.example para .env e preencha.")
        return False
    print("✅ Configuracoes basicas preenchidas.")
    print(f"   Canal: {config.TELEGRAM_CHANNEL}")
    lojas = ", ".join(f.NOME for f in fontes_ativas()) or "(nenhuma)"
    print(f"   Lojas ativas: {lojas}")
    canais = ", ".join(c.NOME for c in canais_ativos()) or "(nenhum)"
    print(f"   Canais ativos: {canais}")
    print(f"   Filtros: desconto>={config.MIN_DISCOUNT}%  nota>={config.MIN_RATING}"
          f"  vendas>={config.MIN_SALES}")
    print(f"   Ritmo: ate {config.MAX_POSTS_PER_RUN} post(s) por rodada, "
          f"somando todas as lojas")
    return True


def enviar_relatorio_seguro(forcar=False) -> bool:
    """Envia o resumo sem permitir que uma falha interrompa as ofertas."""
    if not forcar and not config.RELATORIO_AUTOMATICO_NA_EXECUCAO:
        return False
    try:
        if forcar:
            return relatorio.enviar_se_devido(forcar=True)
        return relatorio.enviar_se_devido()
    except Exception as e:
        print(f"⚠️ Relatorio diario falhou: {seguranca.redigir_segredos(e)}")
        return False


def teste_telegram() -> None:
    """Posta UMA oferta de exemplo nos canais, so pra ver como fica."""
    exemplo = {
        "fonte": "AliExpress",
        "productName": "PRODUTO DE EXEMPLO - Fone Bluetooth (isto e so um teste)",
        "price": 79.90,
        "priceDiscountRate": 60,
        "ratingStar": 4.8,
        "sales": 1234,
        "shopName": "Loja de Exemplo",
        "imageUrl": "https://picsum.photos/600/600",
    }
    print("📮 Enviando uma oferta de EXEMPLO para os canais...")
    for canal in canais_ativos():
        canal.postar(exemplo, "https://example.com")
    print("✅ Enviado! Confira os canais. Pode apagar a mensagem de teste depois.")


def main():
    args = sys.argv[1:]

    if "--check" in args:
        checar()
        return

    if "--teste-telegram" in args:
        teste_telegram()
        return

    if "--relatorio" in args:
        if enviar_relatorio_seguro(forcar=True):
            print("✅ Relatorio privado enviado.")
            return
        print("❌ Relatorio nao enviado. Confira TELEGRAM_BOT_TOKEN e "
              "TELEGRAM_ADMIN_ID.")
        sys.exit(1)

    if not checar():
        sys.exit(1)

    if "--once" in args:
        if not dentro_do_horario():
            print(f"🌙 Fora do horario ({config.HORA_INICIO}h as {config.HORA_FIM}h59). Nada a fazer.")
            return
        proximo = store.proximo_post()
        agora_ts = int(time.time())
        if proximo and agora_ts < proximo:
            # O relatorio diario nao depende de haver uma oferta liberada agora.
            enviar_relatorio_seguro()
            enviar_resumo_cupons_se_preciso()
            print(f"⏳ Proxima postagem prevista para {datetime.fromtimestamp(proximo).strftime('%H:%M')}.")
            return
        try:
            bom_dia_publicado = enviar_bom_dia_se_preciso()
        except Exception as e:
            print(f"⚠️ Bom dia falhou: {seguranca.redigir_segredos(e)}")
            bom_dia_publicado = False
        if bom_dia_publicado:
            print("⏳ Aguardando 5 minutos antes da primeira oferta...")
            time.sleep(300)
        total = rodar_uma_vez()
        agendar_proxima(tentativa_curta=total == 0)
        # O resumo administrativo pode consultar varias paginas do AliExpress.
        # Ele roda por ultimo para nunca atrasar a publicacao nem o agendamento.
        enviar_relatorio_seguro()
        enviar_resumo_cupons_se_preciso()
        return

    print(f"🤖 Bot no ar! Procurando ofertas a cada "
          f"{config.POLL_MIN_MINUTES}-{config.POLL_MAX_MINUTES} minutos. (Ctrl+C para parar)")
    while True:
        agora = datetime.now()
        if not dentro_do_horario():
            # fora do horario: dorme ate o proximo inicio de janela
            alvo = agora.replace(hour=config.HORA_INICIO, minute=0, second=0, microsecond=0)
            if alvo <= agora:
                alvo += timedelta(days=1)
            segundos = max(60, int((alvo - agora).total_seconds()))
            print(f"🌙 Fora do horario. Dormindo ate {alvo.strftime('%H:%M')}.")
            time.sleep(segundos)
            continue

        if rodar_uma_vez() > 0:
            espera = random.randint(config.POLL_MIN_MINUTES, config.POLL_MAX_MINUTES)
            print(f"😴 Postou. Proxima rodada em {espera} minutos.")
        else:
            # ponytail: nada postado -> tenta de novo logo (pausa curta evita
            # martelar a API se a busca vier vazia varias vezes seguidas)
            espera = config.RETRY_MINUTES
            print(f"🔁 Nada encontrado. Tentando de novo em {espera} min.")
        time.sleep(espera * 60)


if __name__ == "__main__":
    main()
