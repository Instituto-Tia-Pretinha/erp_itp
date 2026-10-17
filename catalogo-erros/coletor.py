#!/usr/bin/env python3
"""Coletor de erros da VM — orquestra o fluxo descrito em
CATALOGO-ERROS.md: lê docker logs, normaliza, deduplica em 3 camadas,
classifica via Claude Code CLI, grava na SharePoint List e no Parquet.

Uso:
    python3 coletor.py                 # roda normal (usa/atualiza o state)
    python3 coletor.py --desde 24h     # ignora o state, força janela

Pensado pra rodar via cron. Idempotente na medida do possível: cada
execução só processa logs desde a última execução (arquivo de state).
"""
from __future__ import annotations  # PEP 604 (X | None) -- VM roda Python 3.9

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import config
import custos
import normalizador
import parquet_writer
import staging_diario
from claude_client import TarefaEscalada, classificar, registrar_escalonamento
from graph_client import GraphClient
import jev_client
import manutencao
import notificador
from base_conhecimento import BaseConhecimento

CAMPOS_SHORTLIST = ["CodErro", "TipoErro", "Assinatura", "Categoria"]

# Categorias cuja reincidência reabre sempre um item resolvido (spec seção
# 9/10). Precisa bater exatamente com CATEGORIAS_VALIDAS de claude_client.py
# (achado real 2026-09-11: grafia antiga "codigo"/"seguranca"/"outros" nunca
# batia com os valores reais "código"/"security"/"terceiros" que o
# classificador de fato atribui — reincidência dessas 3 categorias nunca
# reabria um item já resolvido).
REABRE_SEMPRE = {"banco", "código", "infra", "security", "terceiros"}
LIMITE_PICO_INTEGRACAO = 5  # ocorrências no mesmo lote pra considerar "pico"

# Circuit breaker (decisão 2026-09-15, pós-incidente de estouro de sessão):
# no máximo N classificações de IA por execução do coletor. O que sobrar
# fica pendente pro próximo lote (o state daquele container/tarefa não
# avança), em vez de drenar o backlog inteiro de uma vez -- foi exatamente
# isso que consumiu ~92% da janela de sessão de 5h em minutos no incidente.
LIMITE_CLASSIFICACOES_POR_RODADA = 5

# Modo sem IA (--sem-ia): nenhuma chamada ao Claude. Assinatura nova vira item
# "pendente de triagem" direto no SharePoint, aguardando a triagem com Jev
# (spec 2026-09-28-triagem-jev). Definido em main().
SEM_IA = False

# Modo Jev (--jev): triagem pelo Jev no lugar da classificação pelo Claude
# (spec 2026-09-28-triagem-jev). BASE e JEV_API_KEY definidos em main().
JEV = False
JEV_API_KEY = ""
BASE: BaseConhecimento | None = None
LIMITE_TRIAGENS_JEV_POR_RODADA = 50

# Rajada: muitos erros de banco do mesmo PID no mesmo minuto, com várias
# assinaturas distintas = restauração/sincronização (ex: PRB-0001, 14/09
# 23:04), não bug. Vira um ticket por dia, sem IA.
_RAJADA_CHAVE = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}(?:\.\d+)? UTC \[(\d+)\]")
RAJADA_MIN_LINHAS = 20
RAJADA_MIN_ASSINATURAS = 5


def detectar_rajadas(linhas_erro: list[str]) -> set:
    """Chaves (minuto, pid) que caracterizam rajada neste lote."""
    linhas_por_chave: dict = defaultdict(int)
    assinaturas_por_chave: dict = defaultdict(set)
    for linha in linhas_erro:
        m = _RAJADA_CHAVE.search(linha)
        if m:
            chave = (m.group(1), m.group(2))
            linhas_por_chave[chave] += 1
            assinaturas_por_chave[chave].add(normalizador.normalizar(linha)[:255])
    return {c for c, n in linhas_por_chave.items()
            if n >= RAJADA_MIN_LINHAS and len(assinaturas_por_chave[c]) >= RAJADA_MIN_ASSINATURAS}


def _rajada_do_grupo(exemplos: list[str], rajadas: set) -> tuple | None:
    """Chave da rajada se TODAS as linhas do grupo pertencem a ela."""
    if not rajadas:
        return None
    chaves = set()
    for linha in exemplos:
        m = _RAJADA_CHAVE.search(linha)
        if not m or (m.group(1), m.group(2)) not in rajadas:
            return None
        chaves.add((m.group(1), m.group(2)))
    return next(iter(chaves)) if len(chaves) == 1 else None


def _ticket_rajada(dia: str, pid: str) -> str | None:
    """Ticket de rajada do dia: reaproveita se já existe, senão cria."""
    titulo = f"Rajada de erros de banco (restauração/sincronização) em {dia}"
    existente = next((t for t in BASE._todos_tickets() if t.get("Title") == titulo), None)
    if existente:
        return existente["CodProblema"]
    return BASE.criar_ticket({
        "Title": titulo, "Sistema": "Banco", "Modulo": "Restauração/sincronização", "Camada": "banco",
        "Natureza": "efeito-deploy", "Disposicao": "aceito-conhecido", "Criticidade": "baixa",
        "JustificativaCriticidade": f"Detectado por regra (sem IA): {RAJADA_MIN_LINHAS}+ erros de banco do PID {pid} no mesmo minuto, com {RAJADA_MIN_ASSINATURAS}+ mensagens distintas.",
        "CausaRaiz": "Provável pg_restore, sync ou migração rodando sobre base já populada. Confirmar o que rodou nesse horário.",
        "Contorno": "Nenhum necessário se o banco final está íntegro.",
        "Remediacao": "Ver padrão 04-Padroes-Recorrentes/restauracao-banco.md.",
        "Estado": "erro-conhecido", "QtdIncidentes": 0, "QtdOcorrencias": 0, "OrigemClassificacao": "ia",
        "PadraoRecorrente": "restauracao-banco.md",
    })


