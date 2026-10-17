# Avaliação: ITP e APRXM na mesma VM ou em VMs separadas

Levantamento de 2026-10-17 (containers, bancos, armazenamento, integrações, custos) para decidir a arquitetura da migração (`MIGRACAO-VM-OL9.md`). Sem senhas ou chaves neste documento.

## 1. Consumo real (Prometheus, média e pico dos últimos 7 dias)

| Sistema | Container | Memória média / pico (MB) | CPU média / pico (%) |
|---|---|---|---|
| ITP | `erp_itp_backend` | 118 / 169 | 0,6 / 0,6 |
| ITP | `erp_itp_frontend` | 151 / 173 | 0,4 / 0,4 |
| ITP | `catalogo_backend` + `catalogo_frontend` | 212 / 214 | 0,1 / 0,1 |
| APRXM | `aprxm_backend` | 279 / 524 | 5,0 / 7,8 |
| APRXM | `aprxm_clickhouse` | 1.004 / 1.068 | 1,2 / 1,4 |
| APRXM | `aprxm_presidencia` | 3 / 3 | 0 / 0 |
| Compartilhado | `itp_postgres` (bancos dos dois) | 215 / 237 | 0,5 / 0,8 |
| Compartilhado | `itp_traefik` (entrada HTTPS dos dois) | 62 / 66 | 0,3 / 1,1 |
| Monitoramento | Grafana + renderer + Prometheus + cAdvisor + exporters | ~1.470 / ~2.400 | ~8 / ~10 (cAdvisor já reduzido em 17/10) |

Host (15 GB): CPU média **7,9%**, pico **18,8%**; memória disponível nunca abaixo de **5 GB** (pico de uso inclui builds de deploy e o Metabase/pgAdmin, já removidos). **Desempenho não é motivo para separar** — sobra recurso.

## 2. O que é compartilhado entre os dois sistemas

| Recurso | Situação | Risco |
|---|---|---|
| **Postgres** | `erp_itp_db` (20 MB) e `aprxm_db` (83 MB) no mesmo servidor; **o APRXM conecta com o superusuário `itp_admin`**, o mesmo do ITP | APRXM lê e altera o banco do ERP (dados de crianças). Senha fraca |
| **Blob Storage** `stitperpprod` | contêiner `arquivos` (ITP, 599 arquivos, 165 MB) e `aprxm-midia` (APRXM, 16.870 arquivos, 1,15 GB); acesso por chave da **conta inteira** | cada backend lê os arquivos do outro, inclusive documentos das crianças |
| **ClickHouse** `aprxm_clickhouse` | bancos `aprxm_analytics` (APRXM) e `catalogo_erros` (ITP) | pequeno (dados de erro), mas acopla os dois |
| **App registration do Entra** | o mesmo `MS_CLIENT_ID/SECRET` no ITP, APRXM, Grafana, catálogo e relatório; permissão `Mail.Send` | vazamento em qualquer um permite enviar e-mail como qualquer caixa do Instituto |
| **Runner do GitHub Actions** | runner do `aprxm_sys` roda **na VM de produção**; o repositório `aprxm_sys` é privado no plano gratuito, **sem proteção na `main`** | quem tem escrita no `aprxm_sys` (inclui colaborador externo) executa código no host onde estão os dados do ITP. Docker no host = acesso de root |
| **Traefik / certificados** | uma entrada HTTPS para os 5 domínios | baixo |
| **Tarefas agendadas** (`/opt/itp-stack`, cron) | 20 tarefas, 10 do APRXM e 10 do ITP, no mesmo runner | baixo |
| **Monitoramento e catálogo de erros** | um Grafana/Prometheus; o coletor lê logs dos dois | baixo (desejável continuar centralizado) |

## 3. Integrações externas por sistema

| Sistema | Serviços |
|---|---|
| ITP | Gemini e Tavily (captação), Microsoft Graph (e-mail), Azure Blob (`arquivos`), Neon (backup do Postgres) |
| APRXM | Neon (banco de analytics + backup), Cloudflare R2, Groq (IA), Web Push (VAPID), WebAuthn, Microsoft Graph (e-mail), Azure Blob (`aprxm-midia`) |
| Catálogo de erros (ITP) | SharePoint (lista), API de IA (JirAIa), ClickHouse |

Limpeza: o `aprxm_backend.env` ainda tem ~20 variáveis `VERCEL_*` (inclusive `VERCEL_OIDC_TOKEN`) e `TURBO_*` da época da Vercel — remover.

## 4. Custos (preço oficial Azure, eastus2, Linux, sem licença)

