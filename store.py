"""Estado persistente do bot: histórico, entregas e agendamento."""
import datetime
import math
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

_DB = Path(__file__).parent / "postadas.db"


@contextmanager
def _conn():
    con = sqlite3.connect(_DB, timeout=30)
    con.execute("CREATE TABLE IF NOT EXISTS postadas (id TEXT PRIMARY KEY, postada_em INTEGER)")
    existentes = {r[1] for r in con.execute("PRAGMA table_info(postadas)")}
    for nome, tipo in (("preco", "REAL"), ("desconto", "REAL"), ("fonte", "TEXT"),
                       ("titulo", "TEXT"), ("categoria", "TEXT"),
                       ("experimento", "TEXT"), ("variante", "TEXT"),
                       ("loja", "TEXT")):
        if nome not in existentes:
            con.execute(f"ALTER TABLE postadas ADD COLUMN {nome} {tipo}")
    con.execute("CREATE TABLE IF NOT EXISTS entregas (id TEXT NOT NULL, canal TEXT NOT NULL, sucesso INTEGER NOT NULL, preco REAL, fonte TEXT, tentativas INTEGER NOT NULL DEFAULT 1, erro TEXT, entregue_em INTEGER NOT NULL, PRIMARY KEY(id,canal))")
    con.execute("CREATE TABLE IF NOT EXISTS entregas_log (id TEXT, canal TEXT, sucesso INTEGER, preco REAL, fonte TEXT, erro TEXT, entregue_em INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS buffer_posts (id TEXT NOT NULL, canal TEXT NOT NULL, post_id TEXT NOT NULL, criado_em INTEGER NOT NULL, PRIMARY KEY(id,canal))")
    colunas_buffer = {r[1] for r in con.execute("PRAGMA table_info(buffer_posts)")}
    if "ultimo_retry_em" not in colunas_buffer:
        con.execute("ALTER TABLE buffer_posts ADD COLUMN ultimo_retry_em INTEGER")
    con.execute("CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS desempenho (fonte TEXT NOT NULL, oferta_id TEXT NOT NULL, categoria TEXT, conversoes INTEGER NOT NULL DEFAULT 0, quantidade INTEGER NOT NULL DEFAULT 0, comissao REAL NOT NULL DEFAULT 0, atualizado_em INTEGER NOT NULL, PRIMARY KEY(fonte,oferta_id))")
    con.execute("CREATE TABLE IF NOT EXISTS metricas_diarias (data TEXT NOT NULL, fonte TEXT NOT NULL, canal TEXT NOT NULL DEFAULT '', posts INTEGER NOT NULL DEFAULT 0, conversoes INTEGER NOT NULL DEFAULT 0, quantidade INTEGER NOT NULL DEFAULT 0, comissao REAL NOT NULL DEFAULT 0, canceladas INTEGER NOT NULL DEFAULT 0, cliques INTEGER NOT NULL DEFAULT 0, atualizado_em INTEGER NOT NULL, PRIMARY KEY(data,fonte,canal))")
    con.execute("CREATE TABLE IF NOT EXISTS metricas_categoria_diarias (data TEXT NOT NULL, fonte TEXT NOT NULL, categoria TEXT NOT NULL, conversoes INTEGER NOT NULL DEFAULT 0, quantidade INTEGER NOT NULL DEFAULT 0, atualizado_em INTEGER NOT NULL, PRIMARY KEY(data,fonte,categoria))")
    con.execute("CREATE TABLE IF NOT EXISTS experimentos_diarios (data TEXT NOT NULL, experimento TEXT NOT NULL, variante TEXT NOT NULL, fonte TEXT NOT NULL, posts INTEGER NOT NULL DEFAULT 0, conversoes INTEGER NOT NULL DEFAULT 0, comissao REAL NOT NULL DEFAULT 0, atualizado_em INTEGER NOT NULL, PRIMARY KEY(data,experimento,variante,fonte))")
    # Apenas metadados publicos de campanhas recebidos das APIs afiliadas.
    # Nao guardamos usuarios, pedidos ou qualquer dado de comprador.
    con.execute("CREATE TABLE IF NOT EXISTS cupons_ativos (id TEXT PRIMARY KEY, fonte TEXT NOT NULL, codigo TEXT NOT NULL, condicao TEXT, destino TEXT NOT NULL, ativo_em INTEGER, expira_em INTEGER, visto_em INTEGER NOT NULL)")
    colunas_cupom = {r[1] for r in con.execute("PRAGMA table_info(cupons_ativos)")}
    if "titulo" not in colunas_cupom:
        con.execute("ALTER TABLE cupons_ativos ADD COLUMN titulo TEXT")
    if "tipo" not in colunas_cupom:
        con.execute("ALTER TABLE cupons_ativos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'codigo'")
    con.execute("CREATE TABLE IF NOT EXISTS entregas_cupom (id TEXT NOT NULL, canal TEXT NOT NULL, sucesso INTEGER NOT NULL, entregue_em INTEGER NOT NULL, PRIMARY KEY(id,canal))")
    con.execute("CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, ocorrido_em INTEGER NOT NULL, execucao_id TEXT NOT NULL, tipo TEXT NOT NULL, oferta_id TEXT, canal TEXT, fonte TEXT, motivo TEXT, quantidade INTEGER NOT NULL DEFAULT 1)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_eventos_periodo ON eventos(ocorrido_em,tipo)")
    con.execute("CREATE TABLE IF NOT EXISTS vendas_produto_diarias (data TEXT NOT NULL, fonte TEXT NOT NULL, oferta_id TEXT NOT NULL, vendas INTEGER NOT NULL, observado_em INTEGER NOT NULL, PRIMARY KEY(data,fonte,oferta_id))")
    con.execute("CREATE INDEX IF NOT EXISTS idx_vendas_produto_historico ON vendas_produto_diarias(fonte,oferta_id,data)")
    con.commit()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def _inicio_do_dia(agora=None):
    dt = datetime.datetime.fromtimestamp(agora or time.time())
    return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def ja_postada(oferta_id):
    with _conn() as con:
        return con.execute("SELECT 1 FROM postadas WHERE id=?", (str(oferta_id),)).fetchone() is not None


