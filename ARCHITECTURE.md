# Arquitetura — ERP ITP

> Detalhe técnico completo: infraestrutura, módulos, dependências, dívidas
> conhecidas. Para regras de trabalho/comandos, ver `CLAUDE.md`.
> Última atualização: 2026-10-16.

---

## 1. Stack

- **Backend**: NestJS + TypeORM, PostgreSQL 17. Node 24.
- **Frontend**: Next.js 15 (App Router), proxy `/backend-api/*` → backend (`next.config.mjs`), elimina CORS.
- **Auth**: JWT em cookie httpOnly (`itp_token`) — login por email/matrícula+senha, **e** SSO Microsoft (Entra ID), em paralelo.
- **Storage de arquivos**: Azure Blob Storage (`stitperpprod`, container `arquivos`) — migrado do Supabase Storage em 2026-09-09. Interface em `apps/backend/src/modules/supabase/supabase.service.ts` (nome mantido por compatibilidade, ver nota no arquivo).
- **Email**: Microsoft Graph API (`POST /users/{mailbox}/sendMail`), caixa `projetos@institutotiapretinha.org` — migrado do Gmail SMTP em 2026-09-09. Não usa SMTP: o tenant tem "Security Defaults" ativo (bloqueia autenticação legada/SMTP AUTH tenant-wide) e não há licença Entra ID P1 pra Conditional Access de exceção — Graph API com OAuth2 app-only contorna isso sem enfraquecer a segurança do tenant. `GraphMailTransport` em `apps/backend/src/email.service.ts` implementa a interface de transport do nodemailer, reaproveitando o App Registration do SSO (`MS_CLIENT_ID`/`MS_CLIENT_SECRET`/`MS_TENANT_ID`), permissão `Mail.Send` (Application). **Pendência de hardening**: `Mail.Send` (Application) por padrão permite enviar como qualquer mailbox do tenant, não só `projetos@` — restringir via Application Access Policy do Exchange Online exige Exchange Online PowerShell, que está bloqueado nesta VM/sessão por Conditional Access (dispositivo não gerenciado/compliant).

---

## 2. Infraestrutura (produção)

Tudo roda numa única VM Azure (`vm-itp-prod`, Oracle Linux 9, `20.114.240.177`, usuário SSH `itpadmin`), via Docker Compose. Decisão consciente de correlacionar falhas em troca de visibilidade/controle direto (ver histórico da migração em `docs/superpowers/` do repo `aprxm_sass`, arquivo `2026-09-06-migracao-vm-plan.md` — é o registro completo e cronológico de toda a migração Vercel→VM, SSO, storage, backups).

```
Internet → Traefik (SSL Let's Encrypt, roteamento por domínio)
             ├─ itp.institutotiapretinha.org       → erp_itp_frontend (Next.js, :3000)
             └─ api.itp.institutotiapretinha.org   → erp_itp_backend  (NestJS, :3001)
Postgres (itp_postgres, :5432) — só rede interna Docker
Acesso ao banco: DBeaver via túnel SSH (`ssh -L 5432:127.0.0.1:5432 vm-itp-prod`)
Grafana (:3030) + Prometheus (:9091) — só localhost da VM, ver seção 9
```

**Monitoramento (Grafana + Prometheus, criado 2026-09-11)**: `node-exporter`
(CPU/RAM/disco/rede da VM), `cAdvisor` (métricas por container),
`postgres-exporter` (Postgres), `blackbox-exporter` (uptime/SSL dos 3
domínios públicos via HTTP probe). Todos restritos a `127.0.0.1`, mesmo
padrão de segurança do Postgres. Dashboards prontos da comunidade
(Node Exporter Full, cAdvisor, PostgreSQL) provisionados automaticamente
via arquivo (`infra/monitoring/grafana/`). Heartbeat externo via
healthchecks.io (cron `*/5min` fazendo ping) — cobre o caso da própria VM
cair por inteiro, quando o Grafana/Prometheus (rodando na mesma VM) não
teriam como avisar ninguém. Ver seção 9 pro detalhamento completo e
pendências (instrumentação de métricas de aplicação/API, RUM de
frontend).

