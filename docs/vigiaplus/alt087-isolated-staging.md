# ALT-08.7 — Staging isolado Neon: inventário e gate real de transação

**Status:** staging isolado provisionado, role restrita comprovada, teste SQL transacional de leitura executado; **integração WebSocket HTTP e migração reversível no staging ainda PENDENTES**. Produção NO-GO.

## Recursos isolados criados em 2026-11-12

- Neon project dedicado a testes de VIGIAPLUS: `still-heart-81001946` (`vigiaplus-alt083-ws-ci`); projetos `28web` e `urbansite` não utilizados.
- Branch exclusiva `br-super-star-bbc317wq` (`vigiaplus-alt086-staging-isolated-20261112`), criada da branch de testes `br-winter-breeze-bbcj1vxm`, **não** da produção.
- Banco exclusivo `vigia_alt086_staging_20261112`, inicializado com **0 tabelas públicas e 0 policies públicas**, verificado via SQL.
- Role restrita `vigia_alt087_staging_reader` (acesso read_only ao banco e schema public); verificado `rolsuper=false`, `rolbypassrls=false`. A role owner do banco tem `rolbypassrls=true` e **não pode** executar os testes de isolamento.

## Provas efetivamente executadas (Neon PostgreSQL real; não WebSocket)

- Com a role `vigia_alt087_staging_reader`, uma transação confirmou `current_database()=vigia_alt086_staging_20261112` e `current_user=vigia_alt087_staging_reader`.
- Na mesma transação, `set_config('app.tenant_id','771',true)` retornou `771` e uma consulta subsequente leu `771`.
- Na consulta independente seguinte, `nullif(current_setting('app.tenant_id',true),'') IS NULL` (escopo não persistiu).
- **Essas consultas comprovam somente a semântica de GUC transacional no banco, não a execução pelo cliente WebSocket, não comprovam políticas em tabelas ou integração com sessão HTTP.**

## Próximo teste automático: integração Neon WS real

- `scripts/tests/alt087-staging-ws-preflight.ts` exige CI/GITHUB_ACTIONS, `NODE_ENV != production`, `DATABASE_URL` ausente, URL Neon com banco **exato** `vigia_alt086_staging_20261112`, usuário SQL **exato** `vigia_alt087_staging_reader`, sem `SUPERUSER/BYPASSRLS` e sem policies inesperadas.
- Usa `withNeonRlsPool` (driver real WebSocket) e `withTenantRlsTransaction` com tenants sintéticos 771→882, rollback forçado 993 e prova que uma conexão nova não herda `app.tenant_id`. Não cria/deleta tabelas.
- Foi adicionado como passo **opcional** no workflow manual já existente `.github/workflows/alt083-neon-e2e.yml`, executado **somente quando** o secret `VIGIA_ALT087_STAGING_URL` estiver configurado. Sem esse secret, a etapa é pulada e **não deve ser considerada homologada**.
- O secret deve usar **URL Neon WebSocket Postgres da branch e banco acima, role `vigia_alt087_staging_reader`**. Nunca usar a role owner ou conexão de produção; não registrar a URL em logs/documentos. Configurar no GitHub Actions via `gh secret set VIGIA_ALT087_STAGING_URL -R OARANHA/vigiaplus` com entrada oculta ou via UI de Secrets, após obter a URL no console Neon. O CI não cria secrets automaticamente.

## O que AINDA bloqueia homologação integral de staging

1. Executar o passo WS com a credencial dedicada e confirmar logs do SHA exato.
2. Popular o staging com **schema operacional real**, autenticação/memberships/planos/entitlements isolados e dados sintéticos A/B; o banco está inicialmente vazio. Distinguir dados operacionais de PGlite local.
3. Migrar uma tabela por vez sob role de migração separada; preservar manifesto de baseline `relrowsecurity`, `relforcerowsecurity`, SQL de policies, grants por coluna/role e ownership. A role reader não deve ganhar DDL.
4. Testar policies reais de A/B e permissões `SELECT` mínimas contra as quatro tabelas; validar REST HTTP assinado no *mesmo contexto de dados* e papéis internos com contratos próprios.
5. Executar rollback físico por tabela e comparar catálogo/ACLs com baseline exato; falhar fechado diante de objetos ou privilégios preexistentes.
6. Obter revisão e autorização do proprietário antes de merge, deploy, estágio seguinte ou qualquer mudança em produção.

**Estado: staging provisionado e conexão SQL transacional básica validada; NÃO homologado end-to-end.**