def posts_desde(inicio):
    """Conta a fila global em uma janela móvel, inclusive após a meia-noite."""
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(*) FROM postadas WHERE postada_em>=?", (int(inicio),)
        ).fetchone()[0])


def posts_entre(inicio, fim):
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(*) FROM postadas WHERE postada_em>=? AND postada_em<?",
            (int(inicio), int(fim))
        ).fetchone()[0])


def postada_hoje(oferta_id, agora=None):
    with _conn() as con:
        return con.execute("SELECT 1 FROM postadas WHERE id=? AND postada_em>=?", (str(oferta_id), _inicio_do_dia(agora))).fetchone() is not None


def postada_nos_ultimos(oferta_id, dias, agora=None):
    if dias <= 0:
        return postada_hoje(oferta_id, agora)
    limite = int(agora or time.time()) - dias * 86400
    with _conn() as con:
        return con.execute("SELECT 1 FROM postadas WHERE id=? AND postada_em>=?", (str(oferta_id), limite)).fetchone() is not None


def quando_postada(oferta_id):
    with _conn() as con:
        row = con.execute("SELECT postada_em FROM postadas WHERE id=?", (str(oferta_id),)).fetchone()
        return int(row[0]) if row else 0


def preco_quando_postada(oferta_id):
    """Preço da última publicação, usado só para explicar uma queda real."""
    with _conn() as con:
        row = con.execute("SELECT preco FROM postadas WHERE id=?",
                          (str(oferta_id),)).fetchone()
    if not row or row[0] in (None, ""):
        return None
    try:
        return float(row[0])
    except (TypeError, ValueError):
        return None


def avaliar_elegibilidade(oferta_id, preco, dias, queda_percent, agora=None):
    agora = int(agora or time.time())
    with _conn() as con:
        row = con.execute("SELECT postada_em,preco FROM postadas WHERE id=?", (str(oferta_id),)).fetchone()
    if not row:
        return "inedita"
    if row[0] >= _inicio_do_dia(agora):
        return None
    if dias <= 0 or row[0] < agora - dias * 86400:
        return "repescagem"
    anterior, atual = float(row[1] or 0), float(preco or 0)
    if anterior > 0 and atual > 0 and atual <= anterior * (1 - queda_percent / 100):
        return "queda_preco"
    return None


def marcar_postada(oferta_id, preco=None, desconto=None, fonte=None, agora=None,
                   titulo=None, categoria=None, experimento=None, variante=None,
                   loja=None):
    with _conn() as con:
        con.execute("INSERT INTO postadas(id,postada_em,preco,desconto,fonte,titulo,categoria,experimento,variante,loja) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET postada_em=excluded.postada_em,preco=excluded.preco,desconto=excluded.desconto,fonte=excluded.fonte,titulo=COALESCE(excluded.titulo,postadas.titulo),categoria=COALESCE(excluded.categoria,postadas.categoria),experimento=COALESCE(excluded.experimento,postadas.experimento),variante=COALESCE(excluded.variante,postadas.variante),loja=COALESCE(excluded.loja,postadas.loja)",
                    (str(oferta_id), int(agora or time.time()), preco, desconto,
                     fonte, titulo, categoria, experimento, variante, loja))


def posts_por_fonte_desde(inicio):
    """Conta ofertas distintas da janela para equilibrar a distribuição."""
    with _conn() as con:
        return {fonte: int(total) for fonte, total in con.execute(
            "SELECT fonte, COUNT(*) FROM postadas "
            "WHERE postada_em >= ? AND fonte IS NOT NULL GROUP BY fonte",
            (int(inicio),),
        )}


def sequencia_fonte_recente(limite=3):
    """Devolve a plataforma mais recente e seu tamanho de sequência."""
    limite = max(1, int(limite or 1))
    with _conn() as con:
        fontes = [linha[0] for linha in con.execute(
            "SELECT fonte FROM postadas WHERE fonte IS NOT NULL "
            "ORDER BY postada_em DESC, rowid DESC LIMIT ?", (limite,)
        )]
    if not fontes:
        return None, 0
    primeira = fontes[0]
    consecutivas = 0
    for fonte in fontes:
        if fonte != primeira:
            break
        consecutivas += 1
    return primeira, consecutivas


