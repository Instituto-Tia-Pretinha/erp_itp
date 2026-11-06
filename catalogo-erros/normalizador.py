"""Camada 1 do fingerprinting (spec seção 6): normalização determinística
via regex, sem custo de IA. Remove o que é sempre variável entre
ocorrências do mesmo erro, pra permitir comparação exata na Camada 2.

Princípio de segurança do design: normalizar de menos (deixar coisa
variável passar) é seguro — só gera um item duplicado a mais. Normalizar
de mais (mascarar algo que na verdade distingue dois erros diferentes) é
perigoso — funde bugs diferentes num só. Por isso as regras aqui são
conservadoras.
"""
import re
from datetime import datetime, timezone

_TIMESTAMP = re.compile(
    r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?\s*(UTC|Z|[+-]\d{2}:?\d{2})?"
)
_TIMESTAMP_CAPTURA = re.compile(
    r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?"
)
_PID = re.compile(r"\[\d+\]")
_UUID = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
# Números soltos (posição de caractere, IDs numéricos, PIDs sem colchete).
# Não mexe em números colados a letra (ex: "v23", "erp_itp_backend").
_NUMERO_SOLTO = re.compile(r"(?<![a-zA-Z_])\d+(?![a-zA-Z_])")
# Sequências CSI completas (ECMA-48), não só código de cor terminado em 'm'
# (comum em logs de app tipo Nest Logger). O padrão antigo (\x1b\[[0-9;]*m)
# só cobria cor -- achado real 2026-09-14: um ESC de outro tipo de sequência
# CSI (ex: \x1b[?...) passava intacto, quebrando a query OData pro Graph API
# (400 Bad Request no $filter, coletor.py crashava com exit_code=1, 40
# ocorrencias entre 2026-09-13 23:45 e 2026-09-14 03:15 -- ver CAT do
# catalogo, achado pelo proprio coletor via Fonte 2/tarefa). Forma geral de
# sequência CSI: ESC '[' bytes-de-parametro(0x30-0x3F) bytes-intermediarios
# (0x20-0x2F) byte-final(0x40-0x7E).
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
# Defesa em profundidade: qualquer caractere de controle C0 remanescente
# (fora do intervalo visível), exceto espaço/tab -- nunca faz parte do
# conteudo semantico de uma mensagem de erro, entao remover nao corre risco
# de fundir erros diferentes (principio do docstring acima).
_CONTROLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def normalizar(mensagem: str) -> str:
    """Aplica as substituições na ordem certa (timestamp/uuid antes de
    número solto, senão o regex de número já teria comido os dígitos)."""
    m = mensagem.strip()
    m = _ANSI.sub("", m)
    m = _CONTROLE.sub("", m)
    m = _TIMESTAMP.sub("<timestamp>", m)
    m = _UUID.sub("<uuid>", m)
    m = _PID.sub("[N]", m)
    m = _NUMERO_SOLTO.sub("N", m)
    m = re.sub(r"\s+", " ", m)  # colapsa espaços múltiplos (efeito colateral das trocas acima)
    return m.strip()


def contem_erro(linha: str, padrao) -> bool:
    return bool(re.search(padrao, linha, re.IGNORECASE))


# Access log do Traefik: IP - - [timestamp] "METODO /path HTTP/x.x" STATUS ...
# Achado real (CAT-0010/CAT-0013): a palavra "error" aparece só no nome de um
# asset estático (ex: /_next/static/chunks/app/error-<hash>.js), sem relação
# com falha — o request teve status 2xx/3xx. Isso não é log de app, é acesso
# ok, então nunca deveria ter caído no PADRAO_ERRO em primeiro lugar.
# 4xx também: robô pedindo /owa/auth/errorFE.aspx (PRB-0070) ou aba antiga pedindo
# /static/chunks/app/error-<hash>.js depois de deploy (PRB-0032/0033) recebem 404 e não são
# falha do sistema. Só 5xx no access log conta como erro.
_ACCESS_LOG_OK = re.compile(
    r'"\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP/[\d.]+"\s+([234]\d{2})\b'
)


def eh_access_log_ok(linha: str) -> bool:
    return bool(_ACCESS_LOG_OK.search(linha))


# Grafana (e outros apps com logger estruturado no estilo logfmt) marca o
# nivel explicitamente: level=info/warn/error/debug. Achado real 2026-09-14
# (CAT-0040): "logger=plugins.update.checker level=info msg=\"flag evaluation
# succeeded\" ... ErrorCode: ErrorMessage: ..." casava com PADRAO_ERRO so
# porque o struct tem campos vazios chamados ErrorCode/ErrorMessage -- 144
# linhas identicas, 100% ruido, level=info o tempo todo (nunca virou erro
# de verdade). Se o proprio logger da app diz que e level=info, nao e erro,
# ponto final -- não precisa nem chamar a IA pra descartar.
_NIVEL_LOGFMT_NAO_ERRO = re.compile(r'\blevel=(info|debug)\b', re.IGNORECASE)


def eh_nivel_nao_erro(linha: str) -> bool:
    return bool(_NIVEL_LOGFMT_NAO_ERRO.search(linha))


# Camada 2.5 (decisão 2026-09-15, pós-incidente de represamento de backlog):
# ruído de DDL idempotente do Postgres -- "já existe" nunca é bug real, é
# sempre sintoma de um script de criação de schema rodando de novo sobre um
# schema que já tem aquele objeto (idempotência mal feita, sem IF NOT
# EXISTS). Restrito a "already exists"/"multiple primary keys ... not
# allowed", que são inequivocamente seguros -- "does not exist" fica de
# fora de propósito, porque isso PODE ser um bug real (algo que deveria
# existir e não existe), não dá pra descartar sem investigar.
_DDL_RUIDO_IDEMPOTENTE = re.compile(
    r'\b(relation|constraint|type|schema|extension|index|trigger|sequence|'
    r'view|function|column|table|role|database)\b[^\n]{0,120}already exists'
    r'|multiple primary keys for table [^\n]{0,80} are not allowed',
    re.IGNORECASE,
)


def eh_ruido_ddl_idempotente(linha: str) -> bool:
    return bool(_DDL_RUIDO_IDEMPOTENTE.search(linha))


def extrair_timestamp(linha: str):
    """Tenta achar um timestamp real na linha (formato Postgres/ISO, ex:
    '2026-09-09 11:27:07.759 UTC'). Devolve datetime UTC, ou None se a
    linha não tiver timestamp reconhecível (ex: log sem timestamp próprio,
    caso comum de app que deixa isso a cargo do driver do Docker)."""
    m = _TIMESTAMP_CAPTURA.search(linha)
    if not m:
        return None
    data_str, hora_str, frac = m.group(1), m.group(2), m.group(3) or ""
    try:
        dt = datetime.strptime(data_str + " " + hora_str, "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
