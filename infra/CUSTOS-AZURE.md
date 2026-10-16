# Custos do Azure e crédito de ONG

Situação em 2026-10-16 e plano para reduzir o gasto. Sem IDs de assinatura, chaves ou dados de cartão: esses ficam no portal.

## 1. Onde está o dinheiro

| Item | Situação |
|---|---|
| Assinatura | "Azure subscription 1" (Pay-As-You-Go) — tudo de produção roda nela |
| Conta de cobrança | Microsoft Customer Agreement, tipo **Individual** (em nome de pessoa física, não do Instituto) |
| Perfis de cobrança | **"Erick Gonçalves Cardoso"**: onde a assinatura está ligada. **"Erick G Cardoso"**: onde está o crédito de ONG, sem assinatura |
| Crédito | **Azure non-profit sponsorship credit — US$ 1.840**, ativo de **27/07/2026 a 27/07/2027** |
| Teste grátis | US$ 200 de 27/07 a 26/08/2026 — encerrado |

- A assinatura **não pode** ser movida entre perfis de cobrança (o Azure recusa: `CrossBillingAccountNotAllowed`). A aplicação do crédito à assinatura foi acertada **pelo suporte de cobrança da Microsoft** (fatura de setembro de R$ 799,65 anulada e reemitida em R$ 0). Confirmar com o suporte, a cada fatura, que o crédito continua sendo aplicado.
- **O crédito não cobre produtos de terceiros do Marketplace.** A licença do Oracle Linux da VM é desse tipo e sai do cartão.

## 2. Quanto custa

| Item | Set/2026 | Out/2026 (projeção) | Coberto pelo crédito? |
|---|---|---|---|
| VM `Standard_E2bs_v5` (2 vCPU, 16 GB) — em set. parte do mês em `D2s_v5` | R$ 398 | ~R$ 563 | sim |
| **Licença Oracle Linux 9.3** (imagem da "nuvemnest llc", Marketplace) | R$ 213 | **~R$ 281** | **não — pago no cartão** |
| Disco do SO Premium SSD 128 GB | R$ 59 | ~R$ 92 | sim |
| Snapshots diários do disco (incrementais) | R$ 15 | ~R$ 24 | sim |
| IP público | R$ 14 | ~R$ 19 | sim |
| DNS, Blob Storage | R$ 5 | ~R$ 4 | sim |
| **Total** | **R$ 703** | **~R$ 983** | |

Outubro subiu ~40% sobre setembro porque a VM foi ampliada de 8 GB para 16 GB de RAM em setembro (primeiro mês inteiro no tamanho novo). Uso real hoje: ~6 GB de RAM.

Ver valores atuais: portal → Gerenciamento de Custos + Cobrança → Análise de custos, ou:

```bash
az rest --method post \
  --url "https://management.azure.com/subscriptions/<id>/providers/Microsoft.CostManagement/query?api-version=2023-03-01" \
  --body '{"type":"ActualCost","timeframe":"MonthToDate","dataset":{"granularity":"None","aggregation":{"c":{"name":"Cost","function":"Sum"}},"grouping":[{"type":"Dimension","name":"MeterSubCategory"}]}}'
```

## 3. O crédito dura até o vencimento?

Só o que o crédito cobre (sem a licença do Oracle Linux), câmbio de out/2026 (R$ 5,22/US$):

| Cenário | Por mês | 11 meses (set/2026 → jul/2027) | Sobra de US$ 1.840 |
|---|---|---|---|
| Atual | ~R$ 700 ≈ US$ 135 | ~US$ 1.480 | ~US$ 360 |
| Com disco Standard SSD | ~R$ 655 ≈ US$ 126 | ~US$ 1.390 | ~US$ 450 |

- **Dura com folga.** Só acaba antes de 27/07/2027 se o gasto coberto passar de **~US$ 165/mês** (ex.: uma segunda VM).
- Crédito **anual e não acumula**: o saldo que sobrar em 27/07/2027 é perdido.

## 4. Renovação

- Renovar pelo **nonprofit.microsoft.com** com a conta de administrador do Instituto. A Microsoft normalmente pede nova confirmação de elegibilidade.
- **Fazer em junho de 2027** (lembrete em **01/06/2027**), um mês antes do vencimento, para não ficar sem cobertura se a verificação demorar.

## 5. Plano de redução de custos

Executar em ordem, cada etapa com data marcada e janela combinada.

### Etapa 1 — Alerta de orçamento (sem impacto)
- Orçamento mensal na assinatura com alerta por e-mail em **US$ 150** (sinal de que o crédito não chega a julho/2027) e em 100% de um valor-teto.
- Risco: nenhum. Custo: nenhum.

### Etapa 2 — Disco Premium SSD → Standard SSD (economia ~R$ 45/mês)
- Uso de disco é baixo; Standard SSD atende.
- **Para tudo por ~5–10 min** (ERP, API, APRXM, Grafana; o site institucional não para). Fazer à noite, avisando os usuários.
- Passos: snapshot manual do disco → desligar (deallocate) a VM → trocar o SKU do disco para `StandardSSD_LRS` → ligar → conferir serviços.
- Volta: trocar o SKU de volta para `Premium_LRS` (mesmo procedimento) ou restaurar do snapshot.

### Etapa 3 — VM nova com Oracle Linux oficial gratuito (economia ~R$ 280/mês, ~R$ 3.300/ano)
- A licença paga está presa ao disco da imagem da "nuvemnest": **não dá para trocar na VM atual**; é preciso criar outra VM com a imagem oficial da Oracle (sem custo de licença) e migrar.
- Aproveitar para decidir o tamanho da VM com base em 1–2 semanas de métricas do Grafana.
- Pré-requisito: acesso SSH à VM liberado para quem executar a migração (ou execução assistida, comando a comando).

| Fase | O quê | Fora do ar? |
|---|---|---|
| Preparação | Inventário da VM atual: `~/itp-stack` (compose, `.env`, configs), `~/erp_itp`, `~/aprxm_sys`, crons do `itpadmin`, Tailscale, xrdp/X2Go, scripts de backup e snapshot, regras de firewall/SELinux. Atualizar `infra/VM-ACESSO-E-CONFIG.md` com o que faltar | não |
| Montagem | VM nova (Oracle Linux 9 oficial) na mesma rede; instalar Docker, Tailscale, xrdp; clonar repos; copiar configs; subir a stack com cópia dos bancos | não |
| Teste | Validar ERP, API, APRXM, Grafana, catálogo de erros e crons na VM nova, acessando por IP/hosts locais | não |
| Virada | Parar a stack antiga, dump/restore final do Postgres e ClickHouse, apontar DNS (ou mover o IP público) para a VM nova, renovar certificados | **sim, ~15–30 min, à noite** |
| Retorno | Manter a VM antiga **desligada** (não apagada) por 7 dias como plano de volta | não |
| Limpeza | Apagar VM, disco e snapshots antigos | não |

### Fora do plano (avaliado e descartado por ora)
- **Reduzir a VM para 8 GB** (~R$ 150/mês): ficaria apertado com ClickHouse e builds do deploy. Reavaliar com as métricas na etapa 3.
- **Reserva de 1–3 anos da VM**: não faz sentido enquanto o crédito cobre a VM.

## 6. Pendências de governança
- A conta de cobrança é **Individual**, em nome de pessoa física. Para a contabilidade da ONG e para não depender de uma pessoa, o ideal é a cobrança ficar no nome do Instituto. Tratar com o suporte da Microsoft ou na próxima renovação do crédito.