def registrar_entrega(oferta_id, canal, sucesso, preco=None, fonte=None, erro=None, agora=None):
    momento = int(agora or time.time())
    with _conn() as con:
        dados = (str(oferta_id), canal, int(bool(sucesso)), preco, fonte, erro, momento)
        con.execute("INSERT INTO entregas(id,canal,sucesso,preco,fonte,tentativas,erro,entregue_em) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id,canal) DO UPDATE SET sucesso=excluded.sucesso,preco=excluded.preco,fonte=excluded.fonte,tentativas=entregas.tentativas+1,erro=excluded.erro,entregue_em=excluded.entregue_em", dados)
        con.execute("INSERT INTO entregas_log(id,canal,sucesso,preco,fonte,erro,entregue_em) VALUES(?,?,?,?,?,?,?)", dados)


def buffer_post(oferta_id, canal):
    info = buffer_post_info(oferta_id, canal)
    return info[0] if info else None


def buffer_post_info(oferta_id, canal):
    with _conn() as con:
        entregue = con.execute(
            "SELECT sucesso,entregue_em FROM entregas WHERE id=? AND canal=?",
            (str(oferta_id), canal),
        ).fetchone()
        row = con.execute("SELECT post_id,criado_em,ultimo_retry_em FROM buffer_posts WHERE id=? AND canal=?",
                          (str(oferta_id), canal)).fetchone()
    if not row or (entregue and entregue[0] and entregue[1] >= row[1]):
        return None
    return row


def registrar_buffer_post(oferta_id, canal, post_id):
    with _conn() as con:
        con.execute("INSERT INTO buffer_posts(id,canal,post_id,criado_em,ultimo_retry_em) VALUES(?,?,?,?,NULL) "
                    "ON CONFLICT(id,canal) DO UPDATE SET post_id=excluded.post_id, "
                    "criado_em=excluded.criado_em,ultimo_retry_em=NULL",
                    (str(oferta_id), canal, str(post_id), int(time.time())))


def marcar_retry_buffer(oferta_id, canal, agora=None):
    with _conn() as con:
        con.execute("UPDATE buffer_posts SET ultimo_retry_em=? WHERE id=? AND canal=?",
                    (int(agora or time.time()), str(oferta_id), canal))


def registrar_evento(tipo, execucao_id, quantidade=1, oferta_id=None,
                     canal=None, fonte=None, motivo=None, agora=None):
    """Persiste telemetria técnica sem conteúdo, links ou dados pessoais."""
    momento = int(agora or time.time())
    with _conn() as con:
        con.execute(
            "INSERT INTO eventos(ocorrido_em,execucao_id,tipo,oferta_id,canal,fonte,motivo,quantidade) VALUES(?,?,?,?,?,?,?,?)",
            (momento, str(execucao_id)[:64], str(tipo)[:48],
             str(oferta_id)[:100] if oferta_id else None,
             str(canal)[:30] if canal else None,
             str(fonte)[:30] if fonte else None,
             str(motivo)[:64] if motivo else None,
             max(0, int(quantidade or 0))),
        )
        con.execute("DELETE FROM eventos WHERE ocorrido_em<?", (momento - 90 * 86400,))


def resumo_eventos(inicio, fim):
    """Resumo agregado para o relatório privado do Telegram."""
    with _conn() as con:
        linhas = con.execute(
            "SELECT tipo,COALESCE(motivo,''),COALESCE(canal,''),SUM(quantidade) FROM eventos WHERE ocorrido_em>=? AND ocorrido_em<? GROUP BY tipo,motivo,canal",
            (int(inicio), int(fim)),
        ).fetchall()
    resultado = {"por_tipo": {}, "rejeicoes": {}, "fallbacks": {},
                 "falhas_por_canal": {}, "imagens_omitidas": 0}
    for tipo, motivo, canal, total in linhas:
        total = int(total or 0)
        resultado["por_tipo"][tipo] = resultado["por_tipo"].get(tipo, 0) + total
        if tipo == "ofertas_rejeitadas":
            resultado["rejeicoes"][motivo] = resultado["rejeicoes"].get(motivo, 0) + total
        elif tipo == "fallback":
            resultado["fallbacks"][motivo] = resultado["fallbacks"].get(motivo, 0) + total
            if motivo.startswith("bluesky_imagem_"):
                resultado["imagens_omitidas"] += total
        elif tipo == "publicacao_falha":
            resultado["falhas_por_canal"][canal or "desconhecido"] = total
    return resultado


def canal_pendente(oferta_id, canal, preco=None, repetir_apos_dias=None, agora=None):
    with _conn() as con:
        row = con.execute("SELECT sucesso,preco,entregue_em FROM entregas WHERE id=? AND canal=?", (str(oferta_id), canal)).fetchone()
    if not row or not row[0]:
        return True
    if repetir_apos_dias is not None:
        momento = int(agora or time.time())
        corte = min(_inicio_do_dia(momento), momento - max(0, repetir_apos_dias) * 86400)
        if row[2] < corte:
            return True
    return preco is not None and row[1] is not None and float(preco) < float(row[1])


def ha_canal_pendente(oferta_id, canais, preco=None):
    if not canais:
        return False
    marcas = ",".join("?" for _ in canais)
    with _conn() as con:
        rows = con.execute(f"SELECT canal,sucesso,preco FROM entregas WHERE id=? AND canal IN ({marcas})",
                           (str(oferta_id), *canais)).fetchall()
    entregues = {row[0]: row for row in rows}
    return any(canal not in entregues or not entregues[canal][1]
               or (preco is not None and entregues[canal][2] is not None
                   and float(preco) < float(entregues[canal][2]))
               for canal in canais)


