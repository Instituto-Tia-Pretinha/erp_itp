"""Envio de e-mail do catálogo de erros via Microsoft Graph.

O app "Catalogo Erros - VM" (catalogo_erros.env) não tem Mail.Send; o app
que envia é outro, com credenciais em ~/itp-stack/relatorio_grafana.env
(achado de 2026-09-15, ver consolidar_diario.py).
"""
from __future__ import annotations  # PEP 604 (X | None) — VM roda Python 3.9

import html
import os
import time

import requests

DESTINATARIO = "erickcardoso@institutotiapretinha.org"
REMETENTE = "projetos@institutotiapretinha.org"
ENV_EMAIL = os.path.expanduser("~/itp-stack/relatorio_grafana.env")
URL_LISTA = "https://insttiapretinha.sharepoint.com/sites/ObservabilidadeITP/Lists/TicketsProblema"

# PRB-0086: 502 do Graph (gateway instável do lado da Microsoft, sem relação
# com credencial) derrubou a consolidação diária inteira por falha só no
# envio do e-mail-resumo -- os itens já tinham sido criados na lista antes
# disso. Retry curto só para status transitório (não para 4xx de credencial,
# que já tem causa raiz conhecida e não se resolve tentando de novo).
_STATUS_TRANSITORIOS = {429, 500, 502, 503, 504}
_TENTATIVAS = 3
_ESPERA_BASE_S = 2


def _post_com_retry(url: str, **kwargs) -> requests.Response:
    for tentativa in range(1, _TENTATIVAS + 1):
        resp = requests.post(url, **kwargs)
        if resp.status_code not in _STATUS_TRANSITORIOS or tentativa == _TENTATIVAS:
            return resp
        time.sleep(_ESPERA_BASE_S * tentativa)
    return resp


def _cfg_email() -> dict:
    cfg = {}
    with open(ENV_EMAIL, "r", encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                k, v = linha.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def enviar_email(assunto: str, corpo_html: str, destinatario: str = DESTINATARIO) -> None:
    cfg = _cfg_email()
    token_resp = _post_com_retry(
        f"https://login.microsoftonline.com/{cfg['MS_TENANT_ID']}/oauth2/v2.0/token",
        data={
            "client_id": cfg["MS_CLIENT_ID"],
            "client_secret": cfg["MS_CLIENT_SECRET"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    token_resp.raise_for_status()
    resp = _post_com_retry(
        f"https://graph.microsoft.com/v1.0/users/{REMETENTE}/sendMail",
        headers={"Authorization": f"Bearer {token_resp.json()['access_token']}", "Content-Type": "application/json"},
        json={
            "message": {
                "subject": assunto,
                "body": {"contentType": "HTML", "content": corpo_html},
                "toRecipients": [{"emailAddress": {"address": destinatario}}],
            },
            "saveToSentItems": "false",
        },
        timeout=30,
    )
    resp.raise_for_status()


def alertar(motivo: str, criticidade: str, titulo: str, cod_problema: str | None,
            aplicacao: str, mensagem: str, detalhe: str) -> None:
    """Aviso imediato de erro alto/crítico (novo ou reincidente)."""
    e = html.escape
    corpo = f"""
<p><b>{e(motivo)}</b></p>
<table cellpadding="4" style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">
<tr><td><b>Criticidade</b></td><td>{e(criticidade.upper())}</td></tr>
<tr><td><b>Sistema</b></td><td>{e(aplicacao)}</td></tr>
<tr><td><b>Ticket</b></td><td>{e(cod_problema or "—")}</td></tr>
<tr><td><b>Problema</b></td><td>{e(titulo)}</td></tr>
</table>
<p><b>Mensagem:</b></p><pre style="white-space:pre-wrap">{e(mensagem[:1500])}</pre>
<p><b>Triagem:</b> {e(detalhe[:1500])}</p>
<p><a href="{URL_LISTA}">Abrir TicketsProblema</a></p>
"""
    enviar_email(f"[JiraIA] {criticidade.upper()} · {cod_problema or 'novo'} · {titulo[:80]}", corpo)
