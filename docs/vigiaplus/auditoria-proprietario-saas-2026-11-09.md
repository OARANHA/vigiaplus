# VIGIAPLUS — Auditoria do proprietário SaaS e lacunas de planos
Data: 09/11/2026. Fonte: OARANHA/vigiaplus, PR #20, HEAD 0e867b3f46eeb9ea2556eaf33b49fe11c6ff6c7a.
Metodo: leitura estatica do codigo; inventario 75 rotas de API, 67 paginas e 445 arquivos TS/TSX/SQL; verificacao das especificacoes existentes em docs/vigiaplus/remodelagem.md e vigiaplus-roadmap.md. NAO realizados: sessao autenticada visual, banco remoto, sandbox financeiro ou pentest.

## Conclusao
O SaaS ja possui tabelas de plano, assinatura e recursos, motor de direitos, cobranca avulsa e indicadores financeiros. FALTA a interface e parte significativa do dominio operacional para o proprietario criar/publicar/atribuir planos e efetivar direitos sem editar codigo. A especificacao ja previa 13 areas administrativas (~40 telas); o console atual tem cinco abas resumidas.

## Inventario confirmado
| Dominio | Evidencia | Situacao |
| --- | --- | --- |
| Planos | lib/tenant/catalog.ts; lib/db/schema.ts | 4 planos fixos no TypeScript, tabelas presentes; sem CRUD de precos/limites/versoes via API owner |
| Matriz de recursos | plan_features e PLAN_FEATURES | tabela sem uso como fonte efetiva: lib/tenant/entitlements.ts usa mapa estatico |
| Habilitacao por cliente | app/api/console/tenants/[id]/features/route.ts | GET/PATCH com requireOwner e auditoria, mas nenhuma tela administrativa chama a API |
| Cadastro de cliente | app/api/console/tenants/route.ts | apenas GET; sem POST/PATCH para onboarding e edicao da organizacao |
| Atribuicao de plano | subscriptions, tenants.planKey | sem endpoint/UX de upgrade, downgrade, trial, suspensao ou ciclo; possibilidade de divergencia de campos |
| Pagamentos | app/api/billing/checkout/route.ts e gateways.ts | cobranca de fatura por Pix ou cartao; Stripe mode=payment (avulso), sem fluxo completo de assinatura recorrente |
| Faturas | app/api/app/plan/route.ts e app/api/console/billing/route.ts | APIs consultivas; portal exibe contratacao e faturas, mas nao consome endpoint de checkout |
| Gateways | lib/billing/gateways.ts | status de chaves por ENV; sem gestao segura/provisionamento pela UI owner |
| IA | app/api/console/llm-providers/route.ts | API owner GET/POST, mas dashboard apenas lista e exibe estado, sem formulario operacional completo |
| Agendamento | PR #11 DRAFT, fora da cadeia PR20 | nao presente em app/api/console nem no UI atual; 4 clientes/h nao certificado |
| Isolamento e financeiro atomico | PRs #14 e #15 DRAFT | nao integrados nesta branch; gate de producao permanece NO-GO |
| Aparencia | app/vpx-dashboard.css | light/dark nas telas /console e /portal, nao no fluxo inteiro de /settings e /impostazioni |

## Falhas P0 (com caminhos para reproduzir)
1. OVERRIDE X ASSINATURA: lib/tenant/entitlements.ts, featureState avalia liberacao enabled=1 ANTES de negar falta de assinatura ativa. Uma liberacao manual pode continuar dando acesso quando nao ha assinatura. Definir excecao de cortesia explicita, auditada e com prazo; por padrao cobrar antes de conceder.
2. BLOQUEIO EXPIRADO: mesma funcao procura qualquer enabled=0 sem filtrar expiresAt. Um bloqueio temporario nunca retorna automaticamente ao plano apos vencer.
3. DUPLA FONTE DE VERDADE: tabela plan_features recebe seed, mas a verificacao consulta PLAN_FEATURES do catalog.ts estatico. Alterar banco nao altera contratos. Unificar fonte versionada no banco.
4. ROTAS SEM GATE EFETIVO: requireFeature aparece em app/api/app/summary, app/api/analyst/pages e lib/tenant/llm-registry, alem da definicao; catalogo tem 13 chaves. Auditar cada API sensivel: crise, playbook, relatorio, aviso, API/MCP, busca e white-label. Ocultar UI nao basta.
5. COTAS: mentionsLimit e retentionMonths aparecem em schema/seed, mas scanner nao encontrou aplicacao operacional desses campos; cota de IA existe em llm-registry. Aplicar consumo e limites de menções, fontes, usuarios, IA e retencao no backend com teste de fronteira.
6. SEGURANCA: driver RLS transacional PR #14 permanece fora deste HEAD. Exigir role de banco restrita e testes cross-tenant antes de cliente pagante.
7. COBRANCA: lib/billing/process.ts processa eventos/faturas/assinaturas com escritas separadas sem transacao atomica; PR #15 corrige em ramo separado. Sem sandbox e replay verificados, nao ativar Stripe/Asaas em producao.