def _estado(chave):
    with _conn() as con:
        row = con.execute("SELECT valor FROM estado WHERE chave=?", (chave,)).fetchone()
        return row[0] if row else None


def _definir_estado(chave, valor):
    with _conn() as con:
        con.execute("INSERT INTO estado(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (chave, str(valor)))


def proximo_post():
    valor = _estado("next_post_at")
    return int(valor) if valor else None


def definir_proximo_post(timestamp):
    _definir_estado("next_post_at", int(timestamp))


def link_loja_site_sincronizado(data, fonte):
    return _estado(f"link_loja_site:{str(fonte).lower()}") == str(data)


def marcar_link_loja_site_sincronizado(data, fonte):
    _definir_estado(f"link_loja_site:{str(fonte).lower()}", str(data))


def campanha_enviada(data, campanha, canal="Telegram"):
    chave = f"campanha:{str(campanha).lower()}:{str(canal).lower()}"
    return _estado(chave) == str(data)


def marcar_campanha_enviada(data, campanha, canal="Telegram"):
    chave = f"campanha:{str(campanha).lower()}:{str(canal).lower()}"
    _definir_estado(chave, str(data))


def salvar_cupom(cupom: dict, agora=None):
    """Atualiza um cupom oficial visto na API e devolve seu identificador."""
    momento = int(agora or time.time())
    with _conn() as con:
        con.execute(
            "INSERT INTO cupons_ativos(id,fonte,codigo,titulo,tipo,condicao,destino,ativo_em,expira_em,visto_em) "
            "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "titulo=excluded.titulo,tipo=excluded.tipo,condicao=excluded.condicao,destino=excluded.destino,ativo_em=excluded.ativo_em,"
            "expira_em=excluded.expira_em,visto_em=excluded.visto_em",
            (str(cupom["id"]), str(cupom["fonte"]), str(cupom.get("codigo") or ""),
             str(cupom.get("titulo") or cupom.get("codigo") or "Voucher"),
             str(cupom.get("tipo") or ("codigo" if cupom.get("codigo") else "voucher")),
             str(cupom.get("condicao") or ""), str(cupom["destino"]),
             cupom.get("ativo_em"), cupom.get("expira_em"), momento),
        )
    return str(cupom["id"])


def cupom_pendente(cupom_id, canal):
    with _conn() as con:
        row = con.execute("SELECT sucesso FROM entregas_cupom WHERE id=? AND canal=?",
                          (str(cupom_id), str(canal))).fetchone()
    return not row or not bool(row[0])


def registrar_entrega_cupom(cupom_id, canal, sucesso, agora=None):
    with _conn() as con:
        con.execute(
            "INSERT INTO entregas_cupom(id,canal,sucesso,entregue_em) VALUES(?,?,?,?) "
            "ON CONFLICT(id,canal) DO UPDATE SET sucesso=excluded.sucesso,entregue_em=excluded.entregue_em",
            (str(cupom_id), str(canal), int(bool(sucesso)), int(agora or time.time())),
        )


def cupons_ativos(limite=5, agora=None):
    """Cupons que ainda nao expiraram (ou sem data oficial de expiracao)."""
    momento = int(agora or time.time())
    with _conn() as con:
        linhas = con.execute(
            "SELECT id,fonte,codigo,titulo,tipo,condicao,destino,ativo_em,expira_em FROM cupons_ativos "
            "WHERE expira_em IS NULL OR expira_em>? ORDER BY "
            "CASE WHEN expira_em IS NULL THEN 1 ELSE 0 END, expira_em ASC, visto_em DESC LIMIT ?",
            (momento, int(limite)),
        ).fetchall()
    campos = ("id", "fonte", "codigo", "titulo", "tipo", "condicao", "destino", "ativo_em", "expira_em")
    return [dict(zip(campos, linha)) for linha in linhas]


def resumo_cupons_enviado(data_hora):
    return _estado("resumo_cupons:" + str(data_hora)) == "1"


def marcar_resumo_cupons_enviado(data_hora):
    _definir_estado("resumo_cupons:" + str(data_hora), "1")


def minutos_desde_ultima_postagem():
    with _conn() as con:
        row = con.execute("SELECT MAX(postada_em) FROM postadas").fetchone()
    return None if not row[0] else (int(time.time()) - int(row[0])) / 60


def resumo_periodo(inicio, fim):
    with _conn() as con:
        return con.execute("SELECT canal,sucesso,fonte,COUNT(*) FROM entregas_log WHERE entregue_em>=? AND entregue_em<? GROUP BY canal,sucesso,fonte", (int(inicio), int(fim))).fetchall()


def publicacoes_por_fonte(inicio, fim):
    with _conn() as con:
        return dict(con.execute(
            "SELECT COALESCE(fonte,'Desconhecida'),COUNT(DISTINCT id) "
            "FROM entregas_log WHERE sucesso=1 AND entregue_em>=? AND entregue_em<? "
            "GROUP BY fonte", (int(inicio), int(fim))
        ).fetchall())


def publicacoes_por_fonte_canal(inicio, fim):
    with _conn() as con:
        linhas = con.execute(
            "SELECT COALESCE(fonte,'Desconhecida'),canal,COUNT(DISTINCT id) "
            "FROM entregas_log WHERE sucesso=1 AND entregue_em>=? AND entregue_em<? "
            "GROUP BY fonte,canal", (int(inicio), int(fim))
        ).fetchall()
    resultado = {}
    for fonte, canal, quantidade in linhas:
        resultado.setdefault(fonte, {})[canal] = int(quantidade)
    return resultado


def metadados_ofertas(ids):
    ids = [str(i) for i in ids if i]
    if not ids:
        return {}
    marcas = ",".join("?" for _ in ids)
    with _conn() as con:
        linhas = con.execute(
            f"SELECT id,preco,desconto,fonte,titulo,categoria,experimento,variante FROM postadas "
            f"WHERE id IN ({marcas})", ids
        ).fetchall()
    return {linha[0]: {
        "preco": linha[1], "desconto": linha[2], "fonte": linha[3],
        "titulo": linha[4], "categoria": linha[5],
        "experimento": linha[6], "variante": linha[7],
    } for linha in linhas}


def ofertas_recentes(limite=3):
    with _conn() as con:
        linhas = con.execute(
            "SELECT id,fonte,titulo,categoria,postada_em FROM postadas "
            "WHERE titulo IS NOT NULL ORDER BY postada_em DESC LIMIT ?", (int(limite),)
        ).fetchall()
    return [{"oferta_id": r[0], "fonte": r[1], "titulo": r[2],
             "categoria": r[3], "postada_em": r[4]} for r in linhas]


def ofertas_desde(dias=7, agora=None):
    """Histórico editorial para bloquear o mesmo produto com outro itemId."""
    limite = int(agora or time.time()) - max(0, int(dias)) * 86400
    with _conn() as con:
        linhas = con.execute(
            "SELECT id,fonte,titulo,categoria,postada_em,preco,loja "
            "FROM postadas WHERE titulo IS NOT NULL AND postada_em>=? "
            "ORDER BY postada_em DESC", (limite,)
        ).fetchall()
    campos = ("oferta_id", "fonte", "titulo", "categoria", "postada_em",
              "preco", "loja")
    return [dict(zip(campos, linha)) for linha in linhas]


def posts_hoje(agora=None):
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(*) FROM postadas WHERE postada_em>=?",
            (_inicio_do_dia(agora),),
        ).fetchone()[0])


