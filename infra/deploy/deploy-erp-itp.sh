#!/usr/bin/env bash
# Deploy automático do erp_itp na VM. Roda pelo cron e só age quando a main muda:
# backup do banco -> tag de rollback -> build -> up -> health check.
# Falhou o build ou o health check: volta as imagens antigas e avisa por e-mail.
# O corpo fica dentro de main() porque o git pull reescreve este arquivo durante a execução.
set -uo pipefail

REPO=/home/itpadmin/erp_itp
STACK=/home/itpadmin/itp-stack
BACKUPS=/home/itpadmin/backups
SERVICOS=(erp_itp_backend erp_itp_frontend)
MANTER_BACKUPS=10
MARCA_FALHA="$STACK/.deploy-erp-itp-falhou"

log() { echo "$(date '+%F %T') $*"; }

avisar() {
    (cd "$REPO/catalogo-erros" && python3 -c \
        'import sys, html, notificador; notificador.enviar_email(sys.argv[1], "<pre>" + html.escape(sys.argv[2]) + "</pre>")' \
        "$1" "$2") || log "falha ao enviar e-mail: $1"
}

http_status() {  # $1 host, $2 caminho, resto: argumentos do curl. Passa pelo Traefik local.
    local host=$1 caminho=$2; shift 2
    curl -sk -o /dev/null -w '%{http_code}' -m 15 --resolve "$host:443:127.0.0.1" "$@" "https://$host$caminho" 2>/dev/null
}

# Só HTTP, sem esperar "Nest application successfully started" no log: commit que não muda a
# imagem (docs, catalogo-erros, infra) não recria o container, a linha nunca aparecia e o deploy
# revertia um commit saudável (29/09). Depois do `up -d` só o container novo responde.
saudavel() {
    local i front back
    for i in $(seq 1 36); do
        sleep 5
        front=$(http_status itp.institutotiapretinha.org /login)
        back=$(http_status api.itp.institutotiapretinha.org /api/auth/login -X POST -H 'Content-Type: application/json' -d '{}')
        # front 200 = Next no ar; back 400/401 = requisição chegou no Nest (502/404 seriam Traefik).
        [[ $front == 200 && $back =~ ^40[01]$ ]] && return 0
    done
    log "health check falhou (front=${front:-?} back=${back:-?})"
    return 1
}

main() {
    exec 9>/tmp/deploy-erp-itp.lock
    flock -n 9 || exit 0

    cd "$REPO" || exit 1
    git fetch -q origin main || { log "git fetch falhou"; exit 1; }
    local atual novo
    atual=$(git rev-parse HEAD)
    novo=$(git rev-parse origin/main)
    [[ $atual == "$novo" ]] && exit 0
    # Commit que já falhou não é tentado de novo a cada rodada; espera o próximo.
    [[ -f $MARCA_FALHA && $(cat "$MARCA_FALHA") == "$novo" ]] && exit 0

    local resumo
    resumo=$(git log --oneline "$atual..$novo" | head -30)
    log "deploy ${atual:0:8}..${novo:0:8}"

    if ! git merge --ff-only -q origin/main; then
        echo "$novo" > "$MARCA_FALHA"
        avisar "[erp_itp] Deploy NÃO feito: git pull falhou" \
            "A cópia em $REPO não avança por fast-forward até ${novo:0:8} (alteração local?). Nada foi alterado em produção."
        return 1
    fi

    mkdir -p "$BACKUPS"
    local backup="$BACKUPS/erp_itp_db-pre-deploy-$(date +%Y%m%d-%H%M).sql.gz" pg
    pg=$(cd "$STACK" && docker compose ps -q postgres)
    if ! docker exec "$pg" sh -c 'pg_dump -U "$POSTGRES_USER" erp_itp_db' | gzip > "$backup" \
        || [[ $(zcat "$backup" | grep -c '^COPY ') -eq 0 ]]; then
        git reset -q --hard "$atual"
        echo "$novo" > "$MARCA_FALHA"
        avisar "[erp_itp] Deploy NÃO feito: backup do banco falhou" "Backup vazio ou com erro: $backup. Produção segue em ${atual:0:8}."
        return 1
    fi
    ls -1t "$BACKUPS"/erp_itp_db-pre-deploy-*.sql.gz | tail -n +$((MANTER_BACKUPS + 1)) | xargs -r rm -f

    local s
    for s in "${SERVICOS[@]}"; do docker tag "itp-stack-$s:latest" "itp-stack-$s:rollback"; done

    if (cd "$STACK" && docker compose build "${SERVICOS[@]}" && docker compose up -d "${SERVICOS[@]}") && saudavel; then
        rm -f "$MARCA_FALHA"
        log "deploy ok"
        # O Grafana só lê regras/provisionamento ao subir; o diretório é link para este repositório.
        if git diff --name-only "$atual" "$novo" -- infra/monitoring/grafana | grep -q .; then
            docker restart itp_grafana >/dev/null && log "grafana reiniciado (infra/monitoring/grafana mudou)"
        fi
        avisar "[erp_itp] Deploy feito: ${novo:0:8}" "Commits publicados:
$resumo

Backup: $backup"
        return 0
    fi

    log "revertendo para as imagens anteriores"
    for s in "${SERVICOS[@]}"; do docker tag "itp-stack-$s:rollback" "itp-stack-$s:latest"; done
    (cd "$STACK" && docker compose up -d --no-build "${SERVICOS[@]}")
    git reset -q --hard "$atual"
    echo "$novo" > "$MARCA_FALHA"
    avisar "[erp_itp] Deploy FALHOU e foi revertido: ${novo:0:8}" "Build ou health check falhou; produção voltou para ${atual:0:8}.
Se uma migration rodou antes da falha, o banco pode estar à frente do código — backup: $backup
Log: $STACK/deploy-erp-itp.log

Commits que não entraram:
$resumo"
    return 1
}

main "$@"