def _registrar_no_ticket(cod: str | None, ocorrencias: int, ultimo_timestamp: datetime, incidente_novo: bool) -> None:
    if not (BASE and cod):
        return
    try:
        reaberto = BASE.registrar_ocorrencia(cod, ocorrencias, ultimo_timestamp.isoformat(), incidente_novo)
    except Exception as exc:  # contador do ticket não pode derrubar a rodada
        log(f"  aviso: falha ao atualizar ticket {cod}: {exc}")
        return
    t = BASE.ticket(cod) or {}
    if reaberto and t.get("Criticidade") in ("alta", "critica"):
        _alertar("Ticket reaberto: o problema voltou a acontecer", t.get("Criticidade"), t.get("Title") or "",
                 cod, t.get("Sistema") or "", "", f"{ocorrencias} ocorrência(s) nova(s) em {ultimo_timestamp.isoformat()}")


def _alertar(motivo: str, criticidade: str, titulo: str, cod: str | None, aplicacao: str, mensagem: str, detalhe: str) -> None:
    """Aviso imediato por e-mail; falha de envio não derruba a rodada."""
    try:
        notificador.alertar(motivo, criticidade, titulo, cod, aplicacao, mensagem, detalhe)
        log(f"  alerta imediato enviado ({criticidade}, {cod})")
    except Exception as exc:
        log(f"  aviso: falha ao enviar alerta imediato ({cod}): {exc}")

METRICA_TETO_PATH = os.path.expanduser("~/itp-stack/textfile-metrics/catalogo-erros-teto.prom")


def _escrever_metrica_teto(atingido: bool) -> None:
    """Flag pro Grafana: 1 se esta rodada bateu no teto de classificações
    (sinal de backlog se acumulando, mesmo sem nenhum erro/exceção) --
    complementa o heartbeat existente (que só detecta ausência de execução,
    não uma execução "viva" mas sempre no limite)."""
    try:
        os.makedirs(os.path.dirname(METRICA_TETO_PATH), exist_ok=True)
        tmp = METRICA_TETO_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(
                "# HELP catalogo_erros_teto_atingido 1 se a última execução do "
                "coletor bateu no teto de classificações por rodada.\n"
                "# TYPE catalogo_erros_teto_atingido gauge\n"
                f"catalogo_erros_teto_atingido {1 if atingido else 0}\n"
            )
        os.replace(tmp, METRICA_TETO_PATH)
    except OSError:
        pass


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).isoformat()}] {msg}", flush=True)


