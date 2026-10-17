#!/usr/bin/env python3
"""Janela de manutenção planejada.

Erros com horário dentro de uma janela não viram item no catálogo de erros nem
alerta (ver catalogo-erros/manutencao.py); containers informados ganham silence
no alerta de "container caído" do Grafana (tarefas/silenciar_manutencao.sh).

Uso (na VM):
  manutencao.py iniciar <minutos> "<motivo>" [container|tarefa ...]   # sem alvos = tudo
  manutencao.py encerrar   # fecha as janelas abertas, com 5 min de margem
  manutencao.py status

Logs sem horário próprio são julgados pela hora da coleta (a cada 5 min),
por isso o encerrar mantém 5 min de margem.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

ARQUIVO = os.path.expanduser("~/itp-stack/manutencao.json")
SILENCIAR = os.path.expanduser("~/itp-stack/tarefas/silenciar_manutencao.sh")
MARGEM = timedelta(minutes=5)
RETENCAO = timedelta(days=7)


def iso(d: datetime) -> str:
    return d.isoformat(timespec="seconds")


def carregar(agora: datetime) -> list:
    try:
        with open(ARQUIVO) as f:
            janelas = json.load(f)
    except (OSError, ValueError):
        janelas = []
    return [j for j in janelas if datetime.fromisoformat(j["fim"]) > agora - RETENCAO]


def salvar(janelas: list) -> None:
    with open(ARQUIVO, "w") as f:
        json.dump(janelas, f, ensure_ascii=False, indent=2)


def container_existe(nome: str) -> bool:
    return subprocess.run(["docker", "inspect", nome], capture_output=True).returncode == 0


def main(argv: list) -> int:
    agora = datetime.now(timezone.utc)
    acao = argv[0] if argv else "status"
    janelas = carregar(agora)

    if acao == "iniciar" and len(argv) >= 3:
        minutos, motivo, alvos = int(argv[1]), argv[2], argv[3:]
        janelas.append({"inicio": iso(agora), "fim": iso(agora + timedelta(minutes=minutos)),
                        "motivo": motivo, "alvos": alvos})
        salvar(janelas)
        print(f"janela aberta até {janelas[-1]['fim']} — alvos: {', '.join(alvos) or 'todos'}")
        for alvo in alvos:
            if os.access(SILENCIAR, os.X_OK) and container_existe(alvo):
                subprocess.run([SILENCIAR, alvo, str(minutos)], capture_output=True)
                print(f"silence no Grafana: {alvo}")
        return 0

    if acao == "encerrar":
        abertas = [j for j in janelas if datetime.fromisoformat(j["fim"]) > agora]
        for j in abertas:
            j["fim"] = iso(agora + MARGEM)
        salvar(janelas)
        print(f"{len(abertas)} janela(s) encerrada(s), com margem de 5 min")
        return 0

    if acao == "status":
        for j in janelas:
            aberta = datetime.fromisoformat(j["inicio"]) <= agora <= datetime.fromisoformat(j["fim"])
            print(f"{'ABERTA ' if aberta else 'fechada'} {j['inicio']} → {j['fim']} | {j['motivo']} | "
                  f"{', '.join(j['alvos']) or 'todos'}")
        print(f"{len(janelas)} janela(s) nos últimos 7 dias")
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
