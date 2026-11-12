# VIGIAELUS / VIGIAPLUS — Auditoria crítica, riscos e plano de ação

**Auditado em:** 2026-11-09 · **Fonte:** `OARANHA/vigiaplus` `main` @ `d2d9eafe7667b21a4badc14a3161501f5c72513d`. **Metodologia:** leitura estática do código, de documentação e do estado CI do commit; confronto da integração Asaas com documentação oficial. **Não realizados:** testes locais em `D:\VIGIAPLUS`, inspeção de dados reais, pentest, chamada a serviços financeiros ou deploy. Não há prova de exploração em produção.

**Veredito:** código extenso e CI aprovado no SHA, mas **NO-GO para operação comercial multi-tenant com pagamentos reais** enquanto houver bootstrap com credenciais previsíveis, RLS opt-in, dados demonstrativos no produto e divergências de cobrança. A classificação P0 é priorização de correção, não alegação de comprometimento observado.

## 1. Resumo executivo

- **Pontos fortes:** 3 superfícies preservando modo analista; 73 rotas de API, 54 tabelas Drizzle, 25 fontes registradas, piloto CRF-RS com histórico de coleta; cookie HMAC + versão de sessão; RBAC e catálogo de features; base para LLM OpenAI-compatible; testes e CI; Docker e Traefik versionados.
- **Risco sistêmico:** três sistemas coexistem — Radar legado (permissão admin/projeto), VigiaElus piloto (projeto) e VigiaPlus multi-tenant (tenant/entitlements). Alterar a UI não resolve autorização e origem de dados.
- **Risco de produto:** portal e console exibem indicadores fixos ao lado de valores do banco; o cliente pode entender como evidência produzida pelo serviço.
- **Risco financeiro:** o código que cria/recebe Pix do Asaas não cumpre o contrato oficial; reconciliação ambígua.
- **Risco de operação:** CI GREEN não é evidência de migração aplicada, coleta agendada, SLA real nem gateway pago.

## 2. Achados auditáveis

### P0-01 — Bootstrap com contas e senhas conhecidas [CRÍTICO, comprovado]

**Evidência:** `lib/db/index.ts` ~757–785 possui fallback de administrador com senha pública; `lib/db/vigia-seed.ts` ~14–118 injeta usuários de diferentes papéis com senhas literais estáticas quando o banco não possui tenants; `getDb().init()` chama `seedVigiaPlus` também fora de DEMO_MODE. Os seeds VigiaPlus usam `mustChangePassword: 0`. Não reproduzir as credenciais em documentos de auditoria.

**Impacto:** contas previsíveis podem ser criadas no primeiro boot de uma instalação real, inclusive perfil proprietário. Um aviso de troca de senha do bootstrap legado não resolve os usuários VigiaPlus.

**Correção:** remover todos os secrets/usuários padrão de produção; sem `DEMO_MODE=1`, falhar fechado se administrador seguro não provisionado; demo em base/artefato separados; forçar troca e revogar sessões/credenciais já geradas. **Aceite:** banco vazio em produção jamais cria conta com senha conhecida; regressão no CI e documentação de bootstrap.

### P0-02 — RLS permissivo e não obrigatório [CRÍTICO, comprovado]

**Evidência:** `migrations/00002_rls.sql` libera leituras quando `current_setting('app.tenant_id', true)` é NULL/vazio. `lib/tenant/scope.ts` cai para `fn()` sem RLS ao usar driver sem transação; `lib/db/index.ts` suporta Neon HTTP; scripts de migração não são invocados pelo Dockerfile nem CI. Arquivos de API ainda consultam o driver diretamente. PostgreSQL também pode ignorar RLS se conexão usar proprietário das tabelas.

**Impacto:** uma query sem filtro por tenant pode enxergar outro cliente; a afirmação de defesa em profundidade não está garantida. Não há evidência de vazamento real.

