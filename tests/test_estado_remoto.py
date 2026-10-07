import base64
import io
import os
import sqlite3
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

import estado_remoto


class EstadoRemotoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        raiz = Path(self.tmp.name)
        self.patches = [
            patch.object(estado_remoto, "DB", raiz / "postadas.db"),
            patch.object(estado_remoto, "DB_CRIPTOGRAFADO", raiz / "postadas.db.enc"),
            patch.object(estado_remoto, "HASH_INICIAL", raiz / ".hash"),
            patch.object(estado_remoto, "SEM_REMOTO", raiz / ".sem"),
        ]
        for remendo in self.patches:
            remendo.start()
        self.chave = base64.urlsafe_b64encode(b"k" * 32).decode("ascii").rstrip("=")

    def tearDown(self):
        for remendo in reversed(self.patches):
            remendo.stop()
        self.tmp.cleanup()

    def _sqlite(self):
        origem = Path(self.tmp.name) / "origem.db"
        with sqlite3.connect(origem) as con:
            con.execute("CREATE TABLE estado(chave TEXT)")
            con.execute("INSERT INTO estado VALUES('ok')")
        return origem.read_bytes()

    def _zip_sqlite(self, criptografado=True):
        bruto = self._sqlite()
        nome = "postadas.db.enc" if criptografado else "postadas.db"
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            conteudo = estado_remoto._criptografar(bruto) if criptografado else bruto
        dados = io.BytesIO()
        with zipfile.ZipFile(dados, "w") as arquivo:
            arquivo.writestr(nome, conteudo)
        return dados.getvalue()

    def test_restaura_snapshot_autenticado_e_valida_sqlite(self):
        lista = Mock()
        lista.json.return_value = {"artifacts": [{
            "created_at": "2026-08-22T10:00:00Z", "expired": False,
            "archive_download_url": "https://api.github.com/arquivo",
        }]}
        lista.raise_for_status.return_value = None
        redirecao = Mock(status_code=302,
                         headers={"Location": "https://objects.githubusercontent.com/estado.zip"})
        download = Mock()
        download.iter_content.return_value = [self._zip_sqlite()]
        download.raise_for_status.return_value = None
        sessao = Mock()
        sessao.get.side_effect = [lista, redirecao, download]
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo",
                                     "BOT_STATE_KEY": self.chave}):
            self.assertTrue(estado_remoto.restaurar(True, sessao))
        with sqlite3.connect(estado_remoto.DB) as con:
            self.assertEqual("ok", con.execute("SELECT chave FROM estado").fetchone()[0])
        self.assertNotIn("Authorization", sessao.get.call_args_list[-1].kwargs.get("headers", {}))

    def test_prepara_snapshot_criptografado_e_autenticado(self):
        estado_remoto.DB.write_bytes(self._sqlite())
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            self.assertTrue(estado_remoto.preparar_upload())
            protegido = estado_remoto.DB_CRIPTOGRAFADO.read_bytes()
            self.assertNotIn(b"SQLite format 3", protegido)
            self.assertEqual(estado_remoto.DB.read_bytes(), estado_remoto._descriptografar(protegido))

    def test_salva_snapshot_em_issue_sem_actions_storage(self):
        estado_remoto.DB.write_bytes(self._sqlite())
        lista = Mock()
        lista.json.return_value = []
        lista.raise_for_status.return_value = None
        criado = Mock()
        criado.json.return_value = {"id": 123}
        criado.raise_for_status.return_value = None
        atualizado = Mock()
        atualizado.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=lista),
                      post=Mock(return_value=criado),
                      patch=Mock(return_value=atualizado))
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave, "BOT_STATE_ISSUE": "2",
        }):
            self.assertTrue(estado_remoto.salvar_issue(sessao))
        self.assertGreaterEqual(sessao.post.call_count, 1)
        self.assertIn("bot-state-manifest:v1", sessao.patch.call_args.kwargs["json"]["body"])
        sessao.delete.assert_not_called()

    def test_restaura_snapshot_da_issue_antes_do_artefato(self):
        bruto = self._sqlite()
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            protegido = estado_remoto._criptografar(bruto)
        identificador = estado_remoto.hashlib.sha256(protegido).hexdigest()
        codificado = base64.b64encode(protegido).decode("ascii")
        issue = Mock(status_code=200)
        issue.json.return_value = {"body": (
            f"<!-- bot-state-manifest:v1:{identificador}:1:{len(protegido)} -->"
        )}
        issue.raise_for_status.return_value = None
        comentarios = Mock()
        comentarios.json.return_value = [{"body": (
            f"<!-- bot-state-part:v1:{identificador}:1/1 -->\n{codificado}"
        )}]
        comentarios.raise_for_status.return_value = None
        sessao = Mock()
        sessao.get.side_effect = [issue, comentarios]
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave, "BOT_STATE_ISSUE": "2",
        }):
            self.assertTrue(estado_remoto.restaurar(True, sessao))
        self.assertEqual(bruto, estado_remoto.DB.read_bytes())
        self.assertEqual(2, sessao.get.call_count)

    def test_salva_snapshot_em_release_rascunho_sem_notificacoes(self):
        estado_remoto.DB.write_bytes(self._sqlite())
        lista = Mock()
        lista.json.return_value = [{"id": 7, "tag_name": "bot-state-v1", "assets": []}]
        lista.raise_for_status.return_value = None
        upload = Mock()
        upload.json.return_value = {"id": 9, "name": "novo.enc"}
        upload.raise_for_status.return_value = None
        atualizado = Mock()
        atualizado.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=lista),
                      post=Mock(return_value=upload),
                      patch=Mock(return_value=atualizado))
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave,
            "BOT_STATE_RELEASE_TAG": "bot-state-v1",
        }):
            self.assertTrue(estado_remoto.salvar_release(sessao))
        self.assertIn("uploads.github.com", sessao.post.call_args.args[0])
        manifesto = sessao.patch.call_args.kwargs["json"]["body"]
        self.assertIn("bot-state-release:v1", manifesto)
        self.assertTrue(sessao.patch.call_args.kwargs["json"]["draft"])

    def test_restaura_snapshot_da_release_rascunho(self):
        bruto = self._sqlite()
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            protegido = estado_remoto._criptografar(bruto)
        identificador = estado_remoto.hashlib.sha256(protegido).hexdigest()
        nome = f"bot-state-{identificador[:16]}.enc"
        lista = Mock()
        lista.json.return_value = [{
            "id": 7, "tag_name": "bot-state-v1",
            "body": f"<!-- bot-state-release:v1:{identificador}:{len(protegido)}:{nome} -->",
            "assets": [{"id": 9, "name": nome,
                        "url": "https://api.github.com/repos/dono/repo/releases/assets/9"}],
        }]
        lista.raise_for_status.return_value = None
        redirecao = Mock(status_code=302, headers={
            "Location": "https://objects.githubusercontent.com/estado.enc"
        })
        download = Mock()
        download.iter_content.return_value = [protegido]
        download.raise_for_status.return_value = None
        sessao = Mock()
        sessao.get.side_effect = [lista, redirecao, download]
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave,
            "BOT_STATE_RELEASE_TAG": "bot-state-v1",
        }):
            self.assertTrue(estado_remoto.restaurar(True, sessao))
        self.assertEqual(bruto, estado_remoto.DB.read_bytes())

    def test_salva_snapshot_em_branch_orfa_sem_historico_crescente(self):
        estado_remoto.DB.write_bytes(self._sqlite())
        respostas = []
        for sha in ("a" * 40, "b" * 40, "c" * 40):
            resposta = Mock()
            resposta.json.return_value = {"sha": sha}
            resposta.raise_for_status.return_value = None
            respostas.append(resposta)
        ref_inexistente = Mock(status_code=404)
        ref_criada = Mock()
        ref_criada.raise_for_status.return_value = None
        sessao = Mock()
        sessao.post.side_effect = [*respostas, ref_criada]
        sessao.get.return_value = ref_inexistente
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave, "BOT_STATE_REF": "bot-state",
        }):
            self.assertTrue(estado_remoto.salvar_branch(sessao))
        commit = sessao.post.call_args_list[2].kwargs["json"]
        self.assertNotIn("parents", commit)
        ref = sessao.post.call_args_list[3].kwargs["json"]
        self.assertEqual("refs/heads/bot-state", ref["ref"])

    def test_restaura_snapshot_da_branch_criptografada(self):
        bruto = self._sqlite()
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            protegido = estado_remoto._criptografar(bruto)
        respostas = []
        for corpo in (
            {"object": {"sha": "a" * 40}},
            {"tree": {"sha": "b" * 40}},
            {"tree": [{"path": "postadas.db.enc", "type": "blob",
                       "sha": "c" * 40}]},
            {"encoding": "base64", "size": len(protegido),
             "content": base64.b64encode(protegido).decode("ascii")},
        ):
            resposta = Mock(status_code=200)
            resposta.json.return_value = corpo
            resposta.raise_for_status.return_value = None
            respostas.append(resposta)
        sessao = Mock()
        sessao.get.side_effect = respostas
        with patch.dict(os.environ, {
            "GITHUB_REPOSITORY": "dono/repo", "GH_TOKEN": "segredo",
            "BOT_STATE_KEY": self.chave, "BOT_STATE_REF": "bot-state",
        }):
            self.assertTrue(estado_remoto.restaurar(True, sessao))
        self.assertEqual(bruto, estado_remoto.DB.read_bytes())

    def test_compacta_antes_de_criptografar_e_aceita_formato_anterior(self):
        bruto = self._sqlite() + b"repeticao" * 100_000
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            novo = estado_remoto._criptografar(bruto)
            self.assertTrue(novo.startswith(estado_remoto.MAGIA_COMPACTADA))
            self.assertLess(len(novo), len(bruto) // 10)
            self.assertEqual(bruto, estado_remoto._descriptografar(novo))
            nonce = b"n" * 12
            antigo = estado_remoto.MAGIA + nonce + estado_remoto.AESGCM(
                estado_remoto._chave_estado()
            ).encrypt(nonce, bruto, estado_remoto.CONTEXTO)
            self.assertEqual(bruto, estado_remoto._descriptografar(antigo))

    def test_rejeita_descompactacao_acima_do_limite(self):
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}), \
             patch.object(estado_remoto, "MAX_BANCO", 100):
            protegido = estado_remoto._criptografar(b"a" * 101)
            with self.assertRaisesRegex(RuntimeError, "excede o limite"):
                estado_remoto._descriptografar(protegido)

    def test_rejeita_snapshot_sem_criptografia(self):
        lista = Mock()
        lista.json.return_value = {"artifacts": [{
            "created_at": "2026-08-22T10:00:00Z", "expired": False,
            "archive_download_url": "https://api.github.com/arquivo",
        }]}
        lista.raise_for_status.return_value = None
        redirecao = Mock(status_code=302,
                         headers={"Location": "https://objects.githubusercontent.com/estado.zip"})
        download = Mock()
        download.iter_content.return_value = [self._zip_sqlite(criptografado=False)]
        download.raise_for_status.return_value = None
        sessao = Mock()
        sessao.get.side_effect = [lista, redirecao, download]
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo",
                                     "BOT_STATE_KEY": self.chave}):
            with self.assertRaisesRegex(RuntimeError, "nao esta criptografado"):
                estado_remoto.restaurar(True, sessao)

    def test_modo_obrigatorio_falha_sem_snapshot(self):
        resposta = Mock()
        resposta.json.return_value = {"artifacts": []}
        resposta.raise_for_status.return_value = None
        sessao = Mock(get=Mock(return_value=resposta))
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo"}):
            with self.assertRaises(RuntimeError):
                estado_remoto.restaurar(True, sessao)

    def test_estado_maior_que_limite_antigo_continua_valido(self):
        origem = Path(self.tmp.name) / "grande.db"
        with sqlite3.connect(origem) as con:
            con.execute("CREATE TABLE dados(valor BLOB)")
            con.execute("INSERT INTO dados VALUES(?)", (os.urandom(2_100_000),))
        estado_remoto.DB.write_bytes(origem.read_bytes())
        with patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            self.assertTrue(estado_remoto.preparar_upload())
        self.assertGreater(estado_remoto.DB_CRIPTOGRAFADO.stat().st_size, 2_000_000)

    def test_compactacao_remove_historico_antigo(self):
        agora = int(time.time())
        with sqlite3.connect(estado_remoto.DB) as con:
            con.execute("CREATE TABLE entregas_log(id TEXT, entregue_em INTEGER)")
            con.execute("CREATE TABLE eventos(id INTEGER, ocorrido_em INTEGER)")
            con.execute("INSERT INTO entregas_log VALUES('antiga',?)", (agora - 181 * 86400,))
            con.execute("INSERT INTO entregas_log VALUES('nova',?)", (agora,))
            con.execute("INSERT INTO eventos VALUES(1,?)", (agora - 91 * 86400,))
        estado_remoto._compactar_estado(estado_remoto.DB, agora)
        with sqlite3.connect(estado_remoto.DB) as con:
            self.assertEqual([("nova",)], con.execute(
                "SELECT id FROM entregas_log ORDER BY id"
            ).fetchall())
            self.assertEqual(0, con.execute("SELECT COUNT(*) FROM eventos").fetchone()[0])

    def test_compactacao_limita_log_sem_apagar_estado_de_entrega(self):
        agora = int(time.time())
        with sqlite3.connect(estado_remoto.DB) as con:
            con.execute("CREATE TABLE entregas_log(id TEXT, entregue_em INTEGER)")
            con.execute("CREATE TABLE entregas(id TEXT, entregue_em INTEGER)")
            con.executemany("INSERT INTO entregas_log VALUES(?,?)", [
                ("mais_antiga", agora - 4), ("antiga", agora - 3),
                ("recente", agora - 2), ("mais_recente", agora - 1),
            ])
            con.execute("INSERT INTO entregas VALUES('mais_antiga',?)", (agora - 4,))
        with patch.object(estado_remoto, "MAX_ENTREGAS_LOG", 2):
            estado_remoto._compactar_estado(estado_remoto.DB, agora)
        with sqlite3.connect(estado_remoto.DB) as con:
            self.assertEqual([("recente",), ("mais_recente",)], con.execute(
                "SELECT id FROM entregas_log ORDER BY entregue_em"
            ).fetchall())
            self.assertEqual([("mais_antiga",)], con.execute(
                "SELECT id FROM entregas"
            ).fetchall())

    def test_compactacao_preserva_janela_de_vendas_e_remove_excedente(self):
        agora = int(time.time())
        hoje = estado_remoto.date.fromtimestamp(agora)
        with sqlite3.connect(estado_remoto.DB) as con:
            con.execute("CREATE TABLE vendas_produto_diarias(data TEXT, fonte TEXT, oferta_id TEXT)")
            for dias in (0, 7, 10, 44):
                data = (hoje - estado_remoto.timedelta(days=dias)).isoformat()
                con.execute("INSERT INTO vendas_produto_diarias VALUES(?,?,?)",
                            (data, "Shopee", str(dias)))
        with patch.object(estado_remoto.config, "PICO_JANELA_VENDAS_DIAS", 7):
            estado_remoto._compactar_estado(estado_remoto.DB, agora)
        with sqlite3.connect(estado_remoto.DB) as con:
            ids = {linha[0] for linha in con.execute(
                "SELECT oferta_id FROM vendas_produto_diarias"
            )}
        self.assertEqual({"0", "7"}, ids)

    def test_compactacao_limita_retratos_por_loja_e_preserva_mais_vendidos(self):
        hoje = estado_remoto.date.today().isoformat()
        with sqlite3.connect(estado_remoto.DB) as con:
            con.execute("CREATE TABLE vendas_produto_diarias("
                        "data TEXT, fonte TEXT, oferta_id TEXT, vendas INTEGER, "
                        "observado_em INTEGER)")
            for fonte in ("Shopee", "Mercado Livre"):
                con.executemany(
                    "INSERT INTO vendas_produto_diarias VALUES(?,?,?,?,?)",
                    ((hoje, fonte, str(indice), indice, indice)
                     for indice in range(8)),
                )
        with patch.object(estado_remoto, "MAX_VENDAS_DIA_FONTE", 3):
            estado_remoto._compactar_estado(estado_remoto.DB)
        with sqlite3.connect(estado_remoto.DB) as con:
            for fonte in ("Shopee", "Mercado Livre"):
                ids = {linha[0] for linha in con.execute(
                    "SELECT oferta_id FROM vendas_produto_diarias WHERE fonte=?",
                    (fonte,),
                )}
                self.assertEqual({"5", "6", "7"}, ids)

    def test_upload_recupera_espaco_sqlite_antes_de_validar_limite(self):
        with sqlite3.connect(estado_remoto.DB) as con:
            con.execute("CREATE TABLE lixo(valor BLOB)")
            con.execute("INSERT INTO lixo VALUES(?)", (os.urandom(1_000_000),))
            con.execute("DELETE FROM lixo")
        self.assertGreater(estado_remoto.DB.stat().st_size, 500_000)
        with patch.object(estado_remoto, "MAX_BANCO", 500_000), \
             patch.dict(os.environ, {"BOT_STATE_KEY": self.chave}):
            self.assertTrue(estado_remoto.preparar_upload())
        self.assertLess(estado_remoto.DB.stat().st_size, 500_000)

    def test_tenta_snapshot_anterior_quando_mais_novo_esta_corrompido(self):
        lista = Mock()
        lista.json.return_value = {"artifacts": [
            {"id": 2, "created_at": "2026-08-23T10:00:00Z", "expired": False,
             "archive_download_url": "https://api.github.com/ruim"},
            {"id": 1, "created_at": "2026-08-22T10:00:00Z", "expired": False,
             "archive_download_url": "https://api.github.com/bom"},
        ]}
        lista.raise_for_status.return_value = None
        redirecao_ruim = Mock(status_code=302,
                              headers={"Location": "https://objects.githubusercontent.com/ruim.zip"})
        download_ruim = Mock(headers={})
        download_ruim.iter_content.return_value = [b"nao-e-zip"]
        download_ruim.raise_for_status.return_value = None
        redirecao_boa = Mock(status_code=302,
                             headers={"Location": "https://objects.githubusercontent.com/bom.zip"})
        download_bom = Mock(headers={})
        download_bom.iter_content.return_value = [self._zip_sqlite()]
        download_bom.raise_for_status.return_value = None
        sessao = Mock()
        sessao.get.side_effect = [lista, redirecao_ruim, download_ruim,
                                  redirecao_boa, download_bom]
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo",
                                     "BOT_STATE_KEY": self.chave}):
            self.assertTrue(estado_remoto.restaurar(True, sessao))

    def test_limpeza_preserva_os_dois_snapshots_mais_novos(self):
        lista = Mock()
        lista.json.return_value = {"artifacts": [
            {"id": 1, "created_at": "2026-09-21T10:00:00Z"},
            {"id": 2, "created_at": "2026-09-21T09:00:00Z"},
            {"id": 3, "created_at": "2026-09-21T08:00:00Z"},
        ]}
        lista.raise_for_status.return_value = None
        exclusao = Mock(status_code=204)
        sessao = Mock(get=Mock(return_value=lista),
                      delete=Mock(return_value=exclusao))
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "dono/repo",
                                     "GH_TOKEN": "segredo"}):
            self.assertEqual(1, estado_remoto.limpar_artefatos_antigos(2, sessao))
        self.assertTrue(sessao.delete.call_args.args[0].endswith("/3"))
