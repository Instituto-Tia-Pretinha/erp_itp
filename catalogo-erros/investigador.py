"""JiraIA fase 4a: o Claude investiga tickets de problema e propõe correção.

A cada rodada, até LIMITE_POR_RODADA tickets elegíveis (remediar, média+,
sem trava, sistema com repositório conhecido) são investigados num git
worktree isolado. O Claude preenche causa raiz/impacto/remediação e, quando
a correção é pequena e segura, edita o código. O script valida o diff,
faz commit numa branch `jiraia/PRB-NNNN`, envia ao GitHub, pede ao Jev uma
avaliação da correção e manda e-mail com o link para abrir o PR.

Nada é mergeado nem publicado aqui (a publicação automática é a fase 4b).
Spec: BaseConhecimento/03-Implementacoes/2026-09-28-triagem-jev/spec.md

Uso: python3 investigador.py [--ticket PRB-NNNN] [--dry-run]
"""
from __future__ import annotations  # PEP 604 (X | None) — VM roda Python 3.9

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone

import requests

import config
import custos
import jev_client
import notificador
from base_conhecimento import BaseConhecimento, LISTA_TICKETS
from claude_client import TarefaEscalada, _extrair_json, _mensagem_erro, _rodar
from graph_client import GRAPH_BASE, GraphClient

LIMITE_POR_RODADA = 5
REINVESTIGAR_APOS = timedelta(days=7)
LOCK_FILE = os.path.expanduser("~/itp-stack/jiraia-investigador.lock")
WORKTREES = os.path.expanduser("~/itp-stack/jiraia-worktrees")
AUTOR = ("JiraIA", "erickcardoso@institutotiapretinha.org")

# Sistema do ticket -> (repositório local, repositório no GitHub).
REPOS = {
    "APRXM": (os.path.expanduser("~/aprxm_sys"), "erickcardosoitp/aprxm_sys"),
    "ERP-ITP": (os.path.expanduser("~/erp_itp"), "Instituto-Tia-Pretinha/erp_itp"),
}
# Correção automática nunca toca nesses caminhos (schema, segredos, deploy, CI).
PROIBIDOS = re.compile(r"migrat|/db/|^database/|\.env|docker-compose|^\.github/|app\.module\.ts$|vercel\.json$", re.I)
MAX_ARQUIVOS = 6
MAX_LINHAS = 400
CRITICIDADES = ("media", "alta", "critica")

PROMPT = """Você é o investigador do JiraIA, o catálogo de erros do Instituto Tia Pretinha.
O diretório atual é um worktree do repositório `{repo}` numa branch só desta investigação.

## Ticket {cod}: {titulo}
- Sistema/módulo/camada: {sistema} / {modulo} / {camada}
- Natureza: {natureza} · Criticidade: {criticidade}
- Ocorrências: {ocorrencias} · Última: {ultima}
- Triagem anterior: {triagem}

## Mensagens reais dos incidentes
{exemplos}

## Contexto do sistema
{contexto}

## Padrões recorrentes relevantes
{padroes}

## O que fazer
1. Investigue no código a causa raiz real. Leia os arquivos; não chute.
2. Se encontrar uma correção PEQUENA e SEGURA (poucos arquivos, sem mudar schema/migration, sem segredos, sem mexer em deploy ou CI, sem mudar regra de negócio), aplique-a editando os arquivos. Siga o estilo do código ao redor.
3. Se a correção exigir migration, decisão de negócio ou algo arriscado, NÃO edite nada: só descreva.
4. Nunca invente. Se não achar a causa, diga isso.

Responda no final com um único bloco JSON:
```json
{{
  "titulo": "título curto e específico do problema (pt-BR)",
  "causa_raiz": "o que causa o erro, citando arquivo:linha",
  "impacto": "quem é afetado e como",
  "contorno": "o que fazer enquanto não é corrigido",
  "remediacao": "a correção certa",
  "correcao_aplicada": true,
  "resumo_mudanca": "o que foi alterado (vazio se nada)",
  "risco": "seguro | mediano | alto risco",
  "confianca": 0
}}
```
`confianca` de 0 a 10 no diagnóstico."""


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)


def _git(repo: str, *args: str, check: bool = True) -> str:
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=120)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()[:400]}")
    return r.stdout