| Opção | Configuração | US$/mês |
|---|---|---|
| Hoje | `E2bs_v5` (2 vCPU, 16 GB) + Premium 128 GB + licença paga | ~135 + ~54 de licença fora do crédito |
| **A — uma VM migrada** | `E2bs_v5` + Standard SSD 128 GB | ~122 |
| **B — duas VMs** | ITP `B2as_v2` (2 vCPU, 8 GB) + APRXM `B2as_v2` (2 vCPU, 8 GB), Standard SSD 64 GB cada, 2 IPs | ~127 |
| B' — duas VMs, APRXM menor | APRXM em `B2als_v2` (4 GB) | ~100 (apertado com ClickHouse 1,5 GB + builds do runner) |

Crédito disponível: ~US$ 180/mês até 27/07/2027. **Todas as opções cabem.** As VMs B são "burstable": ideal para uso médio baixo como o medido (8%), com folga para os picos de build.

## 5. Na balança

| Critério | A — uma VM | B — duas VMs |
|---|---|---|
| Custo | ~US$ 122 | ~US$ 127 |
| Isolamento de dados (banco, blob, segredos) | **alcançável** com as correções da seção 6 | idem, mais isolamento físico |
| Isolamento do deploy do APRXM (runner, Docker = root) | **não alcançável** no mesmo host | resolvido |
| Falha/sobrecarga de um derruba o outro | sim | não |
| Manutenção (patches, backups, monitoramento) | 1 servidor | 2 servidores (monitoramento continua central) |
| Esforço da migração | menor | maior: separar `aprxm_db`, ClickHouse, tarefas e runner |
| Custo por sistema visível | não | sim |

## 6. Correções necessárias em qualquer opção
1. **Trocar as credenciais** do Postgres (`itp_admin`), Neon (analytics do APRXM) e ClickHouse (`aprxm`) — expostas em 17/10 durante este levantamento.
2. **Usuário próprio no Postgres** para cada sistema, com acesso só ao seu banco; `itp_admin` só para administração.
3. **Contas de armazenamento separadas** (ou, no mínimo, SAS/RBAC por contêiner em vez da chave da conta).
4. **App registration por sistema**, com `Mail.Send` restrito à caixa de cada um (Application Access Policy).
5. **Proteção da `main` do `aprxm_sys`** (GitHub Team gratuito para ONGs) e revisão obrigatória antes de deploy.
6. Remover as variáveis `VERCEL_*`/`TURBO_*` do APRXM.

## 7. Recomendação técnica (antes da decisão)
**Opção B (duas VMs)**, feita junto com a migração para o Oracle Linux gratuito: custa ~US$ 5/mês a mais que a opção A, e é a única que tira o deploy do APRXM (código de um repositório com colaborador externo, executado com acesso de root via Docker) de dentro do servidor que guarda os dados das crianças do ITP. As correções da seção 6 entram nas duas VMs. O monitoramento e o catálogo de erros continuam centralizados na VM do ITP, acessando a do APRXM pela rede interna.

## 8. Decisão (2026-10-17)

**Uma VM só, com 16 GB de RAM** — requisito mínimo definido pela direção; duas VMs de 16 GB não cabem no crédito.

| Opção de 16 GB (Linux, eastus2) | CPU | VM/mês | Total/mês* |
|---|---|---|---|
| `E2as_v5` | 2 vCPU dedicadas | US$ 82,49 | ~US$ 102 |
| `E2bs_v5` (atual) | 2 vCPU dedicadas | US$ 108,77 | ~US$ 128 |
| **`B4as_v2` — escolhida** | **4 vCPU sob demanda** | **US$ 109,50** | **~US$ 129** |
| `D4as_v5` | 4 vCPU dedicadas | US$ 125,56 | ~US$ 145 |

\* com Standard SSD 128 GB, IP, snapshots e DNS (~US$ 19). Teto do crédito: ~US$ 183/mês.

- `B4as_v2`: mesmo custo da VM atual com o dobro de núcleos; o uso médio medido (8% de 2 núcleos) acumula crédito de CPU para os picos (builds, relatórios, ETL). Se o uso sustentado subir, trocar para `D4as_v5` (redimensionamento, ~5 min fora do ar).
- Com a VM compartilhada, as correções da seção 6 passam a ser **obrigatórias** e entram antes da virada.
- Runner do APRXM: as imagens passam a ser construídas no GitHub (runners hospedados) e a VM só baixa e executa; a `main` do `aprxm_sys` ganha proteção com revisão obrigatória.
