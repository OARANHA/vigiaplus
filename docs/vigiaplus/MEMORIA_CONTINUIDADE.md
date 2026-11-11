# VIGIAPLUS — Memória de continuidade entre conversas

**Projeto canônico:** VIGIAPLUS · **repositório:** [OARANHA/vigiaplus](https://github.com/OARANHA/vigiaplus)  
**Atualizado:** 10/11/2026 · **origem:** projeto VigiaElus / Radar Intelligence (`OARANHA/crises`).  
**Estado:** desenvolvimento e homologação; **NO-GO para clientes externos**.  
**Banco de memória pretendido:** `vigiaplus` (ELUS Memory Admin); **criação bloqueada** em 10/11/2026 por erro PostgreSQL `could not resize shared memory segment ... No space left on device`. Banco anterior `vigiaelus` permanece intacto (1631 fatos conforme consulta anterior). **Este documento é uma cópia de segurança do contexto, não comprovação de que o banco novo foi criado.**

## Como retomar em outro chat — leia antes de executar

1. Ler este documento, [TODO.md](../../TODO.md) e [diário do TODO](./todo-execution-2026-11-10.md).
2. Consultar o **ELUS Memory Admin**, preferencialmente banco `vigiaplus` se ele já existir; enquanto não existir, consultar `vigiaelus`. **Não criar suposições a partir de uma memória antiga**.
3. Verificar GitHub **`main`, HEAD de cada PR, base/stack, DRAFT, CI e conclusão dos workflows no SHA exato**. CI GREEN de SHA anterior **não** valida o atual.
4. Antes de agir no Windows `D:\VIGIAPLUS`, consultar `git status`, branch e HEAD; verificar quem ocupa a porta **3199**, preservar o processo existente, `.data`, `.env.local`, logs não rastreados, e criar backup antes de qualquer troca de versão. Nunca rodar duas instâncias na 3199. **Porta 3100** pertence ao antigo `D:\CRISE_APP` e foi intencionalmente encerrada; não reabrir.
5. Implementar cada tarefa em PR **DRAFT** sem merge/deploy/migração remota automática; registrar SHA+CI+evidências e pendências no banco de memória indicado; solicitar autorização **expressa do proprietário** antes de qualquer merge ou deploy.
6. Se a conexão com o serviço de memória falhar, registrar checkpoint neste arquivo e em `docs/vigiaplus` na branch DRAFT, sem alegar sincronização com o banco. Retomar a gravação quando o serviço estiver operacional.

## Produto e proposta de valor

VIGIAPLUS é um SaaS de **inteligência, monitoramento de reputação e comunicação de crise** para múltiplas organizações. O **proprietário é o operador/admin global**; cada cliente deve ter portal seguro, organização, plano, fontes monitoradas, evidências verificáveis, análise, alertas e relatórios. A interface deve agregar valor — **não** ser um dashboard genérico com KPIs vazios. O painel do proprietário deve mostrar riscos, saúde das fontes e da coleta, carteira de clientes, alertas, tarefas, contratos, consumo, usuários e cobranças. O portal do cliente deve explicar **o que aconteceu, qual a relevância, evidências e o que fazer**, sempre com dados verificáveis e períodos reais.

**Piloto CRF-RS:** entidades alvos: Giovana Ranquetat Fernandes (reputação), funcionários do CRF-RS (mobilização/clima) e CRF-RS (reputação institucional). Fontes planejadas: Google News, GDELT, RSS, site CRF-RS, Instagram; perfis `@giovanaranquetat` e `@funcionarioscrfrs`. Coleta pretendida: **1 cliente a cada 15 minutos, 4/hora**, separada do processamento com IA; dedupe por URL normalizada/título/projeto e execução rastreada com origem, itens, novos, duplicados, erros e próxima coleta. Não afirmar que feeds privados/redes sociais ou cron já funcionam.

**GDELT:** anteriores erros de HTTP 429 no DOC API (rate limit), resposta não-JSON no GKG 2.1. Precisam de rate limit, retries, tratamento de formatos e testes reais antes de considerar o conector homologado.

**UX:** toda a aplicação coerente com a referência visual fornecida pelo proprietário; dashboard editorial, acolhedor e intuitivo, dark/light com persistência sem flash, tipografia e ícones consistentes, menus em português brasileiro e layout responsivo em 390/768/1440px. Login em duas colunas com narrativa/produto, sem sidebar na rota pública. Usar revisão de segurança, engenharia, design/UX, proprietário e cliente, não apenas screenshot.

**Integrações/negócio:** planos de acesso e matriz de recursos server-side; contratos, Stripe e Pix/Asaas em sandbox; custo de LLM compatível OpenAI e escolha de modelos; separação e monitoramento por tenant; evidências, incidentes, notificações por e-mail/Telegram, preferências, auditoria, LGPD e backup. Credenciais somente via ENV/cofre; **nunca copiá-las para memórias ou logs**.

## Arquitetura e ambiente conhecidos

- Código: Next.js/TypeScript, Drizzle ORM; banco local PGlite ou PostgreSQL remoto/Neon quando explicitamente configurado; JWT/cookie HMAC e `session_version` para revogação; password hashing scrypt com salt; backend owner RBAC, tenant memberships e validação de features/entitlements em implantação gradual.
- Local Windows: `D:\VIGIAPLUS`. Prévia `http://127.0.0.1:3199`. O antigo `D:\CRISE_APP` em 3100 foi encerrado por decisão do proprietário. Não tocar nele sem pedido.
- Backups conhecidos: `D:\VIGIAPLUS_LOCAL_SAFETY_20261110` e `D:\VIGIAPLUS_LOCAL_SAFETY_20261110_PR26_CLEAN` (cópia dos dados com processo parado); preservar sem reconstrução.
- Branch local de preview na última checagem anterior: `preview/owner-admin-pr24-20261110`, commit `f4743fd8a458516388349be144662c1368d0fcc1` (código PR #26 e documentação). **Não afirmar que PR #27 esteja sincronizada localmente até nova checagem/fast-forward**.
- Verificações anteriores de HTTP local: `GET /api/health` = 200; `GET /login` = 200; `GET /convite?token=invalid` = 200; `GET /api/console/invitations?tenant_id=1` sem sessão = 401. **Não constituem E2E autenticado**.
- Na etapa de 10/11 houve instabilidade da ponte do Blender em chamadas Windows (subprocess/tasklist retornando saída `None`, um comando bloqueado pela política e outro erro interno). Confirmar processo real antes de encerrar/reiniciar a 3199.

## Evolução GitHub por PR — estados e evidências

| PR / referência | Escopo | Estado evidenciado |
|---|---|---|
| [#11](https://github.com/OARANHA/vigiaplus/pull/11) | scheduler/coleta 15 minutos | DRAFT / integração e homologação pendentes; rever HEAD |
| [#14](https://github.com/OARANHA/vigiaplus/pull/14) | isolamento RLS | DRAFT / testar em banco PostgreSQL descartável com role restrita sem BYPASSRLS |
| [#15](https://github.com/OARANHA/vigiaplus/pull/15) | webhooks de cobrança | DRAFT / sandbox e replay/idempotência pendentes |
| [#20–#21](https://github.com/OARANHA/vigiaplus/pull/20) | UI/owner | stacked DRAFT; conferir sempre branch/CI |
| [#22](https://github.com/OARANHA/vigiaplus/pull/22) | owner SaaS, planos e permissões | DRAFT |
| [#23](https://github.com/OARANHA/vigiaplus/pull/23) | contratos e controle de recursos | DRAFT |
| [#24](https://github.com/OARANHA/vigiaplus/pull/24) | atomicidade comercial, diagnósticos, menu/admin | DRAFT; base PR #23; HEAD `550f2b8...` no começo deste ciclo; CI de SHA anterior não validar SHA novo |
| [#25](https://github.com/OARANHA/vigiaplus/pull/25) | SEC-01/SEC-02: contrato server-side e gate de senha temporária, legado bloqueado para clientes | DRAFT, base PR #24; HEAD `1a76be7485e7de91231692a6b10786ecb351adb5`; [CI GREEN 42889502935](https://github.com/OARANHA/vigiaplus/actions/runs/42889502935), 372/372 testes |
| [#26](https://github.com/OARANHA/vigiaplus/pull/26) | CL-01/CL-02: convites 256-bit hash SHA-256, 48h, revogação, aceite atômico, membership, UI e PGlite | DRAFT, base PR #25; HEAD `f4743fd8a458516388349be144662c1368d0fcc1`; [CI GREEN 42894323970](https://github.com/OARANHA/vigiaplus/actions/runs/42894323970), 375 testes no SHA de código anterior |
| [#27](https://github.com/OARANHA/vigiaplus/pull/27) | recuperação de senha CL-02 com tokens de 30min, cooldown, consumo atômico, rotação de sessões, UX /recuperar /redefinir | DRAFT, base PR #26; **HEAD `ec418358cf358128421e81b100fddb282097bc40`** após checkpoint TODO; [CI GREEN 42930897244](https://github.com/OARANHA/vigiaplus/actions/runs/42930897244) nesse SHA; 378/378 testes no SHA de código anterior `4e4e72ae...`, [run 42930313338](https://github.com/OARANHA/vigiaplus/actions/runs/42930313338). **Ainda não sincronizada localmente na última checagem** |

**Importante:** as PRs estão empilhadas, **não** na `main`. Todas continuam DRAFT até decisão explícita. Sempre revalidar quando retomar.

## TODO P0/P1/P2 — não confundir implementação com homologação

Fonte autoritativa de itens, aceite e subchecks: [TODO.md](../../TODO.md), atualizado na branch PR #27.

- **SEC-01**: proteger todas as APIs/evidências/exports por contrato e tenant (algumas corrigidas PR25); falta inventário completo, E2E autenticado A/B e RLS em PostgreSQL real descartável. **Aberto**.
- **SEC-02**: gate de troca de senha obrigatória no servidor (PR25), falta E2E do cookie e revogação. **Aberto**.
- **CL-01**: convite de conta nova + membership + auditoria (PR26), falta vínculo seguro de conta já existente e teste de jornada owner→cliente. **Aberto**.
- **CL-02**: convite seguro PR26 e recuperação por token SHA256 PR27, cooldown, novo hash e revogação de sessão; falta e-mail Resend **real**, verificação de entrega, reenvio, throttling por IP distribuído e E2E navegador. **Aberto**.
- **SEC-03**: verificar que `DEMO_MODE=1` não muta nenhuma API, ações ou banco; pendente.
- **SEC-04**: RLS com role restrita em Neon/PostgreSQL descartável, isolamento por tenant em rotas/jobs/exports; pendente.
- **SEC-05**: MFA real para owner/admin, gestão/revogação de sessões; pendente.
- **ALT-01–09**: corrigir idempotência por regra+fato+canal+destino, outbox com lease/retry/backoff/dead-letter, e-mail real Resend, prova de posse de destinatários, webhooks de `delivered`/`bounced` separados de `accepted`, timezone, scheduler e histórico operacional.
- **OPS-01–06**: scheduler confiável 4 clientes/h, GDELT/fonte health, health/readiness, limites server-side, cobrança/Asaas/Stripe sandbox, retenção LGPD, backup/restore.
- **ADM-01–03/UX-01–05**: ficha única e ciclo de vida de cliente, teste OpenAI-compatible real (sem resolver mock), painel dono/cliente de valor demonstrável com métricas verificáveis, consistência dark/light, QA responsivo.
- **GO-01–07**: primeiro cliente externo só quando todos os gates são comprovados; **NO-GO** até então.

## Memória e governança

**Banco antigo:** `vigiaelus`, nome `VigiaElus`, 1631 fatos observados em 10/11/2026, com histórico desde o piloto `OARANHA/crises` e checkpoints do novo VIGIAPLUS. Não apagar, não renomear automaticamente e não usar AMR.  
**Banco novo solicitado:** `vigiaplus` / `VIGIAPLUS`; criação e `sync_retain` **falharam** em 10/11/2026 por erro de memória compartilhada PostgreSQL (pedido de alocação ~534MB, `No space left on device`). `list_banks` confirmou não criado. **Ao retomar, verificar backend e repetir `create_bank` antes de afirmar que existe; migrar o conteúdo consolidado deste arquivo e checkpoints relevantes do banco antigo**.
**Política permanente:** a cada lote implementado, ou mudança de SHA/CI/PR/decisão/UX/infra, registrar `sync_retain` no banco novo e atualizar TODO e este arquivo quando for alteração durável. Exigir sucesso efetivo do retorno. Usar GitHub como fonte de código, memória como continuidade e banco operacional como fonte das métricas reais. Não registrar chaves, cookies ou senhas.

## Próxima execução recomendada

1. Confirmar PR #27 HEAD `ec418...`, base PR #26, CI do SHA atual; documentar divergência se houver.
2. Checar processo Windows 3199 com ferramenta estável; **não encerrar PID não verificado**. Backups dos dados antes de atualizar; fast-forward apenas se árvore rastreada limpa; reiniciar uma única instância na 3199 quando necessário e autorizada.
3. Testes API/E2E autenticados com 2 tenants em banco descartável, e-mail fake para testes de integração; sem enviar e-mail de produção.
4. Revisar origem, throttling e invariantes contra concorrência em recuperação; adicionar testes para requests repetidos e tokens expirados; não alegar que a emissão equivale à entrega.
5. Prosseguir SEC-03, SEC-04/RLS e depois confiabilidade de alertas, sem esquecer QA da experiência do proprietário/cliente.

**Fonte de verdade de produto/estado:** GitHub e CI no HEAD exato; este documento registra histórico, mas precisa de atualização após cada mudança.