def posts_canal_hoje(canal, agora=None):
    """Conta ofertas distintas entregues hoje a um canal especifico."""
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(DISTINCT id) FROM entregas_log WHERE canal=? "
            "AND sucesso=1 AND entregue_em>=?",
            (str(canal), _inicio_do_dia(agora)),
        ).fetchone()[0])


def posts_canal_desde(canal, inicio):
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(DISTINCT id) FROM entregas_log WHERE canal=? "
            "AND sucesso=1 AND entregue_em>=?", (str(canal), int(inicio))
        ).fetchone()[0])


def posts_canal_entre(canal, inicio, fim):
    with _conn() as con:
        return int(con.execute(
            "SELECT COUNT(DISTINCT id) FROM entregas_log WHERE canal=? "
            "AND sucesso=1 AND entregue_em>=? AND entregue_em<?",
            (str(canal), int(inicio), int(fim))
        ).fetchone()[0])


def posts_por_loja_hoje(agora=None):
    with _conn() as con:
        linhas = con.execute(
            "SELECT loja,COUNT(*) FROM postadas WHERE postada_em>=? "
            "AND loja IS NOT NULL AND TRIM(loja)<>'' GROUP BY loja",
            (_inicio_do_dia(agora),),
        ).fetchall()
    return {str(loja).casefold(): int(total) for loja, total in linhas}


def registrar_vendas_produtos(ofertas, agora=None, janela_dias=7):
    """Guarda um retrato diário e devolve crescimento observado em 1 e N dias.

    `sales` não informa um período na API. Por isso os deltas só são calculados
    contra retratos realmente observados, nunca apresentados como dado oficial.
    """
    momento = int(agora or time.time())
    data = datetime.datetime.fromtimestamp(momento).date().isoformat()
    janela_dias = max(1, int(janela_dias))
    resultado = {}
    with _conn() as con:
        for oferta in ofertas or []:
            fonte = str(oferta.get("fonte") or "")
            oferta_id = str(oferta.get("oferta_id") or "")
            vendas = oferta.get("sales")
            if not (fonte and oferta_id) or vendas is None:
                continue
            try:
                vendas = max(0, int(vendas))
            except (TypeError, ValueError):
                continue
            deltas = {}
            for nome, dias in (("24h", 1), ("janela", janela_dias)):
                alvo = (datetime.datetime.fromtimestamp(momento).date()
                        - datetime.timedelta(days=dias)).isoformat()
                linha = con.execute(
                    "SELECT vendas FROM vendas_produto_diarias WHERE fonte=? "
                    "AND oferta_id=? AND data<=? ORDER BY data DESC LIMIT 1",
                    (fonte, oferta_id, alvo),
                ).fetchone()
                deltas[nome] = max(0, vendas - int(linha[0])) if linha else None
            resultado[(fonte, oferta_id)] = deltas
            con.execute(
                "INSERT INTO vendas_produto_diarias(data,fonte,oferta_id,vendas,observado_em) "
                "VALUES(?,?,?,?,?) ON CONFLICT(data,fonte,oferta_id) DO UPDATE SET "
                "vendas=MAX(vendas,excluded.vendas),observado_em=excluded.observado_em",
                (data, fonte, oferta_id, vendas, momento),
            )
        con.execute(
            "DELETE FROM vendas_produto_diarias WHERE data<?",
            ((datetime.datetime.fromtimestamp(momento).date()
              - datetime.timedelta(days=max(8, janela_dias + 2))).isoformat(),),
        )
    return resultado