**Correção:** separar papel de migração do de aplicação; escopo obrigatório em toda requisição tenant, política default-deny, fail-closed quando falta contexto, driver que suporta a transação necessária (ou políticas efetivas sem depender de sessão opt-in), `FORCE ROW LEVEL SECURITY` quando aplicável; migrar todo acesso legado a repositórios com scoping. **Aceite:** matriz de testes cruzados A/B para todas as rotas e operações e prova no DB com papel da app.

### P0-03 — Incompatibilidade de webhook Pix/Asaas [CRÍTICO, comprovado]

**Evidência:** `app/api/webhooks/pix/route.ts` espera `x-webhook-signature`/`x-asaas-signature`/`x-hub-signature` e HMAC SHA256 sobre corpo; `lib/billing/events.ts` implementa esse HMAC genérico. A documentação oficial Asaas instrui configurar `authToken` e validar o header **`asaas-access-token`**, não HMAC do corpo. A configuração de `PIX_WEBHOOK_SECRET` hoje não corresponde ao contrato Asaas.

**Fontes oficiais:** https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook e https://docs.asaas.com/docs/faq-de-webhooks.

**Correção:** endpoint/adapter Asaas específico; comparar token do header com `authToken` seguro em tempo constante; rejeitar toda origem não autenticada; persistir o evento antes de responder; idempotência transacional e testes com payloads sandbox reais.

### P0-04 — Cobrança Pix sem cliente Asaas [CRÍTICO, comprovado]

**Evidência:** `lib/billing/gateways.ts` ~114–127 cria `POST /api/v3/payments` com `billingType`, `value`, `dueDate`, `externalReference`, `description`, mas **sem `customer`**. O parâmetro é obrigatório na API oficial: https://docs.asaas.com/reference/criar-nova-cobranca. Não foi identificado no caminho revisado provisionamento de cliente pagador.

**Correção:** cadastro/reuso de cliente Asaas; persistir `gateway_customer_id` por tenant; vincular `externalReference` à fatura única, não apenas ao tenant; testar emissão e confirmação no sandbox.

### P0-05 — Conciliação ambígua e processamento sem atomicidade [ALTO/CRÍTICO, comprovado]

**Evidência:** `lib/billing/process.ts` tenta localizar a fatura por identificador do gateway e, quando sem metadata, seleciona **a primeira fatura aberta pelo mesmo valor**; faz `SELECT` de evento antes de `INSERT` e realiza múltiplos updates sem transação. IDs de eventos não são combinados ao gateway na chave primária.

**Impacto:** associação errada de pagamento/fatura ou corrida no processamento, especialmente sob duplicação/retry. **Correção:** `UNIQUE(gateway, event_id)`, upsert idempotente transacional, conciliação exclusiva por `(gateway, gateway_charge_id)` + tenant/fatura + valor/moeda, sem fallback por valor; estado explícito de evento órfão para triagem manual. **Aceite:** replay/concorrência e duas faturas do mesmo valor em tenants diferentes nunca cruzam nem ativam assinatura incorreta.

### P0-06 — KPIs fictícios sem selo de demonstração [ALTO, comprovado]

**Evidência:** `app/api/app/summary/route.ts` ~53–68 fixa contagem de fontes, comentários, tempo de detecção; a partir disso gera nota de confiança, procedência e janela recente. `app/console/page.tsx` fixa MRR e SLA, e a navegação de 18 áreas usa botões sem ação. `lib/db/vigia-seed.ts` alimenta score demonstrativo.

**Correção:** distinguir seed de sandbox por `DEMO_MODE`, nunca mostrar exemplos como números reais; em produção consultar `collection_runs`, `mentions`, `subscriptions`, `invoices`, `llm_usage`; vazio com estado “Ainda sem dados”; `updated_at` deve refletir evento de coleta, não apenas timestamp da consulta. **Aceite:** cada métrica exibe origem, janela, coleta e metodologia; banco vazio -> UI vazia útil, nunca valor fictício.

