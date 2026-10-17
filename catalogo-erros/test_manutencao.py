import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

import manutencao
from coletor import separar_manutencao

AGORA = datetime(2026, 10, 17, 13, 10, tzinfo=timezone.utc)


class JanelasTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.arquivo = os.path.join(self.dir, "manutencao.json")
        self.registro = os.path.join(self.dir, "ocorrencias.log")
        manutencao.REGISTRO = self.registro
        with open(self.arquivo, "w") as f:
            json.dump([
                {"inicio": "2026-10-17T13:00:00+00:00", "fim": "2026-10-17T13:20:00+00:00",
                 "motivo": "troca de senha", "alvos": ["itp_postgres"]},
                {"inicio": "2026-10-17T15:00:00+00:00", "fim": "2026-10-17T15:10:00+00:00",
                 "motivo": "geral", "alvos": []},
            ], f)
        self.janelas = manutencao.carregar(self.arquivo)

    def test_arquivo_ausente_ou_invalido_nao_suprime_nada(self):
        self.assertEqual(manutencao.carregar(os.path.join(self.dir, "nao-existe.json")), [])
        invalido = os.path.join(self.dir, "invalido.json")
        with open(invalido, "w") as f:
            f.write("{quebrado")
        self.assertEqual(manutencao.carregar(invalido), [])

    def test_cobre_so_alvo_e_horario_da_janela(self):
        self.assertIsNotNone(manutencao.janela_da_ocorrencia(self.janelas, "itp_postgres", AGORA))
        self.assertIsNone(manutencao.janela_da_ocorrencia(self.janelas, "erp_itp_backend", AGORA))
        self.assertIsNone(manutencao.janela_da_ocorrencia(self.janelas, "itp_postgres", AGORA + timedelta(minutes=30)))

    def test_janela_sem_alvos_cobre_tudo(self):
        quando = datetime(2026, 10, 17, 15, 5, tzinfo=timezone.utc)
        self.assertIsNotNone(manutencao.janela_da_ocorrencia(self.janelas, "aprxm_backend", quando))

    def test_separar_registra_suprimidas_e_devolve_o_resto(self):
        linhas = [
            "2026-10-17 13:11:05.000 UTC [1] FATAL:  permission denied for database \"aprxm_db\"",
            "2026-10-17 14:00:00.000 UTC [2] FATAL:  erro real fora da janela",
        ]
        from normalizador import extrair_timestamp
        restantes = separar_manutencao(self.janelas, "itp_postgres", linhas, extrair_timestamp, AGORA)
        self.assertEqual(restantes, [linhas[1]])
        with open(self.registro) as f:
            conteudo = f.read()
        self.assertIn("permission denied", conteudo)
        self.assertIn("troca de senha", conteudo)

    def test_sem_janelas_nao_altera_nada(self):
        linhas = ["2026-10-17 13:11:05.000 UTC [1] FATAL:  x"]
        self.assertEqual(separar_manutencao([], "itp_postgres", linhas, lambda _: AGORA, AGORA), linhas)


if __name__ == "__main__":
    unittest.main()