## Falhas P1/P2
- Plano/assinatura: nenhuma API admin de criar, editar, publicar, duplicar, arquivar planos; nenhum wizard de cliente e atribuicao de assinatura.
- Contratos ativos: subscriptions sem unicidade no schema para assinatura ativa por tenant; consultas podem selecionar a primeira arbitrariamente. Versionar contratos e fazer migracao controlada.
- Overrides: setTenantFeature faz consulta seguida de insert sem UNIQUE(tenant_id, feature_key), permite corrida/duplicidade; validar tenant, expiração e atomicidade.
- Resumo de inadimplencia: app/api/console/billing/route.ts soma faturas open com qualquer dueAt preenchido, mesmo a vencer; distinguir a vencer, vencido, processando e pago.
- Portal Meu Plano: sem consulta de limites consumidos, upgrade, pagamento clicavel e gestao de notificacoes; historico de avisos da API eh array vazio.
- Onboarding: sem cadastro de novo tenant, convite seguro, CNPJ e contatos validados, configuracao de projetos/fontes e primeiro teste de coleta em wizard.
- Consumo por cliente: MRR e custo IA agregados existem; faltam margem por tenant incluindo conectores e infraestrutura, alertas de teto e trilha de custo.
- Usuarios e permissoes: matriz client_admin/client_viewer existente; falta UX de convites por cliente, multiplas organizacoes, MFA proprietario, revogacao e auditoria completa.
- Agendamento: nao integrado no ramo atual; falta configuracao/ativacao por cliente e saude dos conectores, GDELT 429, retry e medicao de SLA.
- Design global: console/portal renovados; restantes dezenas de telas ainda usam shell, navegacao e idiomas legados.
- Produto/termos: revisar LGPD, retencao/expurgo seguro, e condicoes de licenciamento AGPL antes de comercializar.

## Modelo de experiencia para o dono
Navegacao principal em seis grupos, com subabas em vez de dezenas de capsulas:
1. Operacao: fila, coleta, crises, SLA medido e custos.
2. Clientes: novo cliente, organizacao, contas, convite, contrato, fontes, alvos, historico, simulacao cliente.
3. Planos: catalogo, editor, matriz recursos, limites e variacoes, versao e publicacao.
4. Assinaturas: contratos, faturas, Pix/Stripe, falhas, conciliação, inadimplencia e cancelamentos.
5. Inteligencia: fontes, modelos OpenAI-compatible, roteamento e cotas, relatorios, avisos.
6. Sistema: permissoes, cofre de segredos, integracoes, auditoria, LGPD, backups e health.

Jornada: tela inicial exibe contas precisando atencao, status de coleta, inadimplencia e custo da carteira. Botao NOVO CLIENTE e NOVO PLANO somente depois de existir fluxo funcional. No editor de plano: identidade e precos -> matriz de recursos -> limites -> revisao/publicacao. Em cada cliente: plano efetivo, recursos habilitados e sua origem (plano/override), consumo, faturas, historico, trocar contrato com previa e motivo.
O cliente final continua com quatro abas; Meu Plano exibe limite e uso real, inclusos, proxima cobranca, canal de aviso e um checkout real quando homologado.

## Sequencia e criterios de aceite
P0 Motor unificado: teste 4 planos x 13 features, suspensao, falta de assinatura, expiração dos dois tipos de override, concorrencia e auditoria.
P0 Quotas: enforcement de menções, fontes, usuarios, armazenamento/retencao e IA; limite reprovado em API, logs e UI explicativa; isolamento entre clientes.
P0 Seguranca e pagamentos: integrar PRs #14/#15 apenas em ambiente descartavel sob aprovacao, tests cross-tenant e sandbox Stripe/Asaas com webhooks duplicados/fora de ordem.
P1 CRUD de planos: versionamento, rascunho/publicado, ciclo mensal/anual, preco, limite, matriz dinamica e validacao; contrato antigo preservado ate migração.
P1 CRUD de clientes e contratos: onboarding, membro com convite, plano, trial, upgrade, downgrade, suspensao, overrides e trilha; teste ponta a ponta.
P1 Financeiro: emitir invoice, link Pix/cartao, recorrencia declarada, webhook, reembolso, erro e reconciliacao.
P1 Coleta: integrar agendador PR11 e configurar 4 clientes/h opt-in com logs reais e limites.
P2 UX: mesma identidade light/dark em todas as telas; linguagem 100% pt-BR, acessibilidade e testes visuais 1440/1024/390.

## Governanca
CI GREEN de PR20 confirma build/testes do SHA, nao significa SaaS comercial pronto. Todas PRs sao DRAFT e main permanece independente. Nao realizar merge, deploy, migrations remotas, ativar billing, webhooks ou scheduler sem aprovacao explicita do dono. Esta auditoria e documental, sem alteracoes funcionais no app.