### P0-07 — Retenção global de dados [ALTO, comprovado]

**Evidência:** `lib/pipeline.ts` ~209–224 executa `DELETE FROM mentions WHERE published_at < now() - interval '90 days' AND import_file_id IS NULL`, sem usar `tenants.retention_days`, sem export/manifesto de eliminação e sem revisão de litígio/hold.

**Correção:** job de retenção por tenant com dry-run, política legal/documental, archive/export quando contratado, log auditável, exclusões condicionadas e testes de não regressão. **Aceite:** nenhuma exclusão fora da política explícita do tenant e comprovante de descarte.

### P1-08 — SSRF nos feeds RSS [ALTO, comprovado como ausência de barreira]

**Evidência:** `lib/connectors/rss.ts` aceita URLs `https?://`; `lib/connectors/util.ts` chama `fetch(url)` sem validação de DNS/IP privados, redirects e resposta. Isso abre possibilidade de requisições internas quando o usuário consegue configurar o feed.

**Correção:** biblioteca central de saída HTTP com allowlist, checagem de IPs IPv4/IPv6 e DNS, revalidação por redirect/hop, bloqueio de metadata endpoints, tamanho máximo de corpo e content-type; teste SSRF adversarial. Não usar validação de LLM como proteção implícita do RSS.

### P1-09 — LLM Registry e execução divergentes [ALTO, comprovado]

**Evidência:** `lib/llm-bridge.ts` procura **primeiro provedor global ativo**, mesmo recebendo `opts.ctx`/`opts.purpose`; `lib/tenant/llm-registry.ts` faz `selectProvider(purpose)` sem escopo de tenant no trecho analisado, testa conectividade sem o header `Authorization` e `callProvider` não utiliza o corpo de resposta do modelo (retorna só sucesso/provedor). Validação DNS ocorre antes de `fetch`, sem fixar destino; redirecionamentos não são bloqueados explicitamente.

**Correção:** padronizar `IAssistantGateway` com tenant/purpose, provider/model, key ref, quotas e custo real; consumir e validar saída da API de chat; teste com servidor OpenAI-compatible falso, 401/429, redirect, DNS rebinding, fallback e dupla chamada concorrente. A migração do motor legado deve ser gradual e mensurada.

### P1-10 — Controle insuficiente de autenticação [ALTO, comprovado]

**Evidência:** `app/api/auth/route.ts` aplica 400ms de atraso constante no login, mas não implementa rate limit persistente por IP/conta, cooldown e monitoramento. O esquema tem `two_factor_enabled`, mas campo não prova segundo fator ativo.

**Correção:** proteção distribuída contra força bruta, auditoria de tentativas, bloqueio temporário e 2FA efetivo opcional ou exigido para owner/admin; testes multi-instância.

### P1-11 — Deploy e migração desacoplados [ALTO, comprovado]

**Evidência:** `deploy/Dockerfile` inicializa `node server.js`; `deploy/docker-compose.yml` não roda `npm run migrate` e nem `migrate:check`; `app/api/health` responde OK sem banco, fila ou serviços. `lib/db/index.ts` opera DDL aditivo no boot. `docker-compose` monta `docker.sock` read-only no Traefik (continua superfície privilegiada).

**Correção:** reconciliar DDL bootstrap e migrações versionadas; migration job bloqueante antes de deploy, backups, readiness independente de liveness, container healthcheck, secrets externos, pin de imagens por digest, política para Docker socket, teste de restore.

### P1-12 — Qualidade, UX e teste [ALTO/MÉDIO, comprovado]

**Evidência:** `README.md` ainda chama produto de Radar e declara inglês/italiano como padrão; muitos comentários/labels são italianos ou ingleses; console usa tema claro, botões de navegação sem handler e indicadores de demonstração; `.env.example` duplica `CRON_SECRET`; CI inclui ESLint, TypeScript, testes `tests/*.test.ts`, build, mas **não** executa `scripts/e2e-security.mjs`, `scripts/e2e-server-actions.mjs`, `migrate:check`, scanner de segredos ou SCA.