def _slug(texto: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", texto.lower()).strip("-")[:40].rstrip("-")


class Investigador:
    def __init__(self, dry_run: bool):
        self.cfg = config.carregar_env()
        self.client = GraphClient(self.cfg)
        self.base = BaseConhecimento(self.client)
        self.dry_run = dry_run
        self.site = f"{GRAPH_BASE}/sites/{self.client.site_id}"
        self._garantir_colunas()

    def _garantir_colunas(self) -> None:
        url = f"{self.site}/lists/{LISTA_TICKETS}/columns"
        existentes = {c["name"] for c in requests.get(url, headers=self.client._headers(), timeout=30).json()["value"]}
        novas = {
            "InvestigadoEm": {"name": "InvestigadoEm", "dateTime": {"format": "dateTime"}},
            "AvaliacaoCorrecao": {"name": "AvaliacaoCorrecao", "text": {"allowMultipleLines": True, "linesForEditing": 6, "textType": "plain"}},
        }
        for nome, definicao in novas.items():
            if nome not in existentes:
                requests.post(url, headers=self.client._headers(), json=definicao, timeout=30).raise_for_status()

    def _tickets(self) -> list[dict]:
        itens, url = [], f"{self.site}/lists/{LISTA_TICKETS}/items?expand=fields&$top=500"
        while url:
            dados = requests.get(url, headers=self.client._headers(), timeout=30).json()
            itens += dados["value"]
            url = dados.get("@odata.nextLink")
        return [{"id": i["id"], **i["fields"]} for i in itens]

    def elegiveis(self, cod: str | None) -> list[dict]:
        agora = datetime.now(timezone.utc)
        ordem = {"critica": 0, "alta": 1, "media": 2}
        saida = []
        for t in self._tickets():
            if cod:
                if t.get("CodProblema") == cod:
                    saida.append(t)
                continue
            investigado = t.get("InvestigadoEm")
            recente = investigado and agora - datetime.fromisoformat(investigado.replace("Z", "+00:00")) < REINVESTIGAR_APOS
            if (t.get("Estado") in ("aberto", "reaberto") and t.get("Disposicao") == "remediar"
                    and t.get("Criticidade") in CRITICIDADES and not t.get("Travas")
                    and t.get("Sistema") in REPOS and not recente):
                saida.append(t)
        saida.sort(key=lambda t: t.get("UltimaOcorrencia") or "", reverse=True)  # mais recentes primeiro...
        saida.sort(key=lambda t: ordem.get(t.get("Criticidade"), 9))  # ...dentro de cada criticidade
        return saida[:LIMITE_POR_RODADA]

    def _prompt(self, t: dict, repo_gh: str) -> str:
        exemplos = self.base.exemplos(t["CodProblema"], limite=5) or ["(sem incidentes vinculados)"]
        padroes = ""
        if t.get("PadraoRecorrente"):
            padroes = self.base.documento(f"04-Padroes-Recorrentes/{t['PadraoRecorrente']}")
        return PROMPT.format(
            repo=repo_gh, cod=t["CodProblema"], titulo=t.get("Title") or "", sistema=t.get("Sistema"),
            modulo=t.get("Modulo") or "?", camada=t.get("Camada") or "?", natureza=t.get("Natureza") or "?",
            criticidade=t.get("Criticidade"), ocorrencias=t.get("QtdOcorrencias") or "?",
            ultima=t.get("UltimaOcorrencia") or "?", triagem=(t.get("JustificativaCriticidade") or "")[:800],
            exemplos="\n".join(f"- `{e}`" for e in exemplos),
            contexto=self.base.contexto_sistema({"APRXM": "APRXM", "ERP-ITP": "ITP"}[t["Sistema"]])[:4000] or "(sem contexto)",
            padroes=padroes[:3000] or "(nenhum)",
        )

    def _validar_diff(self, wt: str) -> tuple[list[str], int, str | None]:
        _git(wt, "add", "-A")
        arquivos = [a for a in _git(wt, "diff", "--cached", "--name-only").splitlines() if a]
        linhas = 0
        for l in _git(wt, "diff", "--cached", "--numstat").splitlines():
            partes = l.split("\t")
            if len(partes) >= 2 and partes[0].isdigit() and partes[1].isdigit():
                linhas += int(partes[0]) + int(partes[1])
        if not arquivos:
            return arquivos, 0, None
        proibidos = [a for a in arquivos if PROIBIDOS.search(a)]
        if proibidos:
            return arquivos, linhas, f"alterou caminho proibido para correção automática: {', '.join(proibidos)}"
        if len(arquivos) > MAX_ARQUIVOS or linhas > MAX_LINHAS:
            return arquivos, linhas, f"mudança grande demais ({len(arquivos)} arquivos, {linhas} linhas)"
        return arquivos, linhas, None

    def _avaliar_com_jev(self, t: dict, resultado: dict, diff: str) -> dict:
        perguntas = {
            "corrige_causa": {"type": "noul", "instructions": "O `diff` corrige a causa descrita em `diagnostico.causa_raiz`?"},
            "escopo_minimo": {"type": "noul", "instructions": "O `diff` mexe só no necessário para essa correção, sem mudanças não relacionadas?"},
            "efeito_colateral": {"type": "noul", "instructions": "O `diff` pode quebrar outro fluxo, mudar regra de negócio ou afetar dados?"},
            "risco": {"type": "choice", "instructions": "Qual o risco de publicar o `diff`?",
                      "criteria": {"seguro": "mudança pequena e isolada", "mediano": "toca fluxo relevante", "alto risco": "dados, dinheiro, autenticação, schema ou isolamento"}},
        }
        state = {"ticket": {"titulo": resultado.get("titulo"), "sistema": t.get("Sistema")},
                 "diagnostico": {"causa_raiz": resultado.get("causa_raiz"), "remediacao": resultado.get("remediacao")},
                 "diff": diff[:8000]}
        try:
            r = jev_client._chamar(self.cfg["JEV_API_KEY"], state, perguntas)
        except jev_client.JevIndisponivel as exc:
            return {"texto": f"Jev indisponível: {exc}", "risco": None}
        a = r.get("answers", {})
        n = lambda k: float((a.get(k) or {}).get("noul") or 0)
        risco = (a.get("risco") or {}).get("choice")
        texto = (f"Corrige a causa: {n('corrige_causa'):.2f} · Escopo mínimo: {n('escopo_minimo'):.2f} · "
                 f"Efeito colateral: {n('efeito_colateral'):.2f} · Risco: {risco}")
        return {"texto": texto, "risco": risco}

    def _atualizar_ticket(self, t: dict, campos: dict) -> None:
        if self.dry_run:
            log(f"  [dry-run] atualizaria {t['CodProblema']}:")
            for k, v in campos.items():
                log(f"    {k}: {str(v)[:600]}")
            return
        requests.patch(f"{self.site}/lists/{LISTA_TICKETS}/items/{t['id']}/fields",
                       headers=self.client._headers(), json=campos, timeout=30).raise_for_status()

    def investigar(self, t: dict) -> None:
        cod = t["CodProblema"]
        repo, repo_gh = REPOS[t["Sistema"]]
        branch = f"jiraia/{cod}-{_slug(t.get('Title') or cod)}"
        wt = os.path.join(WORKTREES, cod)
        log(f"{cod} ({t.get('Criticidade')}, {t['Sistema']}): investigando em {branch}")
        os.makedirs(WORKTREES, exist_ok=True)
        if os.path.isdir(wt):
            _git(repo, "worktree", "remove", "--force", wt, check=False)
            shutil.rmtree(wt, ignore_errors=True)
        _git(repo, "fetch", "--quiet", "origin", "main")
        _git(repo, "worktree", "add", "--quiet", "-B", branch, wt, "origin/main")
        agora = datetime.now(timezone.utc).isoformat()
        try:
            prompt = self._prompt(t, repo_gh)
            r = _rodar(["claude", "-p", prompt, "--output-format", "json", "--allowedTools", "Read,Grep,Glob,Edit,Write"],
                       timeout_s=600, prompt=prompt, cwd=wt, limite_s=600)
            if r.returncode != 0:
                raise RuntimeError(f"claude CLI falhou: {_mensagem_erro(r)[:300]}")
            envelope = json.loads(r.stdout)
            if envelope.get("total_cost_usd"):
                custos.registrar("investigador", envelope["total_cost_usd"])
            resultado = _extrair_json(envelope.get("result", ""))
        except (TarefaEscalada, RuntimeError, ValueError, json.JSONDecodeError) as exc:
            log(f"  investigação falhou: {exc}")
            self._atualizar_ticket(t, {"InvestigadoEm": agora, "AvaliacaoCorrecao": f"Investigação automática falhou em {agora[:16]}: {str(exc)[:500]}"})
            _git(repo, "worktree", "remove", "--force", wt, check=False)
            return

        campos = {"InvestigadoEm": agora, "OrigemClassificacao": "ia"}
        for chave, campo in (("titulo", "Title"), ("causa_raiz", "CausaRaiz"), ("impacto", "Impacto"),
                             ("contorno", "Contorno"), ("remediacao", "Remediacao")):
            if resultado.get(chave):
                campos[campo] = str(resultado[chave])[:4000 if campo != "Title" else 255]

        arquivos, linhas, motivo_bloqueio = self._validar_diff(wt)
        link, avaliacao = "", {"texto": "", "risco": None}
        if arquivos and not motivo_bloqueio:
            diff = _git(wt, "diff", "--cached")
            avaliacao = self._avaliar_com_jev(t, resultado, diff)
            if not self.dry_run:
                _git(wt, "-c", f"user.name={AUTOR[0]}", "-c", f"user.email={AUTOR[1]}", "commit", "--quiet", "-m",
                     f"fix(jiraia): {cod} — {campos.get('Title', t.get('Title'))[:60]}\n\n{resultado.get('resumo_mudanca', '')}\n\n"
                     f"Proposta automática do JiraIA (fase 4a). Revisar antes do merge.")
                _git(wt, "push", "--quiet", "--force", "-u", "origin", branch)
                link = f"https://github.com/{repo_gh}/compare/main...{branch}?expand=1"
            campos.update({"Estado": "em-correcao", "LinkPR": link})
        else:
            campos["Estado"] = "em-analise"
        campos["AvaliacaoCorrecao"] = "\n".join(filter(None, [
            f"Investigação automática em {agora[:16]} (confiança {resultado.get('confianca', '?')}/10, risco segundo o Claude: {resultado.get('risco', '?')}).",
            f"Arquivos: {', '.join(arquivos)} ({linhas} linhas)." if arquivos else "Nenhuma alteração de código proposta.",
            f"Correção descartada: {motivo_bloqueio}." if motivo_bloqueio else "",
            f"Avaliação do Jev: {avaliacao['texto']}" if avaliacao["texto"] else "",
        ]))
        self._atualizar_ticket(t, campos)
        log(f"  {cod}: {campos['Estado']} | {len(arquivos)} arquivo(s) | {motivo_bloqueio or link or 'sem correção'}")

        if not self.dry_run:
            self._avisar(t, campos, resultado, link, motivo_bloqueio)
        _git(repo, "worktree", "remove", "--force", wt, check=False)

    def _avisar(self, t: dict, campos: dict, resultado: dict, link: str, motivo_bloqueio: str | None) -> None:
        import html
        e = html.escape
        acao = (f'<p><a href="{link}"><b>Abrir o PR com a correção proposta</b></a> (revise antes do merge).</p>' if link
                else f"<p>Correção não enviada: {e(motivo_bloqueio)}.</p>" if motivo_bloqueio
                else "<p>O Claude não propôs alteração de código; ver remediação.</p>")
        corpo = f"""
<p><b>{e(t['CodProblema'])} · {e(t.get('Criticidade') or '').upper()} · {e(t.get('Sistema') or '')}</b></p>
<p><b>{e(campos.get('Title') or t.get('Title') or '')}</b></p>
<p><b>Causa raiz:</b> {e(campos.get('CausaRaiz', '—'))}</p>
<p><b>Impacto:</b> {e(campos.get('Impacto', '—'))}</p>
<p><b>Remediação:</b> {e(campos.get('Remediacao', '—'))}</p>
{acao}
<pre style="white-space:pre-wrap">{e(campos.get('AvaliacaoCorrecao', ''))}</pre>
<p><a href="{notificador.URL_LISTA}">Abrir TicketsProblema</a></p>"""
        try:
            notificador.enviar_email(f"[JiraIA] Investigação {t['CodProblema']}: {(campos.get('Title') or t.get('Title') or '')[:70]}", corpo)
        except Exception as exc:
            log(f"  aviso: falha ao enviar e-mail: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticket", help="Investiga só este ticket (ignora os filtros de elegibilidade)")
    parser.add_argument("--dry-run", action="store_true", help="Investiga mas não grava no SharePoint nem envia ao GitHub")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    with open(LOCK_FILE, "w") as lock_fd:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("outra execução do investigador em andamento — saindo")
            return
        inv = Investigador(args.dry_run)
        tickets = inv.elegiveis(args.ticket)
        log(f"{len(tickets)} ticket(s) para investigar")
        for t in tickets:
            try:
                inv.investigar(t)
            except Exception as exc:  # um ticket com problema não impede os outros
                log(f"  erro inesperado em {t.get('CodProblema')}: {exc}")


if __name__ == "__main__":
    main()
