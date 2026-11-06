"""Filtro de sessão manual do Postgres em coletor.extrair_erros.

Rodar: python3 -m unittest test_extrair_erros.py -v
"""
import unittest

from coletor import extrair_erros
from normalizador import normalizar

APP = '2026-09-29 02:19:59.928 UTC [253412] app=| ERROR:  column "x" does not exist'
MANUAL = '2026-09-29 02:19:59.928 UTC [253412] app=psql| ERROR:  column r.phone does not exist'
PGADMIN = '2026-09-29 02:19:59.928 UTC [253412] app=pgAdmin 4 - DB:aprxm_db| ERROR:  syntax error'
ANTIGO = '2026-09-29 02:19:59.928 UTC [253412] ERROR:  column "x" does not exist'


class TestExtrairErros(unittest.TestCase):
    def test_descarta_sessao_manual(self):
        self.assertEqual(extrair_erros(MANUAL + "\n" + PGADMIN), [])

    def test_erro_do_sistema_fica_com_a_mesma_assinatura_de_antes(self):
        self.assertEqual([normalizar(l) for l in extrair_erros(APP)], [normalizar(ANTIGO)])

    def test_marcador_com_banco_mantem_origem_e_assinatura(self):
        linha = '2026-11-06 02:19:59.928 UTC [253412] db=aprxm_db app=aprxm-backend| ERROR:  column "x" does not exist'
        self.assertEqual(extrair_erros(linha), [linha])
        self.assertEqual(normalizar(linha), normalizar(ANTIGO))
        manual = '2026-11-06 02:19:59.928 UTC [253412] db=aprxm_db app=psql| ERROR:  syntax error'
        self.assertEqual(extrair_erros(manual), [])

    def test_log_sem_marcador_nao_muda(self):
        self.assertEqual(extrair_erros(ANTIGO), [ANTIGO])

    def test_traceback_vira_so_a_linha_final(self):
        tb = "\n".join([
            "[ERROR] Unhandled exception: DBAPIError: falha",
            "Traceback (most recent call last):",
            '  File "/usr/local/lib/python3.12/site-packages/starlette/middleware/errors.py", line 165, in __call__',
            "    await self.app(scope, receive, _send)",
            '  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/engine/base.py", line 2355, in _handle_dbapi_exception',
            "    raise sqlalchemy_exception.with_traceback(exc_info[2]) from e",
            "",
            "The above exception was the direct cause of the following exception:",
            "",
            "Traceback (most recent call last):",
            '  File "/app/app/services/x.py", line 10, in f',
            "    raise translated_error from error",
            "    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
            "sqlalchemy.exc.DBAPIError: (asyncpg.exceptions.X) falha",
        ])
        self.assertEqual(extrair_erros(tb), [
            "[ERROR] Unhandled exception: DBAPIError: falha",
            "sqlalchemy.exc.DBAPIError: (asyncpg.exceptions.X) falha",
        ])

    def test_traceback_de_aviso_ao_usuario_nao_vira_erro(self):
        tb = "\n".join([
            "Traceback (most recent call last):",
            '  File "/app/app/utils/documentos.py", line 33, in normalizar_cep',
            '    raise UnprocessableError("CEP inválido: informe os 8 dígitos do CEP.")',
            "app.core.exceptions.UnprocessableError: 422: CEP inválido: informe os 8 dígitos do CEP.",
        ])
        self.assertEqual(extrair_erros(tb), [])

    def test_linha_depois_do_traceback_volta_ao_normal(self):
        texto = "Traceback (most recent call last):\n  File \"a.py\", line 1, in f\n    x()\nValueError: ruim\n" + ANTIGO
        self.assertEqual(extrair_erros(texto), ["ValueError: ruim", ANTIGO])

    def test_access_log_4xx_nao_e_erro_e_5xx_e(self):
        owa = '1.2.3.4 - - [29/Oct/2026:10:00:00 +0000] "GET /owa/auth/errorFE.aspx?httpCode=500 HTTP/1.1" 404 19 "-" "-"'
        chunk = '1.2.3.4 - - [11/Oct/2026:10:00:00 +0000] "GET /static/chunks/app/error-0d2f.js HTTP/1.1" 404 0 "-" "-"'
        falha = '1.2.3.4 - - [11/Oct/2026:10:00:00 +0000] "POST /api/error-report HTTP/1.1" 502 0 "-" "-"'
        self.assertEqual(extrair_erros("\n".join([owa, chunk, falha])), [falha])


if __name__ == "__main__":
    unittest.main()
