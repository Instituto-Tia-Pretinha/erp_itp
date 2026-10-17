"""Janelas de manutenção planejada: erros com horário dentro de uma janela
não viram item no catálogo nem alerta imediato — vão para um registro de
revisão (~/itp-stack/manutencao-ocorrencias.log).

Achado real (2026-10-17): troca de senhas e separação de usuários do Postgres
geraram 3 itens críticos/altos e alertas imediatos só com os testes de
validação (acesso negado de propósito, pg_isready sem -U).

A decisão é pelo horário da ocorrência, não pelo horário da coleta: o
coletor roda a cada 5 min e pode ler depois do fim da janela erros que
aconteceram dentro dela. Por isso as janelas ficam guardadas por alguns dias.

Arquivo: ~/itp-stack/manutencao.json — lista de
{"inicio": ISO, "fim": ISO, "motivo": str, "alvos": [containers/tarefas] ou [] = tudo}.
Gerenciado por infra/manutencao/manutencao.sh.
"""
from __future__ import annotations  # PEP 604 (X | None) -- VM roda Python 3.9

import json
import os
from datetime import datetime, timezone

ARQUIVO = os.path.expanduser("~/itp-stack/manutencao.json")
REGISTRO = os.path.expanduser("~/itp-stack/manutencao-ocorrencias.log")


def _dt(valor: str) -> datetime:
    dt = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def carregar(arquivo: str = ARQUIVO) -> list[dict]:
    """Janelas válidas do arquivo. Arquivo ausente ou inválido = nenhuma janela
    (manutenção nunca pode impedir o catálogo de registrar erro real)."""
    try:
        with open(arquivo) as f:
            dados = json.load(f)
    except (OSError, ValueError):
        return []
    janelas = []
    for j in dados if isinstance(dados, list) else []:
        try:
            janelas.append({**j, "_inicio": _dt(j["inicio"]), "_fim": _dt(j["fim"]), "alvos": j.get("alvos") or []})
        except (KeyError, TypeError, ValueError):
            continue
    return janelas


def janela_da_ocorrencia(janelas: list[dict], alvo: str, quando: datetime) -> dict | None:
    """Janela que cobre o alvo (container ou tarefa) no horário da ocorrência."""
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    for j in janelas:
        if j["_inicio"] <= quando <= j["_fim"] and (not j["alvos"] or alvo in j["alvos"]):
            return j
    return None


def registrar_suprimidas(alvo: str, janela: dict, mensagens: list[str], registro: str | None = None) -> None:
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(registro or REGISTRO, "a") as f:
        for msg in mensagens:
            f.write(f"{agora} | {janela.get('motivo', '')} | {alvo} | {msg.strip()[:500]}\n")
