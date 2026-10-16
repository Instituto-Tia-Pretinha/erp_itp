"""Carrega configuração do catálogo de erros a partir do arquivo .env da VM.

Não usa python-dotenv de propósito (dependência a menos) — o arquivo já
segue o formato simples KEY=VALUE que a gente mesmo escreveu via SSH.
"""
import os

DEFAULT_ENV_PATH = os.path.expanduser("~/itp-stack/catalogo_erros.env")

# Containers monitorados hoje. "aplicacao_sugerida" é só um hint pro Claude
# na classificação — a regra real (Aplicacao=ITP+Categoria=banco vs
# Aplicacao=BD+Categoria=infra) fica a cargo da IA, não fixa aqui.
CONTAINERS = [
    {"nome": "erp_itp_backend", "aplicacao_sugerida": "ITP"},
    {"nome": "erp_itp_frontend", "aplicacao_sugerida": "ITP"},
    {"nome": "itp_postgres", "aplicacao_sugerida": "ITP"},
    {"nome": "itp_traefik", "aplicacao_sugerida": "ITP"},
    {"nome": "itp_grafana", "aplicacao_sugerida": "ITP"},
    {"nome": "itp_prometheus", "aplicacao_sugerida": "ITP"},
    {"nome": "catalogo_backend", "aplicacao_sugerida": "ITP"},
    # APRXM migrou pra vm-itp-prod em 2026-09-12/14 (backend/crons/dominio/
    # storage -- banco continua no Neon). Ate 2026-09-14 esse container nao
    # era monitorado: os 500 reais de producao achados nessa data (login por
    # search_path do pooler Neon, /openapi.json) so foram vistos por
    # investigacao manual, nunca teriam entrado no catalogo.
    {"nome": "aprxm_backend", "aplicacao_sugerida": "APRXM"},
]

STATE_FILE = os.path.expanduser("~/itp-stack/catalogo-erros-state.json")

# Falhas de cron/tarefa (tarefas-timing/*.jsonl, escrito pelo tarefas_runner.py
# do ITP_TEC) -- ate 2026-09-14 essas falhas nao entravam no catalogo de erros,
# ficavam so no jsonl estruturado sem classificacao de IA nem visibilidade no
# SharePoint. exit_code != 0 e o proprio sinal de erro aqui, sem precisar de
# grep por palavra-chave como nos containers.
TAREFAS_REGISTRO_PATH = os.path.expanduser("~/itp-stack/tarefas-registro.json")
TAREFAS_TIMING_DIR = os.path.expanduser("~/itp-stack/tarefas-timing")
PARQUET_BASE_DIR = os.path.expanduser("~/itp-stack/catalogo-erros-parquet")

# Só chama o Claude se essas palavras aparecerem na linha (case-insensitive).
# Mesmo padrão usado manualmente a sessão inteira de 2026-09-09.
PADRAO_ERRO = r"error|exception|fatal|panic"


def carregar_env(path: str = DEFAULT_ENV_PATH) -> dict:
    """Lê o .env simples (KEY=VALUE, sem aspas, sem export) e devolve dict.
    Não usa os.environ diretamente porque o cron pode rodar sem 'source'."""
    valores = {}
    with open(path, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            valores[chave.strip()] = valor.strip()
    obrigatorias = [
        "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET",
        "SHAREPOINT_SITE_ID", "SHAREPOINT_LIST_ID",
    ]
    faltando = [k for k in obrigatorias if k not in valores]
    if faltando:
        raise RuntimeError(f"Faltam variáveis no {path}: {faltando}")
    return valores
