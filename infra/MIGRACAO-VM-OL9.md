# Migração da VM para Oracle Linux oficial (gratuito)

Plano para trocar `vm-itp-prod` por uma VM nova criada da imagem **oficial** da Oracle, eliminando a licença paga do Marketplace (~R$ 280/mês, não coberta pelo crédito de ONG — ver `CUSTOS-AZURE.md`). Inventário levantado em 2026-10-17, direto da VM.

## 1. Decisões

| Item | Atual | Novo | Motivo |
|---|---|---|---|
| Imagem | `nuvemnestllc…:01-id-oracle-linux-93-gen-2` (plano pago) | `Oracle:Oracle-Linux:ol98-lvm-gen2:latest` (sem plano) | licença paga presa ao disco; não dá para trocar na VM atual |
| Tamanho | `Standard_E2bs_v5` (2 vCPU, 16 GB) | **`Standard_D4as_v7` (4 vCPU dedicadas, 16 GB, disco NVMe)** | `B4as_v2` sem cota na assinatura (pedido recusado pela Microsoft em 07/09 e 21/10); ver `AVALIACAO-SEPARACAO-ITP-APRXM.md` §8 |
| Disco do SO | Premium SSD 128 GB | **Standard SSD** 128 GB | economia ~R$ 45/mês, sem janela extra |
| Região / rede | eastus2, `vnet-eastus2-1` | mesma | cópia de dados pela rede privada |
| IP público | `vm-itp-prod-ip` | **o mesmo IP, movido na virada** | sem mudar DNS; volta imediata |
| NSG | `vm-itp-prod-nsg` | o mesmo, associado à NIC nova | regras iguais |
| Tailscale | nó `vm-itp-prod` | **mesmo nó** (estado copiado na virada) | mantém o IP do Tailscale, `~/.ssh/config` e DBeaver |
| Assinatura | Azure subscription 1 | a mesma | crédito já aplicado nela pelo suporte |

Custo extra durante a migração: as duas VMs ligadas ao mesmo tempo (~R$ 20/dia de VM nova, sem licença). Planejar para durar poucos dias.

## 2. Inventário — o que precisa existir na VM nova

**Pacotes / repositórios**
- Repos: `docker-ce-stable`, `tailscale-stable`, `nodesource-nodejs`, `packages-microsoft-com-prod` (azure-cli), `ol9_developer_EPEL`, `ol9_codeready_builder`, `ksplice-uptrack`.
- Docker CE 28.x + compose plugin 5.x + buildx; Tailscale; Node.js 22; git; Python 3.9; Azure CLI.
- Desktop remoto: MATE, `xrdp` + `xorgxrdp` + **`xrdp-selinux`**, X2Go server, Firefox; DBeaver em `~/apps/dbeaver`. Configuração em `VM-ACESSO-E-CONFIG.md` §2 (codec RFX, `.Xclients`, regra de firewall do 3389).
- Claude Code CLI em `/usr/local/bin/claude` (usado pelo JirAIa/catálogo de erros).

**Sistema**
- SELinux Enforcing; swapfile 1 GB; `vm.swappiness=10` (`/etc/sysctl.d/99-swappiness.conf`); `/tmp` em tmpfs `nosuid,nodev,noexec` (fstab).
- firewalld zona `public`: serviços `ssh`, `cockpit`, `dhcpv6-client` + rich rule 3389 só para `100.64.0.0/10`.
- sshd só chave (`PasswordAuthentication no`); usuário `itpadmin` com sudo; `target` padrão `multi-user`.

**Serviços (systemd)**
- `docker`, `tailscaled`, `xrdp`, `atd`.
- `tarefas-api.service` — uvicorn em `:8002`, código em `/opt/itp-stack` (venv `tarefas-venv`). O `catalogo_backend` acessa via `host.docker.internal:8002`.
- `actions.runner.erickcardosoitp-aprxm_sys.vm-itp-prod-aprxm` — runner self-hosted do GitHub do `aprxm_sys` em `~/actions-runner-aprxm`. **Re-registrar** na VM nova (token em GitHub → aprxm_sys → Settings → Actions → Runners).

