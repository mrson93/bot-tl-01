import unittest
from unittest.mock import Mock, patch

import requests

import captacao


class CaptacaoTest(unittest.TestCase):
    def test_rotacao_nao_altera_termo_fixo_quando_opcoes_vazias(self):
        self.assertEqual("celular", captacao.termo_da_rodada("celular", (), agora=999999))

    def test_rotacao_troca_termo_a_cada_seis_horas(self):
        opcoes = ("celular", "notebook", "fone")
        self.assertEqual("celular", captacao.termo_da_rodada(None, opcoes, agora=0))
        self.assertEqual("notebook", captacao.termo_da_rodada(None, opcoes, agora=21600))
        self.assertEqual("fone", captacao.termo_da_rodada(None, opcoes, agora=43200))
        self.assertEqual("celular", captacao.termo_da_rodada(None, opcoes, agora=64800))

    def test_repete_uma_vez_so_timeout_transitorio(self):
        buscar = Mock(side_effect=[requests.Timeout(), ["produto"]])
        with patch.object(captacao.time, "sleep") as esperar:
            self.assertEqual(["produto"], captacao.buscar_pagina_com_retry(buscar, 1))
        self.assertEqual(2, buscar.call_count)
        esperar.assert_called_once_with(1)

    def test_nao_repete_erro_de_pedido(self):
        resposta = Mock(status_code=400)
        erro = requests.HTTPError(response=resposta)
        buscar = Mock(side_effect=erro)
        with self.assertRaises(requests.HTTPError):
            captacao.buscar_pagina_com_retry(buscar, 1)
        self.assertEqual(1, buscar.call_count)


if __name__ == "__main__":
    unittest.main()
