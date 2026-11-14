<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# VIGIAPLUS — regras para agentes de engenharia

> **Projeto:** OARANHA/vigiaplus. **Referência operacional:** `TODO.md`.
> Leia `docs/architecture/README.md` e `docs/engineering/CHANGE_PROTOCOL.md` antes de modificar código.

## Mandatos e limites

- Trabalhar em português brasileiro; manter rotas, mensagens e documentação de produto em pt-BR.
- **Não** executar merge, deploy, migrações de produção, criação de cobrança real ou exclusão de dados reais sem autorização explícita do proprietário.
- Antes de qualquer mudança, obter SHA HEAD real da PR, base/estado DRAFT, status do working tree e identificar se a rota já tem contrato de segurança.
- Não afirmar GREEN baseado em commit anterior, em job ainda running/queued ou em etapa opcional ignorada. Registrar SHA, run URL, job, step e resultado.
- Nunca confundir prova sintética em banco descartável com homologação do schema operacional completo ou lançamento comercial.
- Toda consulta cliente exige identidade validada no servidor, tenant derivado do membership e entitlement/assinatura conferidos. Parâmetros `tenant_id` do request são hostis.
- Para RLS: transação pinada, `SET LOCAL`, menor privilégio, role **sem BYPASSRLS**, políticas e grants por coluna; owners de banco não podem certificar isolamento.
- CI somente com dados sintéticos e bancos dedicados. Exigir preflight e rollback; abortar caso alvo/role/schema não correspondam exatamente.
- Proteger secrets: jamais gravar URLs com credenciais, tokens, senhas, cookies ou dados pessoais no Git, logs, documentação ou ELUS Memory.
- Preservar `.env.local`, `.data`, alterações locais e processo atual na porta 3199; não abrir instância na porta 3100.
- Não fazer `git reset --hard`, `push --force` ou sobrescrever alterações não verificadas.

## Perfis de atuação (responsabilidades, não agentes autônomos instalados)

1. **Arquitetura:** contratos, dependências, ADRs, compatibilidade entre PRs DRAFT e limites de produto.
2. **Backend/Auth/RLS:** sessão, memberships, entitlements, papéis, isolamento e SQL reversível.
3. **Operação/Alertas:** coleta, scheduler 4 clientes/hora, filas, dedupe, retries, entrega e logs.
4. **Frontend/UX:** console proprietário e portal; layouts light/dark, acessibilidade, pt-BR, métricas verificáveis.
5. **QA/Segurança:** adversarial A/B, HTTP autenticado, regressões, testes no SHA exato, auditoria de rollback e CI.

Um agente pode exercer mais de um perfil, mas deve registrar critérios de aceite para cada alteração. Esses perfis **não** constituem processos em execução.

## Fluxo obrigatório

1. Consultar `TODO.md`, docs de arquitetura e memória `ELUS Memory Admin` banco `vigiaelus`; verificar GitHub atual, sem depender de lembrança de um chat anterior.
2. Abrir/continuar PR DRAFT e delimitar um único gate por mudança; relacionar riscos, escopo, testes e rollback.
3. Implementar com teste de regressão, segurança por padrão e observabilidade sem PII.
4. Verificar build, TypeScript, testes unitários/integrados, CI no HEAD exato e E2E manual quando especificado. Se não houver evidência, registrar PENDENTE.
5. Atualizar `TODO.md`, documentação/ADR afetada, PR e ELUS Memory com SHA, run, resultado e lacunas. Nunca fechar aceite por mera presença de código.
6. Aguardar aprovação explícita antes de merge/deploy ou ativação em dados operacionais.

## Gates atuais

- ALT-08.7/08.8/08.9: testes de staging isolado **sintético** GREEN no SHA `9ec57ea09252f21e439c0d9731a32857c52c1707` (run manual 43230539688, CI 43229064782). Esses resultados são históricos após qualquer novo commit.
- ALT-08.10 (planejada): validar rota Next.js real com mesma identidade/banco staging e papéis de serviço; **não** usar o harness ALT-08.9 como prova disso.
- GO-01 a GO-07: pendentes; produção **NO-GO**.

## Arquivos de referência

- `TODO.md` — backlog e critérios de aceite.
- `docs/architecture/README.md` — mapa de componentes e limites.
- `docs/engineering/CHANGE_PROTOCOL.md` — regras de prova, checklist de PR e documentação viva.
- `docs/vigiaplus/alt087-isolated-staging.md`, `alt088-operational-staging-gate.md`, `alt089-staging-http-auth-gate.md` — contratos dos ensaios RLS/HTTP.
