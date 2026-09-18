import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import turnos


FUSO = ZoneInfo("America/Sao_Paulo")


class TurnosTest(unittest.TestCase):
    def test_cotas_somam_sessenta_e_concentram_publicacoes_a_noite(self):
        self.assertEqual([10, 20, 30], list(turnos.COTAS["Ofertas"].values()))
        self.assertEqual([5, 10, 15], list(turnos.COTAS["Facebook"].values()))
        self.assertEqual([8, 15, 22], list(turnos.COTAS["X"].values()))

    def test_madrugada_pertence_ao_turno_da_noite_anterior(self):
        turno, inicio, fim = turnos.janela(datetime(2026, 9, 19, 0, 30, tzinfo=FUSO))
        self.assertEqual("noite", turno)
        self.assertEqual(datetime(2026, 9, 18, 18, tzinfo=FUSO).timestamp(), inicio)
        self.assertEqual(datetime(2026, 9, 19, 1, tzinfo=FUSO).timestamp(), fim)

    def test_manha_tarde_noite_nao_se_sobrepoem(self):
        manha = turnos.janela(datetime(2026, 9, 18, 11, 59, tzinfo=FUSO))
        tarde = turnos.janela(datetime(2026, 9, 18, 12, tzinfo=FUSO))
        noite = turnos.janela(datetime(2026, 9, 18, 18, tzinfo=FUSO))
        self.assertEqual(manha[2], tarde[1])
        self.assertEqual(tarde[2], noite[1])