**Correção:** inventário de strings/i18n pt-BR com teste contra regressão; dark mode global acessível; cada item de console deve navegar ou indicar indisponível; estados vazios, fonte/procedência; Playwright E2E por papéis, testes de acessibilidade, SCA/secret scanning, evidência de contrato em CI.

### P2-13 — Operação, observabilidade e escalabilidade [MÉDIO, lacunas]

**Evidência:** projeto tem workers `notify`/`dunning`, mas não há evidência de orquestração robusta de jobs por tenant em `deploy/docker-compose.yml`; logs/health não demonstram filas, dead-letter, recuperação, backups, métricas por fonte, saturação, SLA ou consumo IA por tenant em produção.

**Correção:** scheduler + fila com locks persistentes, reprocessamento e backoff, DLQ, métricas de saúde de fonte (GDELT 429), tracing por `tenant_id`/`run_id`, backup/restore, retenção, relatórios de custo e testes de carga. Meta de piloto: **4 clientes/hora, um a cada 15 minutos**, não declarada como já atingida.

### P2-14 — Licença, LGPD e contratos externos [ALTO como gate de negócio; revisão pendente]

**Evidência:** `LICENSE` e documentação identificam AGPL-3.0; a arquitetura comercial pretende serviço gerenciado com dados pessoais. Não há prova nesta auditoria de análise jurídica, DPA, RoPA, resposta a solicitações LGPD ou aderência dos conectores aos termos das fontes. **Ação:** parecer jurídico antes de comercialização, processos de titulares, contratos de processadores, minimização e políticas de retenção.

## 3. Priorização por impacto e esforço

| Ordem | Entrega | Prioridade | Impacto | Esforço estimado qualitativo | Critério de aceite |
|---|---|---|---|---|---|
| 1 | Remover usuários/senhas previsíveis; rotação e bootstrap seguro | P0 | Crítico | Baixo–médio | Nenhum login padrão em produção |
| 2 | Corrigir Asaas customer + header + conciliação + sandbox | P0 | Crítico | Médio | Pix E2E confirmado, órfão e replay testados |
| 3 | Tornar RLS efetivo, revendo driver/roles e acessos legados | P0 | Crítico | Alto | Tenant A nunca lê/escreve B em todos os caminhos |
| 4 | Remover KPIs fictícios fora de DEMO_MODE | P0 | Alto | Baixo–médio | Métrica real ou estado vazio identificado |
| 5 | Retenção por tenant sem DELETE silencioso | P0 | Alto | Médio | Log + dry-run + prova de descarte |
| 6 | SSRF RSS + revisão do outbound HTTP | P1 | Alto | Médio | HTTP interno e redirects bloqueados |
| 7 | Rate limit login + 2FA real para owner | P1 | Alto | Médio | Tentativas distribuídas contidas |
| 8 | Unificar IA/LLM gateway por tenant e consumir resultado | P1 | Alto | Médio–alto | Resposta real, uso real e cota testada |
| 9 | Migrações, readiness, restore, jobs e logs | P1 | Alto | Médio–alto | Inicialização e recuperação reprodutíveis |
| 10 | Navegação real do console e fonte de valor no portal | P1 | Alto | Médio | 5 tarefas comuns sem ajuda e sem dados falsos |
| 11 | Ampliar CI: E2E, SCA, secret scan, RLS, webhooks | P1 | Alto | Médio | Gates falham em regressão deliberada |
| 12 | Fila/cron por cliente, backoff GDELT e DLQ | P2 | Médio–alto | Alto | 4 coletas/hora monitoráveis, sem overlapping |
| 13 | Unificar nomenclatura/i18n, tokens de design, dark global | P2 | Médio | Médio | pt-BR consistente em 3 superfícies |
| 14 | Parecer AGPL/LGPD e contratos de APIs | Gate comercial | Alto | Variável | Parecer registrado, decisões aprovadas |

