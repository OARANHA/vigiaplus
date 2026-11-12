# ADR-0001 — RLS em staging isolado antes de ativação operacional

**Status:** decisão de validação, não autorização de produção. **Data:** 2026-11-12.

## Contexto

`getDb()` operacional não usa o adapter WebSocket de RLS de modo global. Os testes ALT-08.7/08.8/08.9 usam Neon isolado, role reader sem BYPASSRLS, dados sintéticos e migrações reversíveis.

## Decisão

Preservar o caminho operacional atual. Evoluir em etapas incrementais, com autenticação assinada e checks de membership/entitlement no mesmo banco, validar rota Next real e papéis de serviço antes da troca de driver/policies. No banco de teste, nunca autenticar a role proprietária como leitor RLS.

## Alternativas não adotadas

Ativar FORCE RLS imediatamente em tabelas de produção, confiar em claims de `tenant_id` do browser, usar owner como leitor RLS, ou considerar harness sintético como homologação da aplicação.

## Consequências

Menor risco de violação cross-tenant; implantação adiada até cobertura integral de permissões, rotas e rollback que preserve ACLs preexistentes. Cada PR exige SHA+CI+E2E e autorização de deploy separada.

## Revisão

Reavaliar após ALT-08.10 e auditoria multi-tenant em endpoints, exports e workers.
