"""Um alerta imediato por ticket por rodada do coletor.

Rodar: python3 -m unittest test_alerta_rodada.py -v
"""
import unittest
from unittest.mock import patch

import coletor


class TestAlertaPorRodada(unittest.TestCase):
    def setUp(self):
        coletor._ALERTADOS_NA_RODADA.clear()

    def test_mesmo_ticket_alerta_uma_vez(self):
        with patch.object(coletor.notificador, "alertar") as alertar:
            for _ in range(9):
                coletor._alertar("motivo", "alta", "t", "PRB-0071", "ITP", "m", "d")
            coletor._alertar("motivo", "alta", "t", "PRB-0099", "ITP", "m", "d")
        self.assertEqual(alertar.call_count, 2)

    def test_sem_ticket_sempre_alerta(self):
        with patch.object(coletor.notificador, "alertar") as alertar:
            coletor._alertar("motivo", "alta", "t", None, "ITP", "m", "d")
            coletor._alertar("motivo", "alta", "t", None, "ITP", "m", "d")
        self.assertEqual(alertar.call_count, 2)

    def test_falha_no_envio_nao_marca_como_enviado(self):
        with patch.object(coletor.notificador, "alertar", side_effect=[RuntimeError("smtp"), None]) as alertar:
            coletor._alertar("motivo", "alta", "t", "PRB-0071", "ITP", "m", "d")
            coletor._alertar("motivo", "alta", "t", "PRB-0071", "ITP", "m", "d")
        self.assertEqual(alertar.call_count, 2)


if __name__ == "__main__":
    unittest.main()