## 4. Roadmap de execução sem reescrita

**Fase 0 — Bloqueios para qualquer cliente real:** 1–5, 14. Desabilitar cobranças reais até integração corrigida; manter dados sintéticos só em sandbox. Criar DB descartável com tenants A/B e dados falsos para testes adversariais. Sem merge/deploy sem aceite do proprietário.

**Fase 1 — Beta seguro e útil:** 6–11. Unificar guard de tenant e compatibilidade do legado; portal mostrar: variação comparada a período anterior (somente se existir série), alertas com origem e hora, procedência das menções, acurácia de sentimento, status das fontes, exportação explicável; console mostrar custo real de IA, atividade de coleta e inadimplência.

**Fase 2 — Operação contínua:** 12–13. Scheduler de um cliente por 15 minutos, histórico de tentativas por fonte, backoff de GDELT, alertas de falha, relatórios periódicos, verificação de backup e incidentes.

**Fase 3 — Escala:** PostgreSQL gerenciado com RLS comprovado, filas duráveis, serviços separados para coleta/IA, caching e índices guiados por `EXPLAIN ANALYZE`, observabilidade e custo por tenant; não adicionar componentes complexos antes de medir gargalos.

## 5. Matriz mínima de homologação

1. **Segurança:** boot sem contas padrão; troca de senha e revogação; rate limit; read/write/exports/Server Actions/MCP cruzados A/B; SSRF por RSS/LLM com IP privado, redirect e host dinâmico.
2. **Dados:** operações CRUD de tenant, projetos/menções, import/export, dedupe e retenção sob duas políticas; nenhuma deleção sem artefato e log.
3. **IA:** provedor OpenAI-compatible cadastrado, chave via ENV, resposta consumida, JSON inválido/timeout/429, quota por tenant, comparação com legado; não há custo fixo sem observação.
4. **Pagamento:** criar cliente real no sandbox Asaas, criar fatura e Pix, confirmar webhook com `asaas-access-token`, replay e eventos fora de ordem, duas faturas com mesmo valor; Stripe sandbox com assinatura/timestamp e conciliação inequívoca; falha não libera contrato.
5. **Produto:** conta sem dados não mostra números inventados; 4 abas cliente úteis; console navega e expõe configurações existentes; diferenças de privilégio owner/analyst/client; idioma pt-BR e tema global.
6. **Operação:** migrations idempotentes e versionadas, readiness, backup + restore completo, coleta 4/h com janelas de 15 min, 429 GDELT, notificação, DLQ e desligamento/restart de serviço.

## 6. Evidência e trilha de auditoria

- Snapshot: https://github.com/OARANHA/vigiaplus/commit/d2d9eafe7667b21a4badc14a3161501f5c72513d
- CI concluído com sucesso: https://github.com/OARANHA/vigiaplus/actions/runs/42541351420
- Políticas RLS: https://github.com/OARANHA/vigiaplus/blob/d2d9eafe7667b21a4badc14a3161501f5c72513d/migrations/00002_rls.sql
- Código principal: `lib/db/vigia-seed.ts`, `lib/db/index.ts`, `lib/tenant/scope.ts`, `lib/billing/{events,gateways,process}.ts`, `app/api/webhooks/pix/route.ts`, `app/api/app/summary/route.ts`, `app/console/page.tsx`, `lib/connectors/{rss,util}.ts`, `lib/pipeline.ts`.
- Docs oficiais: https://docs.asaas.com/reference/criar-nova-cobranca ; https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook.

**Status final:** DOCUMENTAÇÃO/REVISÃO ESTÁTICA; **não aprovado para produção**. Os riscos são do snapshot auditado e devem ser reconfirmados no HEAD de qualquer PR de correção. **Não houve teste em `D:\VIGIAPLUS` nem em ambiente publicado.**