**Memória e swap**: VM com 15 GiB de RAM (eram 7,3 GiB até a ampliação).
Swap de 1GB via `/swapfile` (`/etc/fstab`), criado 2026-09-11 — a VM não
tinha swap nenhum antes; sem swap um pico de memória anônima aciona o OOM
killer sem margem. `vm.swappiness=10` (`/etc/sysctl.d/99-swappiness.conf`,
2026-10-16): o kernel só recorre ao swap sob pressão real. Swap "usado" com
`si`/`so` zerados no `vmstat` são páginas frias de um pico antigo, não
problema (alerta do Grafana: swap > 50% por 15 min).
Outros achados de infra da mesma auditoria (VM Oracle Linux 9,
`vm-itp-prod`), já corrigidos 2026-09-11: `/tmp` isolado via tmpfs
(`nosuid,nodev,noexec`, backed por RAM/swap — antes era só um diretório
dentro de `/`); `installonly_limit` duplicado em `/etc/yum.conf`/`/etc/dnf/dnf.conf`
(mesmo arquivo via symlink, =3 e =2) limpo pra valor único. Ainda em
aberto: VG `rootvg` 100% alocado (`VFree=0`) — não dá pra separar
`/var/log` do root sem expandir disco primeiro (não urgente, `/` tem ~75G
livres dentro do já alocado em 2026-10-16).

**Backup em 2 camadas** (cron na própria VM, sem depender de serviço externo pago):
| Camada | O quê | Frequência | Onde |
|---|---|---|---|
| Dados | `pg_dump` do Postgres → restaura no Neon (banco original, agora só alvo de backup) | 6h | `~/pg-sync-to-neon.sh` |
| Máquina | Snapshot incremental do disco Azure | Diário (3h) | `~/vm-snapshot.sh`, via managed identity da VM |

**Deploy**: automático — cron a cada 15 min roda `infra/deploy/deploy-erp-itp.sh`, que só age quando a `main` muda (backup do banco, build, health check e rollback automático). Detalhes em `infra/VM-ACESSO-E-CONFIG.md` §8. `~/erp_itp/deploy.sh` é o script manual antigo (builda **toda** a stack, sem backup nem rollback) — preferir rodar o `deploy-erp-itp.sh` quando precisar forçar.

**Removidos**: Metabase (`itp_metabase`, `metabase.itp.institutotiapretinha.org`) desligado em 2026-10-16 — sem uso; container, volume, imagem, rota do Traefik e registro DNS apagados. pgAdmin (`itp_pgadmin`) removido em 2026-10-16 — substituído pelo DBeaver via túnel SSH.

---

## 3. Autenticação

Dois métodos coexistindo, sem um substituir o outro:

1. **Senha** (`POST /auth/login`): email ou matrícula + senha, bcrypt. Conta com `role: 'admin'` só entra por matrícula (nunca email).
2. **SSO Microsoft** (`GET /auth/microsoft` → `GET /auth/microsoft/callback`): OAuth2 Authorization Code manual (sem lib pesada de OIDC — `fetch` nativo + `jsonwebtoken`/`jwks-rsa` só pra validar assinatura do id_token). Casa por e-mail com `usuarios.email`. **Não cria conta automaticamente** — sem conta prévia, gera notificação de "solicitação de acesso" (visível pra role DRT+) com sugestão de cargo baseada no grupo de maior hierarquia da pessoa no Entra ID (Graph API, client-credentials).

Ambos emitem o mesmo cookie `itp_token`. Detalhe não-óbvio: o `redirect_uri` do SSO aponta pro **frontend** (`itp.institutotiapretinha.org/backend-api/auth/microsoft/callback`), não direto pro backend (`api.itp.*`) — necessário pra o `Set-Cookie` sair do domínio certo (ver `auth.controller.ts`, comentário no topo). Cookie do SSO usa `SameSite=Lax` (não `Strict` como o login normal) pelo mesmo motivo de fluxo de redirect cross-site.

Guards globais (`APP_GUARD`): `JwtAuthGuard` + `RolesGuard` em toda a app; rotas liberadas via `@Public()`. Autorização granular por módulo: `ModuloPermGuard` + `@ModuloPerm(modulo, acao)`, consultando `grupo_permissoes` (JSON) do grupo do usuário, com fallback por `ROLE_LEVEL` (`user:0 → cozinha:1 → assist:2 → monitor:3 → prof:4 → adjunto:5 → drt:8 → vp:9 → prt:10 → admin:10`) quando o grupo não tem permissão explícita pro módulo.

---

## 4. Migrations

**Não usa** o mecanismo padrão `typeorm migration:run` — confirmado quebrado em 2026-09-11 (sem `data-source.ts` de CLI configurado, comandos removidos do `CLAUDE.md`; arquivo órfão em `apps/backend/src/migrations/` removido). O mecanismo real é `runMigrations()` em `apps/backend/src/app.module.ts`:

