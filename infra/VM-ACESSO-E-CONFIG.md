# VM de produção (vm-itp-prod) — acesso e configurações fora do compose

Configurações feitas diretamente na VM que não vivem em nenhum `docker-compose.yml` versionado. Registro de 2026-09-29. Sem IPs, senhas ou chaves: esses ficam no cofre/`.env` da VM.

## 1. Acesso

| Via | Como | Observação |
|---|---|---|
| **SSH** | `ssh vm-itp-prod` pelo **Tailscale** (rede da conta `erick.cardoso@insttiapretinha.onmicrosoft.com`), com chave (`~/.ssh/vm-itp-prod` no Mac) | Independe do IP público. `PasswordAuthentication no` no sshd: só chave. |
| **Tailscale SSH** | **Desligado** (`tailscale set --ssh=false`) | Com ele ligado, a política em modo "check" pedia login no navegador a cada 12 h. Agora o Tailscale só transporta; o SSH normal autentica pela chave. |
| **RDP (gráfico)** | Windows App (Mac) → `vm-itp-prod` → sessão `Xorg`, usuário `itpadmin` | Porta 3389 aberta **só para a faixa do Tailscale** (seção 2). A senha do `itpadmin` vale só para o RDP. |
| **X2Go** | Continua instalado (usado pelo Windows) | Não abrir X2Go e RDP ao mesmo tempo com o mesmo usuário (duas sessões MATE disputam o barramento D-Bus). |
| **NSG do Azure** | Regras SSH por IP ainda existem | Podem ser removidas: o acesso é pelo Tailscale (ver pendências). |

## 2. RDP (xrdp) — Oracle Linux 9

Pacotes (EPEL `ol9_developer_EPEL`): `xrdp`, `xorgxrdp`, **`xrdp-selinux`**.

1. **Sessão:** `~itpadmin/.Xclients` com `exec mate-session` (mesmo desktop do X2Go).
2. **Firewall** (firewalld, zona `public`):
   ```bash
   firewall-cmd --permanent --zone=public --add-rich-rule='rule family=ipv4 source address=100.64.0.0/10 port port=3389 protocol=tcp accept'
   ```
   Do IP público a porta fica fechada (testado).
3. **SELinux (Enforcing):** sem `xrdp-selinux`, o `xrdp-sesman` não conseguia executar `xauth`/`waitforx` ("X server could not be started", errno 13), e o bloqueio não aparecia no audit (regra *dontaudit*). Instalar o pacote resolve.
4. **Codec — tela preta:** o `xrdp` do EPEL é compilado **sem x264**. Com o padrão `order = [ "H.264", "RFX" ]` o cliente do Mac negociava H.264 e nenhum quadro era enviado (`xrdp_mm_egfx_frame_ack: encoder is nil` no `/var/log/xrdp.log`). Em [`xrdp/gfx.toml`](xrdp/gfx.toml): `order = [ "RFX" ]`.
5. **Senha do `itpadmin`:** definida com `sudo passwd itpadmin` (antes era travada; o SSH continua só por chave).

**Sessão presa / "Could not acquire name on session bus":** há duas sessões do mesmo usuário. Listar com `ps -u itpadmin -o pid,args | grep -E "Xorg :|mate-session"` e encerrar a sobrando. Sair sempre por **Sistema → Sair**; fechar a janela deixa a sessão suspensa.

## 3. ClickHouse — logs internos reduzidos (PRB-0028)

Arquivo [`clickhouse/logs-reduzidos.xml`](clickhouse/logs-reduzidos.xml), montado no `~/itp-stack/docker-compose.yml`:

```yaml
- ./clickhouse-config/logs-reduzidos.xml:/etc/clickhouse-server/config.d/logs-reduzidos.xml:ro
```

- Desliga `text_log`, `metric_log`, `asynchronous_metric_log`, `trace_log`, `processors_profile_log`, `query_metric_log`, `part_log`; `query_log` com TTL de 7 dias; logger em `warning`.
- Motivo: os logs somavam 3,6 GB em 15 dias (`text_log` 3,2 GB) e as fusões deles levavam o processo a 1,36 GiB de 1,5 GiB (`mem_limit`), derrubando a sync do catálogo (erro 241). Dados reais < 150 KB.
- Depois de aplicar: `TRUNCATE TABLE system.<tabela>` em cada log desligado (3,6 GB → 11,5 MB); memória do processo ~550 MB.
- Backup do compose anterior: `docker-compose.yml.bak-antes-logs-clickhouse-*`.

## 4. Monitoramento

- Regras do Grafana: `infra/monitoring/grafana/provisioning/alerting/rules.yaml` (a pasta `~/itp-stack/monitoring/grafana/provisioning/alerting` é symlink para cá). **Editar aqui e commitar**, nunca direto na VM.
- Memória: alerta de `available` < 10% (crítico) e de swap > 50% por 15 min (aviso). `buff/cache` alto é cache de disco e não indica problema.

## 5. E-mail do APRXM

`~/itp-stack/aprxm_backend.env`: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (app com `Mail.Send`) e `MAIL_SENDER=nao-responda@institutotiapretinha.org` (caixa compartilhada, sem licença e sem membros). Backup do env anterior: `aprxm_backend.env.bak-email-*`.

## 6. Kernel / memória

`vm.swappiness=10` em `/etc/sysctl.d/99-swappiness.conf` (2026-10-16; padrão era 60). Aplicar sem reboot: `sudo sysctl -p /etc/sysctl.d/99-swappiness.conf`.

## 7. Deploy do erp_itp

O erp_itp não tem deploy por CI: as imagens são construídas na VM a partir de `~/erp_itp` (compose em `~/itp-stack`). Até 28/09/2026 isso era manual e a produção ficou 17 dias sem deploy.

`infra/deploy/deploy-erp-itp.sh` automatiza pelo cron (a cada 15 min, só age quando a `main` muda):

1. `git merge --ff-only origin/main` em `~/erp_itp`;
2. backup `pg_dump erp_itp_db` em `~/backups/erp_itp_db-pre-deploy-*.sql.gz` (mantém os 10 últimos; backup vazio aborta);
3. tag `:rollback` nas imagens atuais;
4. `docker compose build` + `up -d` de `erp_itp_backend` e `erp_itp_frontend`;
5. health check (até 3 min): log `Nest application successfully started`, `/login` 200 e `/api/auth/login` 400/401 pelo Traefik local;
6. falhou → volta as imagens `:rollback`, `git reset` para o commit anterior e marca o commit em `~/itp-stack/.deploy-erp-itp-falhou` (não retenta até chegar commit novo). E-mail em todo deploy, feito ou revertido.

Cron (`crontab -e` do `itpadmin`):

```
*/15 * * * * bash /home/itpadmin/erp_itp/infra/deploy/deploy-erp-itp.sh >> /home/itpadmin/itp-stack/deploy-erp-itp.log 2>&1
```

Migrations rodam no boot do backend (`runMigrations`); se o deploy for revertido depois de uma migration, o banco fica à frente do código — restaurar pelo backup se necessário. Deploy manual: rodar o mesmo script.
