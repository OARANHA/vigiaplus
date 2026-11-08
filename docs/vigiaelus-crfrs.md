# VigiaElus — CRF-RS — Etapas 1 e 2

## Escopo e governo

- Repositório: `OARANHA/crises`. Branch de incremento isolada `feat/vigiaelus-crfrs-etapas-1-2`, derivada da branch P0 `fix/radar-homologacao-p0`.
- Projeto: **CRF-RS — Reputação e Comunicação**, único projeto piloto; idioma `pt`, país `BR`, proprietário autenticado, visibilidade privada.
- Entidades: Giovana Ranquetat Fernandes; Funcionários CRF-RS; CRF-RS. Os perfis `@giovanaranquetat` e `@funcionarioscrfrs` são termos de busca públicos, **não conectores Instagram** nesta entrega.
- Criar piloto explicitamente e idempotentemente: `POST /api/vigia/pilot` (usuário administrador, sessão válida, DEMO_MODE proibido).
- Coletar projeto explicitamente: `POST /api/vigia/collect` com JSON `{"projectId": 123}` (sessão válida e autorização de proprietário ou admin). Sem `projectId`, retorna 400; sem permissão, 404.
- Tela operacional: `/vigia` (tela protegida com entidade/fonte/período, fontes habilitadas, última tentativa, menções, links externos e histórico).
- **Não há execução de IA, relatórios, alertas, notificações nem exclusão de dados no coletor manual.** A pipeline geral permanece intacta.

## Fontes habilitadas

| Fonte | Status de configuração | URL pública de origem | Observação |
|---|---|---|---|
| Google News | Habilitada no piloto, validação real pendente | https://news.google.com/rss/search | Consultas pt-BR / BR, `when:90d` |
| GDELT | Habilitada no piloto, validação real pendente | https://api.gdeltproject.org/api/v2/doc/doc | 1 consulta por rodada, janela `timespan=3d`, restrição Brasil |
| RSS/Atom externo | Desabilitado até feed real tecnicamente aprovado | A definir | Sem URL inventada; estado por projeto |
| Notícias do CRF-RS | Viabilidade de integração estruturada pendente | https://crfrs.org.br/noticias | Não declarar feed ativo sem inspeção |

Nenhuma contagem real do CRF-RS está validada até a execução comprovada do coletor contra serviços públicos em homologação. Resultados dos testes com stubs são **sintéticos**.

## Persistência

Migração aditiva no mecanismo existente `ensureSchema` (Drizzle + PGlite/Neon), sem banco operacional paralelo:

- `projects.enabled_sources` JSONB e `projects.pilot_key` único quando preenchido.
- `mentions.canonical_key` para URL canônica segura, além da chave existente `projectId + source + externalId`.
- `collection_runs`: `pending/running/success/partial/failed`, contagens, início/fim e erro sanitizado, por projeto. Índice único impede dois runs ativos por projeto.
- `collection_run_sources`: diagnóstico, horário, consulta, origem, contagens, descartes motivados, HTTP, duração e último sucesso.
- `mention_entities`: associação N:N das menções a entidades existentes `benchmark_entities`.
- `mention_discoveries`: proveniência distinta por run/fonte/id externo, mesmo quando duas fontes identificam o mesmo artigo.

O legado `source_status` global e a variável mutável do conector RSS foram substituídos por estado de fonte por projeto `source_status_<projectId>` e `ListeningQuery.rssFeeds`, sem compartilhamento de feeds entre coletas.

## Validação e limitações

Suítes criadas: `tests/vigia-core.test.ts` e `tests/vigia-integration.test.ts`, incluindo PGlite isolado, duplicação, estado vazio, erro HTTP, recuperação de histórico em disco, concorrência e separação de projetos. O runner P0 de Server Actions recebeu uma correção específica para o Node 22. Executar `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build -- --webpack`, e runners E2E; conferir workflows no HEAD atual e validar amostra real na interface.

**P0 bloqueante para uso produtivo:** retenção configurável e exportação registrada antes do descarte. Nenhuma rotina de exclusão foi executada/alterada. A branch P0 original não foi modificada; não houve merge, deploy nem escrita em banco de produção.

## Instagram — fase posterior, não implementada

- Perfis públicos candidatos: `@giovanaranquetat`, `@funcionarioscrfrs`.
- Business Discovery sujeito à confirmação de perfis Business/Creator e às permissões/credenciais oficiais Meta.
- Usar versão Graph API configurável por `META_GRAPH_API_VERSION` apenas após comprovação de suporte/compatibilidade.
- Diagnósticos sem segredos: `apiVersion`, endpoint sanitizado, `httpStatus`, `errorCode`, `errorMessage` sanitizada e `requestId` quando fornecido.
- Busca por hashtags e consulta direta de perfis são funcionalidades diferentes.

## Evidência exigida antes de aprovação final

Guardar branch/HEAD, run de CI, resultado completo dos testes, prints da UI, consulta efetiva por fonte, horário, retorno real, amostra de links, duplicatas da segunda rodada, falhas e status por projeto. **CI P0 original em `e8d127e` falhou no runner Server Actions Node 22**; o novo HEAD necessita seu próprio CI sem herdar o antigo resultado.