- Gated por tabela `_schema_version` (coluna `version`), constante `SCHEMA_VERSION` no topo da função.
- Idempotente (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — **todo bloco reexecuta caso a versão local seja menor que `SCHEMA_VERSION`**, então todo bloco precisa ser replay-safe.
- Roda em `onModuleInit` via `setImmediate` (fire-and-forget, não trava o cold start).
- Versão atual: **v26** (2026-09-11) — v21 adicionou FK do financeiro, v22 adicionou soft delete, v23 adicionou colunas de alergia/medicamento, v24 índices de FK + CHECK/enum, v25 `updated_at`/`created_at` faltando, v26 unificou nomenclatura camelCase→snake_case em 5 tabelas (P2 da auditoria de banco).

**Dívida registrada 2026-09-11**: os 27 índices de FK e os 4 `CHECK` constraints criados na auditoria de banco (seção 7) foram aplicados **direto via `psql`**, fora do `runMigrations()`. Funciona no banco atual, mas **não seria recriado automaticamente** num banco novo/restaurado do zero (ex: ambiente de homologação futuro, ou um restore de disaster recovery) — precisa ser promovido pra dentro de um bloco versionado de `runMigrations()` numa próxima limpeza, ou documentado como setup manual obrigatório pós-restore.

---

## 5. Módulos do backend (`apps/backend/src/`)

| Módulo | Responsabilidade | Entidades principais |
|---|---|---|
| `auth` | Login (senha + SSO), reset/troca de senha | `Usuario` |
| `usuarios` | Perfil do usuário logado (sem `.module.ts` próprio — controller usa `AuthService`) | `Usuario` |
| `academico` | Cursos, turmas, grade, diário, presença/chamada, chamados internos, futebol/ballet | `Curso`, `Professor`, `Turma`, `DiarioAcademico`, `ChamadoAcademico`, etc. |
| `alunos` | Complemento cadastral, documentos do aluno | `Aluno`, `AlunoComplemento`, `DocumentoValidacao` |
| `matriculas` | Inscrição pública → matrícula, LGPD, documentos por token | `Inscricao`, `DocumentoInscricao` |
| `cadastro` | Insumos, doadores, contas bancárias | `Insumo`, `Doador`, `ContaBancaria` |
| `captacao` | Pipeline de captação de recursos com IA (Gemini) | `CaptacaoOpportunity` |
| `estoque` | Estoque + endpoint público pra coletor de código de barras | `Produto`, `MovimentoEstoque` |
| `financeiro` | Movimentações, boletos/parcelas, lookups (categoria/plano/tipo/forma) | `MovimentacaoFinanceira`, `Boleto`, `BoletoParcela` |
| `funcionarios` | Cadastro, webhook do Google Forms | `Funcionario` (fica em `academico/entities/`) |
| `gente` | RH: folha, recibos, vales, advertências, faltas, folgas (geofencing) | `GenteColaborador` + ~12 entidades `Gente*` |
| `grupos` | RBAC (`grupo_permissoes` JSON) | `Grupo` |
| `modules/users` | Admin de usuários + config-listas | `Usuario` |
| `modules/supabase` | Storage de arquivos (hoje Azure Blob) — `@Global()` | — |
| `notificacoes` | Notificações internas, `cargo_minimo` (visibilidade por nível) | `Notificacao` |
| `pesquisas` | NPS/satisfação, link público | `Pesquisa`, `PesquisaResposta` |
| `projetos` | Projetos sociais, equipes, inscrições, presença | `Projeto`, `ProjetoEquipe`, `ProjetoInscricao` |
| `publico` | Transparência (`GET /publico/prestacao-contas`) | — |
| `relatorios` | Dashboards agregados (DRE, fluxo de caixa, etc.) — sem entidade própria | — |
| `responsaveis` | Responsáveis legais de aluno | `Responsavel` |

**Dependências entre módulos**: `notificacoes` é folha, consumido por quase todos. `modules/supabase` é `@Global`, injetado implicitamente em `academico`, `alunos`, `auth`, `funcionarios`, `gente`, `matriculas`, `projetos`. `gente` referencia `MovimentacaoFinanceira` direto (acoplamento de entidade, sem importar `FinanceiroModule`). `relatorios` provavelmente lê entidades de outros módulos via `TypeOrmModule.forFeature` direto, sem depender dos modules.

---

## 6. Frontend (`apps/frontend/src/app/`)

Mapeamento rota → módulo backend:

| Rota | Módulo |
|---|---|
| `/login`, `/esqueci-senha`, `/reset-senha/[token]`, `/trocar-senha` | `auth` |
| `/academico` (+ Alunos/Presença/Diário/Monitoramento) | `academico` |
| `/matriculas`, `/inscricao`, `/lgpd/[token]`, `/documentos/[token]` | `matriculas` |
| `/gente` | `gente` |
| `/financeiro`, `/doacoes` | `financeiro` |
| `/cadastro` | `cadastro` |
| `/estoque`, `/estoque/coletor` | `estoque` |
| `/captacao*` | `captacao` |
| `/projetos*` | `projetos` |
| `/pesquisa/[link]`, `/pesquisas` | `pesquisas` |
| `/notificacoes` | `notificacoes` |
| `/relatorios` | `relatorios` |
| `/config` | `grupos` + `modules/users` |

---

## 7. Dívidas conhecidas / achados (não corrigidos ainda)

Auditoria de banco completa em `docs/database-audit-2026-09-08.md` (repo `aprxm_sass`) — P0 (FK financeiro, soft delete) já implementados em 2026-09-09; P1 (índices em FK, CHECK/enum) e P2 (nomenclatura) ainda pendentes.

**Achados de código (levantamento 2026-09-09, não corrigidos)**:

1. **Rotas de chamada duplicadas no frontend — investigado 2026-09-11, não é bug de segurança.** `/chamada` (raiz, widget geral acessado via QR pelo `LaunchPad.tsx`) e `/academico/chamada` (deep-link pré-preenchido com turma/data/tema, gerado pelo `PresencaTab.tsx`) são duas implementações **completas e ativas** do mesmo recurso — professor logado registrando presença, não aluno (confirmado: aluno nunca faz a própria chamada). Ambas corretamente exigem login (`middleware.ts`), sem falha de auth — cheguei a suspeitar de um bug real (link perdendo query params no redirect pro login), mas o fluxo é mesmo restrito a funcionário. `/academico/chamada-professor` **removido (2026-09-11)** — confirmado órfão de verdade: rascunho anterior (331 linhas) sem nenhuma referência em código, superado pela versão da raiz (700 linhas, com abas extras de fichas/inclusão de aluno que o rascunho não tinha). **Decisão tomada (2026-09-11): manter os dois fluxos paralelos `/chamada` e `/academico/chamada`** — não são duplicatas de verdade. Batem em endpoints de backend diferentes (`POST /academico/presenca/sessoes` vs `POST /academico/chamada` + `POST /academico/chamada/aluno-rapido`), e a segunda tem uma funcionalidade que a primeira não tem (cadastro rápido de aluno novo na hora). Juntar exigiria replicar essa funcionalidade no fluxo do `LaunchPad` primeiro — é trabalho de feature, não limpeza de duplicata.
2. **✅ Resolvido (2026-09-11)** — `apps/frontend/src/app/relatorios/page.jsx` (arquivo órfão, 35 linhas, dados mockados, sem nenhuma referência externa) removido; `relatorios/page.tsx` (2183 linhas) é a única implementação real da rota.
3. **✅ Resolvido (2026-09-11)** — `FuncionariosController` estava mesmo registrado 2x (`FuncionariosModule.controllers` **e** `require()` direto em `AppModule.controllers`). Removida a linha redundante do `AppModule`; o módulo já registra normalmente.
4. **✅ Resolvido (2026-09-11)** — `matriculas/database.ts` estava vazio (sem nenhum import em todo o backend), não era acesso cru ao banco. Removido; build validado.
5. **✅ Resolvido (2026-09-11)** — `auth` e `usuarios` agora têm `.module.ts` próprio (`AuthModule` exporta `AuthService`; `UsuariosModule` importa `AuthModule`). Baixo acoplamento confirmado antes de mexer: nada fora de `auth`/`usuarios`/`AppModule` usava `AuthService` diretamente. `JwtStrategy` foi junto pro `AuthModule`; `JwtAuthGuard`/`RolesGuard` continuam como `APP_GUARD` no `AppModule` (guard global, não é código de negócio de um módulo específico). Validado em produção 2026-09-11: boot limpo, rotas `/api/auth/*` e `/api/usuarios/*` mapeadas sem duplicação, login testado (401 esperado pra credencial errada, sem erro 500).
6. **✅ Resolvido (2026-09-09)** — Soft delete agora cobre também as queries SQL cru: `@DeleteDateColumn` já cobria `find()`/`findOne()` do TypeORM automaticamente, e as 31 queries manuais (`this.db.query()`/`dataSource.query()`) em `relatorios.service.ts` (25), `publico.service.ts` (5, inclui a página **pública** de prestação de contas) e `academico.service.ts` (1) contra `movimentacoes_financeiras` agora têm `deleted_at IS NULL` explícito. Ver commit `fix(soft-delete): adiciona deleted_at IS NULL...`.
7. **`alunos` não usa soft delete** — decisão deliberada: o endpoint de exclusão (`academico.service.ts`) já é hard-delete intencional (LGPD, "direito ao esquecimento"), gated por "só exclui aluno já inativo" via flag `ativo`. Adicionar `deleted_at` ali romperia esse fluxo.
8. **✅ Resolvido (2026-09-11)** — confirmado: `npm run typeorm:migration:*` não funcionam (sem `data-source.ts` de CLI configurado, o TypeORM CLI não acha conexão). `CLAUDE.md` corrigido pra não documentar comandos quebrados; único mecanismo real é `runMigrations()` (seção 4). O arquivo órfão `src/migrations/1740000000000-AddEmailResponsavelFields.ts` (nunca executado por esse mecanismo) foi removido; build validado.

---

## 9. Monitoramento (Grafana + Prometheus, 2026-09-11)

Pedido explícito do usuário: "painel completo de monitoramento das
aplicações no ITP_TEC, como um Grafana". Decisão registrada: Grafana OSS
real (não um painel customizado dentro do ITP_TEC) — ferramenta padrão
de mercado pra stack containerizada, sem custo de licença, evita
reinventar gráficos/histórico/alertas do zero.

**Componentes** (todos em `infra/docker-compose.yml`, configs em
`infra/monitoring/`):

| Componente | Porta (só localhost) | Coleta |
|---|---|---|
| `node-exporter` | 9100 | CPU/RAM/disco/rede da VM (SO) |
| `cAdvisor` | 8082 | CPU/memória por container Docker |
| `postgres-exporter` | 9187 | Conexões, queries, tamanho do banco |
| `blackbox-exporter` | 9115 | Uptime/SSL/HTTP dos 3 domínios públicos (probe ativo de fora pra dentro) |
| `Prometheus` | 9091 (9090 já ocupada por outro serviço do SO) | Agrega tudo acima, retenção 30 dias |
| `Grafana` | 3030 | Visualização — 3 dashboards prontos da comunidade (Node Exporter Full, cAdvisor, PostgreSQL), provisionados automaticamente via arquivo |

**Heartbeat externo**: cron `*/5min` na VM faz ping em
healthchecks.io. Resolve o problema do "vigia que precisa de outro
vigia" — se o Grafana/Prometheus rodam na mesma VM que monitoram, uma
queda total da VM não gera alerta nenhum (o próprio painel caiu junto).
O heartbeat externo é o único sinal que sobrevive a esse cenário.

**Credenciais**: `GRAFANA_ADMIN_PASSWORD` no `.env` da VM (não versionado,
mesmo padrão de `POSTGRES_PASSWORD`).

**Acesso público + SSO (2026-09-11)**: exposto em
`https://grafana.itp.institutotiapretinha.org` via Traefik/Let's
Encrypt. Login via Microsoft (SSO) configurado reaproveitando o mesmo
app registration do `erp_itp` (`MS_CLIENT_ID`/`MS_CLIENT_SECRET`/
`MS_TENANT_ID` copiados de `erp_itp_backend.env` pro `.env` do
`itp-stack`, pra ficarem disponíveis na interpolação do
`docker-compose.yml`) — Redirect URI `/login/azuread` cadastrado como
segunda plataforma Web no mesmo app. Login por senha (`admin`) continua
disponível em paralelo, não foi removido.

**Fora do escopo desta rodada** (exige mais trabalho, registrado como
pendência):
- Métricas de aplicação/API (taxa de erro HTTP, latência p50/p95/p99,
  Apdex) — exige instrumentar o NestJS (`prom-client`, endpoint
  `/metrics`), não é só subir container.
- RUM (Real User Monitoring) client-side — Web Vitals, cliques, funil de
  conversão. O site institucional já tem Application Insights pra isso;
  o `erp_itp` ainda não tem equivalente (só captura erro, não
  performance/comportamento).
- Métricas de negócio (matrículas/dia, chamados abertos, movimentações
  financeiras) — technical health ≠ business health, mas exige definir
  queries específicas e validar com o usuário.
- Alertas do Grafana configurados pra reusar o mesmo canal de
  email/Teams do catálogo de erros (Power Automate/Graph API) — Grafana
  não usa SMTP nativo aqui (tenant bloqueia SMTP AUTH legado), precisa de
  uma ponte via webhook.

---

## 10. Referências

- Histórico completo da migração de infra (VM, SSO, storage, backups, incidentes e fixes): repo `aprxm_sass`, `docs/superpowers/plans/2026-09-06-migracao-vm-plan.md`.
- Auditoria de banco de dados: repo `aprxm_sass`, `docs/database-audit-2026-09-08.md`.