def falhas_consecutivas(canal, limite=20):
    with _conn() as con:
        linhas = con.execute(
            "SELECT sucesso FROM entregas_log WHERE canal=? "
            "ORDER BY entregue_em DESC LIMIT ?", (str(canal), int(limite))
        ).fetchall()
    total = 0
    for (sucesso,) in linhas:
        if sucesso:
            break
        total += 1
    return total


def falha_canal_ja_alertada(canal):
    """Indica se a sequência atual de falhas já gerou um alerta privado."""
    return _estado(f"alerta_falha_canal:{str(canal).lower()}") == "1"


def marcar_falha_canal_alertada(canal):
    _definir_estado(f"alerta_falha_canal:{str(canal).lower()}", "1")


def limpar_alerta_falha_canal(canal):
    """Libera um novo alerta depois que o canal volta a publicar."""
    _definir_estado(f"alerta_falha_canal:{str(canal).lower()}", "0")


def salvar_desempenho(fonte, produtos, agora=None):
    """Substitui o retrato agregado de 7 dias; não recebe IDs de pedidos."""
    momento = int(agora or time.time())
    with _conn() as con:
        con.execute("DELETE FROM desempenho WHERE fonte=?", (str(fonte),))
        for produto in produtos or []:
            oferta_id = str(produto.get("oferta_id") or "").strip()
            if not oferta_id:
                continue
            comissao = produto.get("comissao", 0)
            if isinstance(produto.get("comissoes"), dict):
                comissao = sum(float(v or 0) for v in produto["comissoes"].values())
            con.execute(
                "INSERT INTO desempenho(fonte,oferta_id,categoria,conversoes,"
                "quantidade,comissao,atualizado_em) VALUES(?,?,?,?,?,?,?)",
                (str(fonte), oferta_id,
                 produto.get("categoria") or "outros",
                 int(produto.get("conversoes") or 0),
                 int(produto.get("quantidade") or 0), float(comissao or 0), momento),
            )


def multiplicador_desempenho(oferta):
    """Atalho para a mesma regra comercial usada na fila em lote."""
    chave = (str(oferta.get("fonte") or ""), str(oferta.get("oferta_id") or ""))
    return multiplicadores_desempenho([oferta]).get(chave, 1.0)


def multiplicadores_desempenho(ofertas):
    """Pontuação bayesiana limitada por conversão, comissão, recência e cancelamento."""
    ofertas = list(ofertas or [])
    fontes = sorted({str(o.get("fonte") or "") for o in ofertas if o.get("fonte")})
    if not fontes:
        return {}
    marcas = ",".join("?" for _ in fontes)
    limite = int(time.time()) - 7 * 86400
    with _conn() as con:
        linhas = con.execute(
            f"SELECT fonte,oferta_id,categoria,conversoes,comissao,atualizado_em "
            f"FROM desempenho "
            f"WHERE fonte IN ({marcas})", fontes
        ).fetchall()
        posts = dict(con.execute(
            f"SELECT fonte,COUNT(DISTINCT id) FROM entregas_log "
            f"WHERE sucesso=1 AND entregue_em>=? AND fonte IN ({marcas}) "
            f"GROUP BY fonte", (limite, *fontes)
        ).fetchall())
        posts_categoria = {(r[0], r[1] or "outros"): int(r[2]) for r in con.execute(
            f"SELECT fonte,COALESCE(categoria,'outros'),COUNT(DISTINCT id) "
            f"FROM postadas WHERE postada_em>=? AND fonte IN ({marcas}) "
            f"GROUP BY fonte,categoria", (limite, *fontes)
        ).fetchall()}
        cancelamentos = {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in con.execute(
            "SELECT fonte,SUM(conversoes),SUM(canceladas) FROM metricas_diarias "
            "WHERE canal='' AND data>=? GROUP BY fonte",
            ((datetime.date.today() - datetime.timedelta(days=30)).isoformat(),)
        ).fetchall()}

    exatas = {}
    categorias = {}
    totais = {}
    comissoes_categoria = {}
    comissoes_fonte = {}
    atualizacoes = {}
    for fonte, oferta_id, categoria, conversoes, comissao, atualizado_em in linhas:
        quantidade = int(conversoes or 0)
        exatas[(fonte, oferta_id)] = quantidade
        categorias[(fonte, categoria or "outros")] = (
            categorias.get((fonte, categoria or "outros"), 0) + quantidade
        )
        totais[fonte] = totais.get(fonte, 0) + quantidade
        chave_categoria = (fonte, categoria or "outros")
        comissoes_categoria[chave_categoria] = (
            comissoes_categoria.get(chave_categoria, 0.0) + float(comissao or 0)
        )
        comissoes_fonte[fonte] = comissoes_fonte.get(fonte, 0.0) + float(comissao or 0)
        atualizacoes[fonte] = max(atualizacoes.get(fonte, 0), int(atualizado_em or 0))

    total_posts = sum(int(v or 0) for v in posts.values())
    total_conversoes = sum(totais.values())
    total_comissao = sum(comissoes_fonte.values())
    taxa_base = (total_conversoes + 1.0) / (total_posts + 20.0)
    comissao_base = total_comissao / total_posts if total_posts else 0.0
    agora = int(time.time())

    resultado = {}
    for oferta in ofertas:
        fonte = str(oferta.get("fonte") or "")
        oferta_id = str(oferta.get("oferta_id") or "")
        categoria = str(oferta.get("categoria") or "outros")
        import config
        if agora - atualizacoes.get(fonte, 0) > config.DESEMPENHO_MAX_DIAS * 86400:
            resultado[(fonte, oferta_id)] = 1.0
            continue
        quantidade_posts = int(posts.get(fonte, 0))
        conversoes_fonte = totais.get(fonte, 0)
        taxa_fonte = (conversoes_fonte + taxa_base * 12) / (quantidade_posts + 12)
        fator = max(0.85, min(1.15, taxa_fonte / taxa_base)) if taxa_base else 1.0

        chave_categoria = (fonte, categoria)
        qtd_categoria = posts_categoria.get(chave_categoria, 0)
        conv_categoria = categorias.get(chave_categoria, 0)
        if qtd_categoria >= 3:
            taxa_categoria = (conv_categoria + taxa_base * 8) / (qtd_categoria + 8)
            fator *= max(0.90, min(1.12, taxa_categoria / taxa_base))

        if comissao_base and quantidade_posts >= 5:
            media_comissao = comissoes_fonte.get(fonte, 0.0) / quantidade_posts
            fator *= max(0.95, min(1.12, media_comissao / comissao_base))
        fator *= 1 + min(0.15, math.log1p(exatas.get((fonte, oferta_id), 0)) * 0.07)

        conversoes_30d, canceladas_30d = cancelamentos.get(fonte, (0, 0))
        total_resultados = conversoes_30d + canceladas_30d
        if total_resultados >= 5:
            fator *= max(0.82, 1 - (canceladas_30d / total_resultados) * 0.35)
        resultado[(fonte, oferta_id)] = round(max(0.75, min(1.50, fator)), 3)
    return resultado