**Arquivos a copiar**
| Origem | Tamanho | Observação |
|---|---|---|
| `/opt/itp-stack` | 57 MB | `tarefas_api.py`, `tarefas_runner.py`, venv |
| `~/itp-stack` | 19 MB | `.env`, `*.env`, `clickhouse-config/`, `monitoring/`, `tarefas/`, estado do catálogo, `tarefas-registro.json`; `docker-compose.yml` é symlink para o repo |
| `~/erp_itp`, `~/aprxm_sys` | 142 MB | repositórios (ou `git clone` com as deploy keys) |
| `~/.ssh` | — | deploy keys `erp_itp_deploy_key`, `aprxm_sys_deploy_key`, `config`, `authorized_keys` |
| `~/.claude` | 83 MB | credenciais OAuth do Claude Code (se não valerem, refazer login) |
| `~/.azure` | — | não copiar: VM nova usa a própria identidade gerenciada |
| `~/apps`, `~/logs-diarios`, `~/backups`, `~/.Xclients` | ~560 MB | |
| `/var/lib/tailscale` | — | **só na virada**, com o tailscaled parado nas duas |

**Volumes Docker** (cópia com a stack parada)
| Volume | Tamanho |
|---|---|
| `itp-stack_prometheus_data` | 3,2 GB |
| `itp-stack_grafana_data` | 530 MB |
| `itp-stack_pg_data` | 224 MB (bancos `erp_itp_db` 20 MB, `aprxm_db` 83 MB; `ALTER SYSTEM log_line_prefix`) |
| `itp-stack_clickhouse_data` | 19 MB |
| `itp-stack_traefik_letsencrypt` | 79 kB (certificados) |
| `portainer_data` | sobra antiga — **não migrar** |

**Agendamentos** — crontab do `itpadmin` (copiar inteiro): 20 tarefas via `tarefas_runner.py` (backups Postgres/APRXM → Neon, snapshot, ClickHouse, ETL e rotinas do APRXM, catálogo de erros, relatório do Grafana), consolidação diária e investigador do JirAIa, heartbeat do healthchecks.io a cada 5 min e o deploy automático do `erp_itp`.

**Azure**
- Identidade gerenciada da VM nova (system-assigned) com os mesmos papéis da atual: `Disk Snapshot Contributor` em `rg-itp-prod`, `Reader` **no disco novo** e `Storage Account Contributor` em `stitperpprod`.
- `~/itp-stack/tarefas/vm-snapshot.sh`: trocar `DISK_ID` para o disco novo.
- 7 alertas de métrica (CPU, memória, IOPS, rede, disponibilidade) estão presos ao recurso da VM antiga: recriar para a nova.
- Extensão `LinuxDiagnostic`: não recriar (os alertas usam métricas da plataforma).

## 3. Fases

### Fase 0 — Isolamento e credenciais (na VM atual, antes da migração)
Obrigatório com ITP e APRXM na mesma VM (ver `AVALIACAO-SEPARACAO-ITP-APRXM.md` §6):
1. Trocar as senhas do Postgres (`itp_admin`), do ClickHouse (`aprxm`) e do banco de analytics no Neon — expostas em 17/10. Janela curta à noite (cada sistema reinicia em segundos).
2. Usuário de banco por sistema (`erp_itp_app`, `aprxm_app`), com acesso só ao próprio banco; `itp_admin` só para administração.
3. Armazenamento: conta própria para o APRXM (ou SAS/RBAC por contêiner).
4. App registration por sistema, com `Mail.Send` restrito à caixa de cada um.
5. APRXM: imagens construídas no GitHub e só baixadas na VM; proteção da `main` do `aprxm_sys`.
6. Remover `VERCEL_*`/`TURBO_*` do `aprxm_backend.env`.


### Fase 1 — Montagem (sem impacto)
> **Concluída em 21/10/2026.** VM `172.16.0.5` (acesso `ssh -J vm-itp-prod itpadmin@172.16.0.5`). LV raiz estendido para 111 GB. Pacotes iguais aos da antiga, exceto Ksplice (vem da licença paga); Docker fixado em 28.5.2 (`dnf versionlock`). Arquivos copiados com `rsync`; crontab com as 22 linhas comentadas (`#MIGRACAO#`); `tarefas-api` instalado e desligado; papéis da identidade atribuídos; `vm-snapshot.sh` já aponta para o disco novo. Falta: senha do `itpadmin` para o RDP (`sudo passwd itpadmin`).
>
> Cuidados para a virada:
> - O `itpadmin` da imagem nasce com uid 1000; a antiga usa 1001. Foi alinhado para 1001 (`usermod`). Sem isso, `rsync --numeric-ids` deixa o `~/.ssh` com outro dono e o SSH trava.
> - Na cópia do delta de `~/itp-stack` (Fase 3), excluir `tarefas/vm-snapshot.sh` para não voltar o `DISK_ID` antigo.
> - Chave temporária `~/.ssh/migracao_ol9` (antiga → nova): remover das duas VMs na Fase 4.

