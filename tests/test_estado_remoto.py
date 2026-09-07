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