def salvar_metricas_diarias(data, fonte, resumo, posts_por_canal=None,
                            cliques_por_canal=None, posts_total=None, agora=None):
    """Guarda séries agregadas; nunca recebe pedido ou comprador."""
    momento = int(agora or time.time())
    posts_por_canal = posts_por_canal or {}
    cliques_por_canal = cliques_por_canal or {}
    if fonte == "AliExpress":
        conversoes = int(resumo.get("pagos", 0)) + int(resumo.get("confirmados", 0))
        canceladas = int(resumo.get("invalidos", 0))
        comissao = sum(float(v or 0) for v in (resumo.get("comissoes") or {}).values())
        por_canal_comissao = {
            canal: sum(float(v or 0) for v in moedas.values())
            for canal, moedas in (resumo.get("comissoes_por_tracking") or {}).items()
        }
    else:
        conversoes = int(resumo.get("pendentes", 0)) + int(resumo.get("concluidas", 0))
        canceladas = int(resumo.get("canceladas", 0))
        comissao = float(resumo.get("comissao_estimada", 0)) + float(
            resumo.get("comissao_liquida", 0)
        )
        por_canal_comissao = {
            canal: float(valor or 0)
            for canal, valor in (resumo.get("comissao_por_tracking") or {}).items()
        }
    por_tracking = resumo.get("por_tracking") or {}
    canais = set(posts_por_canal) | set(por_tracking) | set(cliques_por_canal)
    with _conn() as con:
        linhas = [("", int(posts_total if posts_total is not None else
                            sum(posts_por_canal.values())), conversoes,
                   sum(int(p.get("quantidade") or 0) for p in resumo.get("produtos") or []),
                   comissao, canceladas, sum(cliques_por_canal.values()))]
        linhas.extend((canal, int(posts_por_canal.get(canal, 0)),
                       int(por_tracking.get(canal, 0)), 0,
                       float(por_canal_comissao.get(canal, 0)), 0,
                       int(cliques_por_canal.get(canal, 0))) for canal in canais)
        for canal, posts_qtd, conv_qtd, quantidade, valor, canc, cliques in linhas:
            con.execute(
                "INSERT INTO metricas_diarias(data,fonte,canal,posts,conversoes,"
                "quantidade,comissao,canceladas,cliques,atualizado_em) "
                "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(data,fonte,canal) DO UPDATE SET "
                "posts=excluded.posts,conversoes=excluded.conversoes,"
                "quantidade=excluded.quantidade,comissao=excluded.comissao,"
                "canceladas=excluded.canceladas,cliques=excluded.cliques,"
                "atualizado_em=excluded.atualizado_em",
                (str(data), fonte, canal, posts_qtd, conv_qtd, quantidade,
                 valor, canc, cliques, momento),
            )
        for categoria, quantidade in (resumo.get("por_categoria") or {}).items():
            con.execute(
                "INSERT INTO metricas_categoria_diarias(data,fonte,categoria,"
                "conversoes,quantidade,atualizado_em) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(data,fonte,categoria) DO UPDATE SET "
                "conversoes=excluded.conversoes,quantidade=excluded.quantidade,"
                "atualizado_em=excluded.atualizado_em",
                (str(data), fonte, categoria, int(quantidade or 0),
                 int(quantidade or 0), momento),
            )
        corte = (datetime.date.fromisoformat(str(data)) - datetime.timedelta(days=180)).isoformat()
        con.execute("DELETE FROM metricas_diarias WHERE data<?", (corte,))
        con.execute("DELETE FROM metricas_categoria_diarias WHERE data<?", (corte,))
        con.execute("DELETE FROM experimentos_diarios WHERE data<?", (corte,))