1. Criar a VM nova `vm-itp-prod-ol9` na mesma VNet/sub-rede, **sem IP público**, NIC com o NSG atual, disco Standard SSD 128 GB, identidade gerenciada ligada.
2. Acesso inicial: pela VM antiga, via IP privado (`ssh` de dentro da VNet).
3. Instalar pacotes e configurar o sistema (seção 2). Tailscale **ainda não** autenticado.
4. Copiar `/opt/itp-stack`, `~/itp-stack`, repos, `~/.ssh`, `~/.claude`, `~/apps`, crontab (**comentado**), units do systemd (**desativadas**).
5. Papéis da identidade gerenciada; ajustar `vm-snapshot.sh`.

### Fase 2 — Ensaio (sem impacto)
1. Copiar os volumes com a stack **antiga ainda no ar** (cópia "suja", só para teste): `pg_dumpall`/restore e `tar` dos demais.
2. Subir a stack na nova com o Traefik **sem** pedir certificados (sem IP público, o Let's Encrypt falharia): testar ERP, API, APRXM, Grafana e catálogo pelo IP privado com `curl --resolve`.
3. Rodar à mão cada tarefa do `tarefas_runner.py` que não escreve em produção externa (ou validar só a sintaxe/credenciais das que escrevem, como backup → Neon e e-mails).
4. Cronometrar a cópia dos volumes para estimar a janela.
5. Derrubar a stack na nova e apagar os dados de teste.

### Fase 3 — Virada (janela à noite, ~30–45 min fora do ar)
1. Avisar usuários. Na antiga: comentar o crontab (inclui o deploy automático e o heartbeat — **pausar o healthchecks.io** antes, para não alarmar) e parar `tarefas-api` e o runner.
2. `docker compose stop` na antiga.
3. Copiar volumes (consistentes, stack parada) e o delta de `~/itp-stack` (estado do catálogo, logs).
4. Tailscale: parar `tailscaled` nas duas, copiar `/var/lib/tailscale` para a nova, desligar o tailscaled da antiga (`systemctl disable --now`), ligar na nova.
5. **Mover o IP público**: desassociar da NIC antiga e associar à nova.
6. Na nova: `docker compose up -d`; ativar `tarefas-api`; descomentar crontab; re-registrar o runner do GitHub.
7. Verificações: `itp.`, `api.itp.`, `aprxm.`, `api-aprxm.`, `grafana.itp.` respondendo com certificado válido; login no ERP; prestação de contas pública; `docker compose ls` = running(16); healthchecks.io recebendo ping; `ssh vm-itp-prod` (Tailscale) e RDP funcionando.
8. Retomar o healthchecks.io. Desligar (deallocate) a VM antiga.

### Volta (se algo falhar na virada)
Parar a stack na nova → devolver o IP público à NIC antiga → restaurar o tailscaled na antiga → ligar a VM antiga e `docker compose up -d` → descomentar o crontab. Os dados da antiga não foram alterados (stack só parada).

### Fase 4 — Limpeza (após 7 dias estável)
- Apagar VM antiga, NIC, disco Premium e os snapshots dela.
- Renomear/ajustar referências (`VM-ACESSO-E-CONFIG.md`, `ARCHITECTURE.md`, `CUSTOS-AZURE.md`).
- Conferir na fatura seguinte que a linha "Oracle Linux 9.3 - Gen 2" sumiu.

## 4. Pré-requisitos antes de começar
- [ ] Data e horário da virada combinados (noite, fora do uso do ERP e do APRXM).
- [ ] Acesso ao GitHub do `aprxm_sys` para gerar o token do runner.
- [ ] Acesso ao healthchecks.io para pausar o check durante a virada.
- [ ] Backup recente do Postgres conferido (`~/backups` e Neon).