def carregar_state() -> dict:
    if os.path.exists(config.STATE_FILE):
        with open(config.STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def salvar_state(state: dict) -> None:
    os.makedirs(os.path.dirname(config.STATE_FILE), exist_ok=True)
    with open(config.STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def separar_manutencao(janelas: list[dict], alvo: str, itens: list, quando_de, agora: datetime) -> list:
    """Tira as ocorrências que caem numa janela de manutenção planejada (ver
    manutencao.py) e as grava no registro de revisão; devolve as demais."""
    if not janelas:
        return itens
    restantes, suprimidas = [], defaultdict(list)
    for item in itens:
        janela = manutencao.janela_da_ocorrencia(janelas, alvo, quando_de(item) or agora)
        if janela:
            suprimidas[id(janela)].append((janela, item))
        else:
            restantes.append(item)
    for grupo in suprimidas.values():
        janela = grupo[0][0]
        manutencao.registrar_suprimidas(alvo, janela, [str(i) for _, i in grupo])
        log(f"  {len(grupo)} ocorrência(s) em janela de manutenção ({janela.get('motivo', '')}) — sem item/alerta")
    return restantes


def logs_do_container(nome: str, desde_iso: str) -> str:
    resultado = subprocess.run(
        ["docker", "logs", "--since", desde_iso, nome],
        capture_output=True, text=True, timeout=60,
    )
    # docker manda log de app pro stderr às vezes (ex: NestJS) — junta os dois.
    return (resultado.stdout or "") + (resultado.stderr or "")


# itp_postgres loga com log_line_prefix '%m [%p] app=%a| ' (ALTER SYSTEM na VM). Sessão manual (psql,
# pgAdmin, DBeaver) é consulta de diagnóstico, não erro do sistema -- três delas reabriram o PRB-0021
# em 28/09. O marcador sai da linha pra assinatura continuar igual à dos erros já catalogados.
_APP_POSTGRES = re.compile(r" app=([^|]*)\| ")
_APPS_MANUAIS = ("psql", "pgAdmin", "DBeaver")


def extrair_erros(texto_log: str) -> list[str]:
    erros = []
    for l in texto_log.splitlines():
        m = _APP_POSTGRES.search(l)
        if m:
            if m.group(1).startswith(_APPS_MANUAIS):
                continue
            l = l[:m.start()] + " " + l[m.end():]
        if (normalizador.contem_erro(l, config.PADRAO_ERRO)
                and not normalizador.eh_access_log_ok(l)
                and not normalizador.eh_nivel_nao_erro(l)):
            erros.append(l)
    return erros


def _desde_para_datetime(desde: str):
    """Aceita tanto duracao simples ("24h") quanto ISO datetime, mesmo
    padrao aceito pelo --since do docker logs (mas aqui sem shell out)."""
    if desde.endswith("h") and desde[:-1].isdigit():
        return datetime.now(timezone.utc) - timedelta(hours=int(desde[:-1]))
    return datetime.fromisoformat(desde.replace("Z", "+00:00"))


def carregar_registro_tarefas() -> list[dict]:
    if not os.path.exists(config.TAREFAS_REGISTRO_PATH):
        return []
    return json.load(open(config.TAREFAS_REGISTRO_PATH, encoding="utf-8")).get("tarefas", [])


def falhas_da_tarefa(task_id: str, log_path: str | None, desde_iso: str) -> list[dict]:
    """Le tarefas-timing/<id>.jsonl e devolve as execucoes com exit_code != 0
    desde desde_iso. Cada item ja vem com um trecho do log real (log_path)
    pra dar contexto pra IA -- sem isso a classificacao teria so o exit_code,
    sem saber o motivo."""
    arquivo = os.path.join(config.TAREFAS_TIMING_DIR, f"{task_id}.jsonl")
    if not os.path.exists(arquivo):
        return []
    corte = _desde_para_datetime(desde_iso)
    falhas = []
    for linha in open(arquivo, encoding="utf-8"):
        linha = linha.strip()
        if not linha:
            continue
        registro = json.loads(linha)
        if registro.get("exit_code", 0) == 0:
            continue
        inicio = datetime.fromisoformat(registro["inicio"])
        if inicio <= corte:
            continue
        registro["_trecho_log"] = ""
        if log_path and os.path.exists(log_path):
            try:
                with open(log_path, encoding="utf-8", errors="replace") as lf:
                    lf.seek(0, os.SEEK_END)
                    tamanho = lf.tell()
                    lf.seek(max(0, tamanho - 3000))
                    registro["_trecho_log"] = lf.read()
            except OSError:
                pass
        falhas.append(registro)
    return falhas


def gerar_cod_erro() -> str:
    return f"ERR-{uuid.uuid4().hex[:10]}"


def gerar_cod_cat(item_id: str) -> str:
    return f"CAT-{int(item_id):04d}"


def aplicar_matriz_reincidencia(item_fields: dict, categoria_do_item: str, qtd_no_lote: int) -> dict:
    """Decide se um item já 'resolvido' deve reabrir, de acordo com a
    matriz da spec (seção 9/10). Devolve os campos extras a atualizar."""
    status_atual = item_fields.get("Status")
    if status_atual != "resolvido":
        return {}  # só reincidência de item resolvido dispara essa lógica

    # Item auto-resolvido por ser "sem risco" (ver _criar_item_novo) nunca
    # reabre sozinho, mesmo em categoria de REABRE_SEMPRE -- reincidir não
    # muda o fato de que a classificação já disse que não há ação/risco
    # nenhum a avaliar. Sem essa checagem, ruído de DDL idempotente (banco)
    # reabriria a cada reincidência, anulando a auto-resolução.
    if item_fields.get("IAPodeResolver") == "sem risco":
        return {}

    if categoria_do_item == "integracao":
        if qtd_no_lote > LIMITE_PICO_INTEGRACAO:
            return {"Status": "reaberto", "Fase": "detectado", "Reincidente": True}
        return {}  # instabilidade isolada esperada, não reabre
    if categoria_do_item == "usuario":
        return {}  # nunca reabre sozinho

    if categoria_do_item in REABRE_SEMPRE:
        return {"Status": "reaberto", "Fase": "detectado", "Reincidente": True}
    return {}


GRUPO_ADIADO = None  # sentinela: teto da rodada atingido ou tarefa escalada -- vai pro próximo lote


def processar_grupo(
    client: GraphClient,
    container: str,
    aplicacao_sugerida: str,
    msg_normalizada: str,
    exemplos_brutos: list[str],
    primeiro_timestamp: datetime,
    ultimo_timestamp: datetime,
    custo_acumulado: list,
    contador_classificacoes: list,
    rajada: tuple | None = None,
) -> dict | None:
    """Processa um grupo (mesma assinatura normalizada) visto neste lote.
    Devolve os campos usados pra gravar as linhas do Parquet — inclui
    Categoria/TipoErro/Criticidade/Status reais, não só CodErro/Aplicacao
    (bug corrigido em 2026-09-09: ficavam vazios, quebrando os filtros e o
    painel de contexto da app de visualização)."""
    qtd = len(exemplos_brutos)

    # Camada 2: busca exata (sem custo de IA).
    existente = client.buscar_por_assinatura(aplicacao_sugerida, msg_normalizada)
    if existente:
        fields = existente["fields"]
        cod_erro = fields["CodErro"]
        atualizacao = {
            "Ocorrencias": fields.get("Ocorrencias", 0) + qtd,
            "UltimaVez": ultimo_timestamp.isoformat(),
            "MensagemExemplo": exemplos_brutos[-1][:255],  # coluna SharePoint single-line, maxLength real e 255
        }
        status_atualizado = atualizacao.get("Status") or fields.get("Status")
        atualizacao.update(aplicar_matriz_reincidencia(fields, fields.get("Categoria"), qtd))
        status_atualizado = atualizacao.get("Status", status_atualizado)
        client.atualizar_item(existente["id"], atualizacao)
        _registrar_no_ticket(fields.get("CodProblema"), qtd, ultimo_timestamp, incidente_novo=False)
        log(f"  reincidência exata: {cod_erro} (+{qtd} ocorrências)")
        return {
            "cod_erro": cod_erro,
            "aplicacao": aplicacao_sugerida,
            "categoria": fields.get("Categoria", ""),
            "tipo_erro": fields.get("TipoErro", ""),
            "criticidade": fields.get("Criticidade", ""),
            "status": status_atualizado or "",
        }

    # Camada 2-staging (decisão 2026-09-15, a pedido do analista): mesma
    # ideia da Camada 2 acima, mas contra a "memória do dia" de itens
    # baixa/média ainda não consolidados no SharePoint (ver
    # staging_diario.py). Sem isso, o mesmo erro baixo/médio reincidindo
    # no mesmo dia gastaria IA de novo a cada ocorrência, já que a Camada
    # 2 real só vê o que já está no SharePoint.
    staged = staging_diario.buscar(aplicacao_sugerida, msg_normalizada)
    if staged:
        staging_diario.atualizar_existente(
            aplicacao_sugerida, msg_normalizada, qtd, ultimo_timestamp.isoformat(), exemplos_brutos[-1],
        )
        c = staged["classificacao"]
        log(f"  reincidência (staging, pendente de consolidação): "
            f"'{msg_normalizada[:60]}' (+{qtd})")
        return {
            "cod_erro": staged["cod_erro"],
            "aplicacao": c.get("aplicacao", aplicacao_sugerida),
            "categoria": c.get("categoria", ""),
            "tipo_erro": c.get("tipo_erro", ""),
            "criticidade": c.get("criticidade", ""),
            "status": "pendente_consolidacao",
        }

    # Camada 2.5 (decisão 2026-09-15, pós-incidente de represamento de
    # backlog): ruído de DDL idempotente conhecido (relation/constraint/
    # type/... already exists) nunca é bug real -- classifica direto, sem
    # gastar chamada de IA nem entrar na fila do teto da Camada 3. Isso é
    # exatamente o padrão que causou o backlog de ontem (494 variações de
    # "already exists" de uma restauração de schema mal feita).
    if normalizador.eh_ruido_ddl_idempotente(exemplos_brutos[0]):
        log(f"  ruído de DDL idempotente (sem custo de IA): '{msg_normalizada[:80]}'")
        classificacao = {
            "eh_reincidencia_de": None,
            "aplicacao": aplicacao_sugerida,
            "categoria": "banco",
            "tipo_erro": "Ruído de DDL idempotente (objeto já existe)",
            "descricao_resumida": "Um script tentou recriar algo no banco que já existia — sem impacto real.",
            "criticidade": "baixa",
            "camada_investigacao": "schema_banco",
            "confianca": 8,
            "ia_pode_resolver": "sem risco",
            "diagnostico": (
                "Classificado automaticamente (sem chamada de IA) por regra "
                "determinística: mensagem bate com padrão conhecido de erro de "
                "DDL idempotente do Postgres (\"já existe\"), que só ocorre quando "
                "um script de criação de schema roda de novo sobre algo que já "
                "existe (falta de IF NOT EXISTS). Nunca representa perda de dados "
                "ou bug de aplicação — confiança 8 porque o padrão é inequívoco, "
                "não 9-10 porque nenhuma IA/humano confirmou o caso específico."
            ),
            "impacto_avaliado": "Não se aplica — não há correção de código a avaliar.",
            "correcao_proposta": (
                "Nenhuma ação necessária. Se esse padrão se repetir com frequência, "
                "vale adicionar IF NOT EXISTS / IF EXISTS ao script que gera esse DDL."
            ),
        }
        # Ruído de DDL é sempre criticidade baixa -- sempre represa pro
        # resumo do fim do dia, nunca cria na hora (ver _criar_item_staging).
        # Chave do staging é sempre aplicacao_sugerida (ver nota em
        # staging_diario.buscar) -- aqui nem faz diferença de valor, já
        # que classificacao["aplicacao"] == aplicacao_sugerida neste
        # caminho, mas mantém o padrão consistente com a Camada 3 abaixo.
        return _criar_item_staging(aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd, primeiro_timestamp, ultimo_timestamp, classificacao)

    if rajada and BASE:
        cod = _ticket_rajada(rajada[0][:10], rajada[1])
        _registrar_no_ticket(cod, qtd, ultimo_timestamp, incidente_novo=True)
        log(f"  rajada de banco {rajada} -> {cod} (sem IA): '{msg_normalizada[:60]}'")
        return _criar_item_staging(aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd, primeiro_timestamp, ultimo_timestamp, {
            "eh_reincidencia_de": None, "aplicacao": aplicacao_sugerida, "categoria": "banco",
            "tipo_erro": f"Rajada de erros de banco em {rajada[0][:10]}", "descricao_resumida": "Parte de uma rajada de erros de banco (restauração/sincronização).",
            "criticidade": "baixa", "camada_investigacao": "schema_banco", "confianca": 8, "ia_pode_resolver": "sem risco",
            "diagnostico": f"Classificado por regra (sem IA): rajada {rajada}. Ver ticket {cod}.",
            "impacto_avaliado": "Nenhum para usuários.", "correcao_proposta": "Ver padrão restauracao-banco.md.",
            "cod_problema": cod,
        })

    if JEV and not normalizador.eh_ruido_ddl_idempotente(exemplos_brutos[0]):
        if len(contador_classificacoes) >= LIMITE_TRIAGENS_JEV_POR_RODADA:
            log(f"  teto de {LIMITE_TRIAGENS_JEV_POR_RODADA} triagens Jev da rodada — adiando '{msg_normalizada[:80]}'")
            return GRUPO_ADIADO
        contador_classificacoes.append(1)
        try:
            classificacao = jev_client.triar(JEV_API_KEY, BASE, aplicacao_sugerida, container,
                                             msg_normalizada, exemplos_brutos[0], qtd)
        except jev_client.JevIndisponivel as exc:
            log(f"  Jev indisponível ({exc}) — registrando como pendente de triagem")
            classificacao = None
        if classificacao:
            cod = classificacao["cod_problema"]
            if cod:
                _registrar_no_ticket(cod, qtd, ultimo_timestamp, incidente_novo=True)
            else:
                try:
                    cod = BASE.criar_ticket(jev_client.campos_ticket_novo(classificacao, aplicacao_sugerida, ultimo_timestamp.isoformat(), qtd))
                    classificacao["cod_problema"] = cod
                except Exception as exc:
                    log(f"  aviso: falha ao criar ticket: {exc}")
            classificacao.pop("_jev", None)
            log(f"  triagem Jev: {classificacao['criticidade']} / {classificacao['ia_pode_resolver']} / ticket {classificacao.get('cod_problema')}")
            if classificacao["criticidade"] in ("alta", "critica"):
                resultado = _criar_item_novo(client, aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd,
                                             primeiro_timestamp, ultimo_timestamp, classificacao)
                _alertar("Erro novo de criticidade alta/crítica", classificacao["criticidade"], classificacao["tipo_erro"],
                         classificacao.get("cod_problema"), aplicacao_sugerida, exemplos_brutos[0], classificacao["diagnostico"])
                return resultado
            return _criar_item_staging(aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd,
                                       primeiro_timestamp, ultimo_timestamp, classificacao)

    if SEM_IA or JEV:
        log(f"  novo, pendente de triagem (sem classificação por IA): '{msg_normalizada[:80]}'")
        # Criticidade "media" fica fora do gatilho do fluxo de aprovação
        # (só alta/crítica) e vai direto pro SharePoint: a consolidação
        # diária pode estar desligada, e o staging não seria visto.
        return _criar_item_novo(client, aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd,
                                primeiro_timestamp, ultimo_timestamp, {
            "eh_reincidencia_de": None,
            "aplicacao": aplicacao_sugerida,
            "categoria": "pendente",
            "tipo_erro": f"Pendente de triagem: {msg_normalizada[:200]}",
            "descricao_resumida": "Erro novo registrado sem classificação (coletor em modo sem IA).",
            "criticidade": "media",
            "camada_investigacao": "pendente",
            "confianca": 0,
            "ia_pode_resolver": "mediano",
            "diagnostico": "Não classificado: coletor rodando com --sem-ia. Aguardando triagem.",
            "impacto_avaliado": "Não avaliado.",
            "correcao_proposta": "Não avaliada.",
        })

    # Camada 3: sem match exato — classifica e checa semelhança semântica.
    if len(contador_classificacoes) >= LIMITE_CLASSIFICACOES_POR_RODADA:
        log(f"  teto de {LIMITE_CLASSIFICACOES_POR_RODADA} classificações da rodada "
            f"atingido — adiando '{msg_normalizada[:80]}' pro próximo lote")
        return GRUPO_ADIADO

    shortlist = client.listar_shortlist(aplicacao_sugerida)
    contador_classificacoes.append(1)
    try:
        classificacao = classificar(
            container=container,
            aplicacao_sugerida=aplicacao_sugerida,
            mensagem_normalizada=msg_normalizada,
            mensagem_bruta=exemplos_brutos[0],
            shortlist=shortlist,
        )
    except TarefaEscalada as exc:
        log(f"  ESCALADO: '{msg_normalizada[:80]}' — {exc.motivo}")
        registrar_escalonamento("coletor", msg_normalizada, exc.motivo, exc.diagnostico)
        if "rate limit" in exc.motivo:
            # Se bateu rate-limit, todas as próximas chamadas desta rodada
            # vão falhar do mesmo jeito -- para de tentar classificar coisa
            # nova agora em vez de bater na parede repetidas vezes.
            contador_classificacoes.extend([1] * LIMITE_CLASSIFICACOES_POR_RODADA)
        return GRUPO_ADIADO

    if classificacao.get("_custo_usd"):
        custo_acumulado.append(classificacao["_custo_usd"])
        custos.registrar("coletor", classificacao["_custo_usd"])

    aplicacao_final = classificacao["aplicacao"]

    if classificacao.get("eh_reincidencia_de"):
        cod_erro_fundido = classificacao["eh_reincidencia_de"]
        correspondente = next(
            (i for i in shortlist if i.get("CodErro") == cod_erro_fundido), None
        )
        if correspondente:
            # Precisa do item completo (id) pra fazer PATCH — busca de novo por CodErro.
            item_completo = client.buscar_por_assinatura(
                aplicacao_final, correspondente["Assinatura"]
            )
            if item_completo:
                fields = item_completo["fields"]
                atualizacao = {
                    "Ocorrencias": fields.get("Ocorrencias", 0) + qtd,
                    "UltimaVez": ultimo_timestamp.isoformat(),
                }
                status_atualizado = fields.get("Status")
                atualizacao.update(
                    aplicar_matriz_reincidencia(fields, fields.get("Categoria"), qtd)
                )
                status_atualizado = atualizacao.get("Status", status_atualizado)
                client.atualizar_item(item_completo["id"], atualizacao)
                log(f"  fundido via IA com {cod_erro_fundido} (+{qtd} ocorrências)")
                return {
                    "cod_erro": cod_erro_fundido,
                    "aplicacao": aplicacao_final,
                    "categoria": fields.get("Categoria", ""),
                    "tipo_erro": fields.get("TipoErro", ""),
                    "criticidade": fields.get("Criticidade", ""),
                    "status": status_atualizado or "",
                }
        log(f"  aviso: IA apontou fusão com {cod_erro_fundido} mas item não foi "
            f"reencontrado — criando novo por segurança")

    # Item genuinamente novo. Decisão 2026-09-15 (a pedido do analista):
    # só alta/crítica cria na hora no SharePoint (dispara o fluxo de
    # aprovação em tempo real); baixa/média fica represado no staging até
    # a consolidação do fim do dia (consolidar_diario.py) -- menos volume
    # de notificação em tempo real, sem perder nada (tudo já vai pro
    # Parquet de qualquer forma).
    if classificacao["criticidade"] in ("alta", "critica"):
        return _criar_item_novo(
            client, aplicacao_final, msg_normalizada, exemplos_brutos, qtd,
            primeiro_timestamp, ultimo_timestamp, classificacao,
        )
    # Chave do staging é sempre aplicacao_sugerida, nunca aplicacao_final
    # (ver nota em staging_diario.buscar) -- podem divergir aqui de
    # verdade, já que a Camada 3 deixa a IA decidir a aplicação real (ex:
    # itp_postgres sugere "ITP", mas a IA pode classificar como "BD").
    return _criar_item_staging(
        aplicacao_sugerida, msg_normalizada, exemplos_brutos, qtd,
        primeiro_timestamp, ultimo_timestamp, classificacao,
    )


def _criar_item_staging(
    aplicacao_chave: str,
    msg_normalizada: str,
    exemplos_brutos: list[str],
    qtd: int,
    primeiro_timestamp: datetime,
    ultimo_timestamp: datetime,
    classificacao: dict,
) -> dict:
    """Registra o item na memória do dia (staging_diario.py) em vez de
    criar na SharePoint List agora -- usado pra criticidade baixa/média
    (Camada 2.5 e Camada 3). O CodErro é gerado aqui, não na consolidação,
    pra manter a mesma FK no Parquet desde a primeira ocorrência do dia.

    aplicacao_chave é só a chave de dedup (aplicacao_sugerida do
    container) -- a aplicação real gravada/usada na consolidação vem de
    classificacao['aplicacao'] (pode ser diferente, ver staging_diario.buscar)."""
    cod_erro = gerar_cod_erro()
    staging_diario.criar(
        aplicacao_chave, msg_normalizada, classificacao, cod_erro, qtd,
        primeiro_timestamp.isoformat(), ultimo_timestamp.isoformat(), exemplos_brutos[-1],
    )
    log(f"  criticidade {classificacao['criticidade']} — represado pro resumo "
        f"do fim do dia (sem ir pro SharePoint agora): {cod_erro}")
    return {
        "cod_erro": cod_erro,
        "aplicacao": classificacao["aplicacao"],
        "categoria": classificacao["categoria"],
        "tipo_erro": classificacao["tipo_erro"],
        "criticidade": classificacao["criticidade"],
        "status": "resolvido" if classificacao["ia_pode_resolver"] == "sem risco" else "pendente_consolidacao",
    }


def _criar_item_novo(
    client: GraphClient,
    aplicacao_final: str,
    msg_normalizada: str,
    exemplos_brutos: list[str],
    qtd: int,
    primeiro_timestamp: datetime,
    ultimo_timestamp: datetime,
    classificacao: dict,
    cod_erro: str | None = None,
) -> dict:
    """Cria o item novo na SharePoint List a partir de uma classificação já
    pronta -- usada pelo resultado real da IA (Camada 3, criticidade
    alta/crítica, direto), e pela consolidação diária (consolidar_diario.py,
    itens baixa/média represados no staging_diario.py o dia inteiro).

    cod_erro opcional (decisão 2026-09-15): itens represados já geram o
    CodErro no momento do staging, pra manter a mesma FK no Parquet desde
    a primeira ocorrência do dia até a consolidação -- só gera um novo se
    não vier de fora (caso normal, item alta/crítica criado na hora)."""
    cod_erro = cod_erro or gerar_cod_erro()
    novo_item = client.criar_item({
        "Title": classificacao["tipo_erro"][:255],
        "Aplicacao": aplicacao_final,
        # Nome interno real da coluna (acento em "Descrição" gerou esse
        # escape no SharePoint) — achado em teste real 2026-09-10, nunca
        # tinha sido exercitado porque os 8 itens de backfill usaram PATCH
        # manual direto com o nome certo, não passaram por criar_item().
        "Descri_x00e7__x00e3_oResumida": classificacao["descricao_resumida"].strip()[:150],
        "Categoria": classificacao["categoria"],
        "TipoErro": classificacao["tipo_erro"],
        "Assinatura": msg_normalizada[:255],  # coluna SharePoint single-line, maxLength real e 255 (achado 2026-09-14)
        "CodErro": cod_erro,
        "MensagemExemplo": exemplos_brutos[0][:255],  # coluna SharePoint single-line, maxLength real e 255
        "Ocorrencias": qtd,
        "PrimeiraVez": primeiro_timestamp.isoformat(),
        "UltimaVez": ultimo_timestamp.isoformat(),
        "Diagnostico": (
            classificacao["diagnostico"]
            + "\n\nImpacto avaliado: "
            + classificacao.get("impacto_avaliado", "(não informado)")
        ),
        "CorrecaoProposta": classificacao["correcao_proposta"],
        "Criticidade": classificacao["criticidade"],
        # Auto-resolução sem passar por aprovação humana (decisão 2026-09-15,
        # a pedido do analista): "sem risco" no vocabulário do prompt já
        # significa "não há ação/risco nenhum a avaliar" (ruído, não é bug de
        # verdade) -- exigir aprovação humana pra fechar algo que a própria
        # classificação diz não precisar de ação nenhuma só represa a fila
        # de revisão com itens que nunca deveriam ter chegado nela. Qualquer
        # outro grau de risco (seguro/mediano/alto risco) continua indo pro
        # fluxo normal de aprovação -- essa auto-resolução é só pro caso em
        # que não existe ação nenhuma proposta.
        "Fase": "resolvido" if classificacao["ia_pode_resolver"] == "sem risco" else "diagnosticado",
        "Status": "resolvido" if classificacao["ia_pode_resolver"] == "sem risco" else "aberto",
        "IAPodeResolver": classificacao["ia_pode_resolver"],
        "Confianca": classificacao["confianca"],
        "CamadaInvestigacao": classificacao["camada_investigacao"],
        **({"CodProblema": classificacao["cod_problema"]} if classificacao.get("cod_problema") else {}),
        "Reincidente": False,
        # Pré-preenchido já na criação (decisão 2026-09-15, a pedido do
        # analista): itens de criticidade baixa/média não disparam mais
        # aprovação em tempo real (vão pro resumo diário), então a
        # aprovação deles vira só trocar Status pra "aprovado" direto na
        # lista do SharePoint -- sem isso, PromptExecucao ficaria vazio e
        # o aplicador.py nunca teria o que executar (README, gap
        # conhecido). Pro fluxo de alta/crítica isso continua sendo
        # sobrescrito pelo PromptFinal do Power Automate se o aprovador
        # digitar uma instrução adicional -- este valor aqui é só o
        # padrão de partida.
        "PromptExecucao": (
            f"Diagnóstico: {classificacao['diagnostico']}\n\n"
            f"Correção proposta: {classificacao['correcao_proposta']}"
        ),
    })
    cod_cat = gerar_cod_cat(novo_item["id"])
    client.atualizar_item(novo_item["id"], {"CodCat": cod_cat})
    log(f"  item novo criado: {cod_cat} / {cod_erro} ({classificacao['categoria']}, "
        f"criticidade={classificacao['criticidade']})")
    return {
        "cod_erro": cod_erro,
        "aplicacao": aplicacao_final,
        "categoria": classificacao["categoria"],
        "tipo_erro": classificacao["tipo_erro"],
        "criticidade": classificacao["criticidade"],
        "status": "aberto",
    }


LOCK_FILE = os.path.expanduser("~/itp-stack/catalogo-erros-coletor.lock")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--desde", default=None, help="Ex: 24h, 1h — ignora o state salvo")
    parser.add_argument("--sem-ia", action="store_true", help="Não chama o Claude; erro novo vira item pendente de triagem")
    parser.add_argument("--jev", action="store_true", help="Triagem pelo Jev (exige JEV_API_KEY no catalogo_erros.env)")
    args = parser.parse_args()
    global SEM_IA, JEV
    SEM_IA = args.sem_ia
    JEV = args.jev

    # Trava de execucao unica: sem isso, duas execucoes concorrentes do
    # coletor (ex: rodada manual + cron, ou duas sessoes ao mesmo tempo)
    # podem ler o mesmo log ANTES de qualquer uma escrever na SharePoint
    # List — a Camada 2 (busca exata) nao acha nada em nenhuma das duas,
    # e as duas criam item novo pro MESMO erro. Achado real (2026-09-11):
    # 1 ocorrencia virou 4 itens duplicados na lista (CAT-0016/18/20/23),
    # outra virou 2 (CAT-0017/22), mesmo timestamp/PID exatos no log.
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("outra execução do coletor já está rodando — saindo sem fazer nada")
        return

    cfg = config.carregar_env()
    client = GraphClient(cfg)
    global BASE, JEV_API_KEY
    BASE = BaseConhecimento(client)
    if JEV:
        JEV_API_KEY = cfg.get("JEV_API_KEY", "")
        if not JEV_API_KEY:
            log("aviso: --jev sem JEV_API_KEY no env — erros novos ficam pendentes de triagem")
    state = carregar_state()
    agora = parquet_writer.agora_utc()
    janelas_manutencao = manutencao.carregar()
    custo_acumulado: list = []
    contador_classificacoes: list = []
    linhas_parquet: list[dict] = []

    for container_cfg in config.CONTAINERS:
        nome = container_cfg["nome"]
        aplicacao_sugerida = container_cfg["aplicacao_sugerida"]

        if args.desde:
            desde_iso = args.desde
        else:
            desde_iso = state.get(nome, "24h")  # primeira execução: últimas 24h

        log(f"Lendo {nome} desde {desde_iso}...")
        texto_log = logs_do_container(nome, desde_iso)
        linhas_erro = extrair_erros(texto_log)
        log(f"  {len(linhas_erro)} linha(s) com padrão de erro")
        linhas_erro = separar_manutencao(janelas_manutencao, nome, linhas_erro, normalizador.extrair_timestamp, agora)

        # Agrupa por assinatura normalizada dentro deste lote, guardando
        # também o timestamp real de cada ocorrência (quando a linha tiver).
        rajadas = detectar_rajadas(linhas_erro)
        if rajadas:
            log(f"  rajada(s) de banco detectada(s): {sorted(rajadas)}")
        grupos: dict[str, list[str]] = defaultdict(list)
        timestamps_por_grupo: dict[str, list] = defaultdict(list)
        for linha in linhas_erro:
            # Trunca já aqui, na origem — a coluna Assinatura da SharePoint
            # List tem limite real de 255 caracteres (confirmado via Graph
            # API columns em 2026-09-14 -- o comentario original dizia 500,
            # errado). Se truncássemos só na hora de gravar (e não na
            # comparação de dedup), uma mensagem longa nunca seria
            # reconhecida como reincidência (bug real, achado em revisão
            # 2026-09-09): a busca compararia a string inteira contra o que
            # foi salvo truncado, nunca batendo. Corrigido pra 255 em
            # 2026-09-14 -- com 500 aqui e 255 na gravacao real, o mesmo
            # problema podia se repetir (grupo de dedup diferente do que
            # foi persistido).
            assinatura = normalizador.normalizar(linha)[:255]
            grupos[assinatura].append(linha)
            ts = normalizador.extrair_timestamp(linha) or agora
            timestamps_por_grupo[assinatura].append(ts)

        houve_adiamento = False
        for msg_normalizada, exemplos in grupos.items():
            ts_grupo = sorted(timestamps_por_grupo[msg_normalizada])
            primeiro_ts, ultimo_ts = ts_grupo[0], ts_grupo[-1]

            # O site institucional (repo separado, SPA sem backend próprio)
            # reporta erro pro /frontend-logs do erp_itp, então cai junto
            # nos logs do erp_itp_backend — sem essa checagem, seria
            # classificado como Aplicacao=ITP por engano (achado 2026-09-11).
            aplicacao_do_grupo = (
                "SITE" if "[site-institucional]" in msg_normalizada else aplicacao_sugerida
            )

            resultado = processar_grupo(
                client=client,
                container=nome,
                aplicacao_sugerida=aplicacao_do_grupo,
                msg_normalizada=msg_normalizada,
                exemplos_brutos=exemplos,
                primeiro_timestamp=primeiro_ts,
                ultimo_timestamp=ultimo_ts,
                custo_acumulado=custo_acumulado,
                contador_classificacoes=contador_classificacoes,
                rajada=_rajada_do_grupo(exemplos, rajadas),
            )
            if resultado is GRUPO_ADIADO:
                # Fica pendente pro próximo lote -- não avança o state deste
                # container, senão essas linhas de log somem sem nunca terem
                # sido processadas (docker logs --since não devolve o passado).
                houve_adiamento = True
                continue
            for ts_ocorrencia in ts_grupo:
                linhas_parquet.append({
                    "CodErro": resultado["cod_erro"],
                    "Aplicacao": resultado["aplicacao"],
                    "Categoria": resultado["categoria"],
                    "TipoErro": resultado["tipo_erro"],
                    "MensagemNormalizada": msg_normalizada,
                    "Criticidade": resultado["criticidade"],
                    "StatusNoMomento": resultado["status"],
                    "TimestampOcorrencia": ts_ocorrencia,
                    "FoiAutoCorrigido": False,
                })

        if not houve_adiamento:
            state[nome] = agora.isoformat()
            # Salva incrementalmente, não só no fim de tudo (decisão
            # 2026-09-16, achado real): salvar_state() só rodava 1x no
            # final de main() -- qualquer falha não tratada mais adiante
            # (ex: 400 do Graph API, timeout de rede) derrubava o script
            # inteiro ANTES de persistir, descartando o progresso de TODO
            # container já processado com sucesso na mesma rodada. Isso
            # causava releitura + recontagem da mesma janela de log
            # repetidamente (Ocorrencias inflado sem evento real
            # acontecer de novo) até a falha parar de ocorrer sozinha --
            # achado investigando CAT-0137 (contador em 344, só 8
            # ocorrências reais no log bruto).
            salvar_state(state)
        else:
            log(f"  {nome}: state não avançado (há grupo(s) adiado(s) pro próximo lote)")

    # Fonte 2: falhas de cron/tarefa (tarefas-timing/*.jsonl) -- mesmo
    # pipeline de classificacao+SharePoint dos containers, achado real
    # 2026-09-14: essas falhas nunca tinham visibilidade nenhuma fora do
    # jsonl bruto.
    for tarefa_cfg in carregar_registro_tarefas():
        task_id = tarefa_cfg["id"]
        state_key = f"tarefa:{task_id}"
        desde_iso = args.desde or state.get(state_key, "24h")
        log(f"Lendo falhas da tarefa {task_id} desde {desde_iso}...")
        falhas = falhas_da_tarefa(task_id, tarefa_cfg.get("log_path"), desde_iso)
        log(f"  {len(falhas)} execucao(oes) com falha")
        falhas = separar_manutencao(
            janelas_manutencao, task_id, falhas, lambda f: datetime.fromisoformat(f["inicio"]), agora
        )

        aplicacao_sugerida = "APRXM" if task_id.startswith("aprxm-") else "ITP"
        # Uma assinatura por tarefa (nao por execucao) -- falhas repetidas da
        # MESMA tarefa devem se agrupar/reincidir, nao virar item novo cada vez.
        msg_normalizada = f"Tarefa agendada '{task_id}' falhando (exit_code != 0)"
        exemplos = [
            f"tarefa={task_id} exit_code={f['exit_code']} inicio={f['inicio']} "
            f"duracao_s={f.get('duracao_s')}\n--- trecho do log ---\n{f['_trecho_log'][-1500:]}"
            for f in falhas
        ]
        adiado = False
        if exemplos:
            timestamps = sorted(datetime.fromisoformat(f["inicio"]) for f in falhas)
            resultado = processar_grupo(
                client=client,
                container=task_id,
                aplicacao_sugerida=aplicacao_sugerida,
                msg_normalizada=msg_normalizada,
                exemplos_brutos=exemplos,
                primeiro_timestamp=timestamps[0],
                ultimo_timestamp=timestamps[-1],
                custo_acumulado=custo_acumulado,
                contador_classificacoes=contador_classificacoes,
            )
            if resultado is GRUPO_ADIADO:
                adiado = True
            else:
                for ts_ocorrencia in timestamps:
                    linhas_parquet.append({
                        "CodErro": resultado["cod_erro"],
                        "Aplicacao": resultado["aplicacao"],
                        "Categoria": resultado["categoria"],
                        "TipoErro": resultado["tipo_erro"],
                        "MensagemNormalizada": msg_normalizada,
                        "Criticidade": resultado["criticidade"],
                        "StatusNoMomento": resultado["status"],
                        "TimestampOcorrencia": ts_ocorrencia,
                        "FoiAutoCorrigido": False,
                    })
        if not adiado:
            state[state_key] = agora.isoformat()
            salvar_state(state)  # ver comentário no loop de containers acima
        else:
            log(f"  tarefa {task_id}: state não avançado (adiado pro próximo lote)")

    if linhas_parquet:
        arquivos = parquet_writer.agrupar_e_gravar(config.PARQUET_BASE_DIR, linhas_parquet)
        log(f"Parquet: {len(arquivos)} arquivo(s) gravado(s), {len(linhas_parquet)} linha(s) no total")

    salvar_state(state)

    if custo_acumulado:
        log(f"Custo estimado de IA nesta execução: ${sum(custo_acumulado):.4f} "
            f"({len(custo_acumulado)} chamada(s) ao Claude)")
    teto_atingido = len(contador_classificacoes) >= LIMITE_CLASSIFICACOES_POR_RODADA
    log(f"Classificações desta rodada: {min(len(contador_classificacoes), LIMITE_CLASSIFICACOES_POR_RODADA)}"
        f"/{LIMITE_CLASSIFICACOES_POR_RODADA}")
    _escrever_metrica_teto(teto_atingido)
    log("Coleta concluída.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log(f"ERRO FATAL: {exc}")
        sys.exit(1)