def salvar_experimentos_diarios(data, fonte, produtos, inicio, fim, agora=None):
    momento = int(agora or time.time())
    produtos = produtos or []
    metas = metadados_ofertas(p.get("oferta_id") for p in produtos)
    agregados = {}
    with _conn() as con:
        for experimento, variante, posts in con.execute(
            "SELECT experimento,variante,COUNT(*) FROM postadas WHERE fonte=? "
            "AND postada_em>=? AND postada_em<? AND experimento IS NOT NULL "
            "GROUP BY experimento,variante", (fonte, int(inicio), int(fim))
        ).fetchall():
            agregados[(experimento, variante)] = [int(posts), 0, 0.0]
        for produto in produtos:
            meta = metas.get(str(produto.get("oferta_id")), {})
            experimento, variante = meta.get("experimento"), meta.get("variante")
            if not experimento or not variante:
                continue
            chave = (experimento, variante)
            agregado = agregados.setdefault(chave, [0, 0, 0.0])
            agregado[1] += int(produto.get("conversoes") or 0)
            valor = produto.get("comissao", 0)
            if isinstance(produto.get("comissoes"), dict):
                valor = sum(float(v or 0) for v in produto["comissoes"].values())
            agregado[2] += float(valor or 0)
        for (experimento, variante), valores in agregados.items():
            con.execute(
                "INSERT INTO experimentos_diarios(data,experimento,variante,fonte,"
                "posts,conversoes,comissao,atualizado_em) VALUES(?,?,?,?,?,?,?,?) "
                "ON CONFLICT(data,experimento,variante,fonte) DO UPDATE SET "
                "posts=excluded.posts,conversoes=excluded.conversoes,"
                "comissao=excluded.comissao,atualizado_em=excluded.atualizado_em",
                (str(data), experimento, variante, fonte, *valores, momento),
            )


def tendencias_diarias(hoje=None, dias=7):
    hoje = hoje or datetime.date.today()
    inicio_atual = (hoje - datetime.timedelta(days=dias)).isoformat()
    inicio_anterior = (hoje - datetime.timedelta(days=dias * 2)).isoformat()
    fim_atual = hoje.isoformat()
    with _conn() as con:
        linhas = con.execute(
            "SELECT fonte,CASE WHEN data>=? THEN 'atual' ELSE 'anterior' END,"
            "SUM(posts),SUM(conversoes),SUM(comissao),SUM(canceladas),COUNT(DISTINCT data) "
            "FROM metricas_diarias WHERE canal='' AND data>=? AND data<? "
            "GROUP BY fonte,CASE WHEN data>=? THEN 'atual' ELSE 'anterior' END",
            (inicio_atual, inicio_anterior, fim_atual, inicio_atual),
        ).fetchall()
    resultado = {}
    for fonte, periodo, posts, conversoes, comissao, canceladas, qtd_dias in linhas:
        resultado.setdefault(fonte, {})[periodo] = {
            "posts": int(posts or 0), "conversoes": int(conversoes or 0),
            "comissao": float(comissao or 0), "canceladas": int(canceladas or 0),
            "dias": int(qtd_dias or 0),
        }
    return resultado


def resumo_experimentos(hoje=None, dias=30):
    hoje = hoje or datetime.date.today()
    inicio = (hoje - datetime.timedelta(days=dias)).isoformat()
    with _conn() as con:
        linhas = con.execute(
            "SELECT experimento,variante,SUM(posts),SUM(conversoes),SUM(comissao) "
            "FROM experimentos_diarios WHERE data>=? GROUP BY experimento,variante",
            (inicio,),
        ).fetchall()
    return [{"experimento": r[0], "variante": r[1], "posts": int(r[2] or 0),
             "conversoes": int(r[3] or 0), "comissao": float(r[4] or 0)}
            for r in linhas]


def ofertas_sem_conversao(inicio, convertidas, limite=3):
    convertidas = {str(i) for i in convertidas}
    with _conn() as con:
        linhas = con.execute(
            "SELECT id,fonte,titulo FROM postadas WHERE postada_em>=? "
            "AND titulo IS NOT NULL ORDER BY postada_em DESC", (int(inicio),)
        ).fetchall()
    return [linha for linha in linhas if linha[0] not in convertidas][:limite]


def relatorio_enviado(data):
    return _estado("ultimo_relatorio") == data


def marcar_relatorio_enviado(data):
    _definir_estado("ultimo_relatorio", data)


def bom_dia_enviado(data, canal):
    return _estado(f"ultimo_bom_dia_{canal.lower()}") == data


def marcar_bom_dia_enviado(data, canal):
    _definir_estado(f"ultimo_bom_dia_{canal.lower()}", data)
