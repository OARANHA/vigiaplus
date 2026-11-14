# VIGIAPLUS — protocolo de evolução e documentação viva

**Owner de autorização:** proprietário. **Fonte de backlog:** `TODO.md`. **Memória de continuidade:** ELUS Memory Admin, banco `vigiaelus`. **Código e docs:** GitHub `OARANHA/vigiaplus`.

## Critério de mudança

Para toda PR/commit registrar: (1) ID do TODO e motivação; (2) riscos/contratos alterados; (3) testes reproduzíveis e resultados; (4) SHA da PR; (5) execução do CI e conclusão por job; (6) E2E manual exigido e steps *executados*, não pulados; (7) migrations/rollback, incluindo roles e ACLs; (8) QA por perfis; (9) bloqueios; (10) checkpoint no ELUS Memory.

**Estados distintos:** `DESENHADO` → `IMPLEMENTADO` → `CI_GREEN` → `STAGING_GREEN` → `HOMOLOGADO_OPERACIONAL` → `AUTORIZADO_PRODUCAO`. Só promover quando critérios objetivos passarem; commits novos zeram a certificação de CI para o novo SHA.

## Manutenção de documentação viva

Sempre que código mudar, comparar contratos reais com:
- `AGENTS.md` (orientações dos agentes e Next.js).
- `docs/architecture/README.md` (fluxos/componentes/fronteiras).
- `docs/vigiaplus/` (gates e runbooks específicos).
- `TODO.md` (checkbox principal representa **aceite final**, subtarefas podem ter testes aprovados).
- `docs/decisions/` (ADRs para tradeoffs duráveis).

Relatórios de CI/Neon documentados por SHA e URL; não copiar resultado verde do SHA antigo. O checkpoint sincronizado em memória não substitui documentos versionados.

## Regras de gate

- Caso `main`/PR DRAFT, sem merge/deploy sem autorização.
- Sempre verificar conflitos de dependências entre PRs DRAFT antes de integração.
- Isolamento de dois tenants não basta sem auditoria de todas as APIs, exports, workers, jobs e papéis.
- Migrações de staging: snapshot de policies/ACLs, preflight do banco e role, diferença mínima, rollback da base original; não aplicar `DROP SCHEMA` sintético a tabelas operacionais preexistentes.
- Segurança: session_version/cookie real, autorização server-side, sanitização de erros, deny-by-default, secrets só em GitHub Actions/Neon.
- UX: owner/analyst/client_admin/client_viewer, 390/768/1440 px, claro/escuro, pt-BR, estados loading/empty/error e fontes/horários dos dados.

## Quadro de evidências até 2026-11-12

| Gate | SHA certificado | CI | Manual staging | Escopo |
|---|---|---|---|---|
| ALT-08.7, 08.8, 08.9 | `9ec57ea09252f21e439c0d9731a32857c52c1707` | [43229064782](https://github.com/OARANHA/vigiaplus/actions/runs/43229064782) 5/5 GREEN | [43230539688](https://github.com/OARANHA/vigiaplus/actions/runs/43230539688) GREEN | Neon staging isolado, HTTP harness, dados sintéticos, rollback 0/0/0 |

**IMPORTANTE:** essa evidência pertence ao SHA explicitado, não aos próximos commits de documentação.

## ADRs

Registrar novo ADR numerado se houver modificação de driver de produção, topologia do banco, modelo de tenancy, RBAC, política RLS, cobrança, persistência ou roteamento de API. Cada ADR deve conter contexto, decisão, alternativas, consequências, rollback e autorização.
