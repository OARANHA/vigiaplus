# Homologação Radar Intelligence — plano de execução

Execução inline autorizada pelo usuário; preservar projeto e design, sem Incremento 3.

1. Reconciliar ZIP, histórico documental, processos, túnel e memória; importar o ZIP intacto como commit raiz verdadeiro em OARANHA/crises, sem reconstruir histórico ausente.
2. Diagnóstico: reproduzir 245 testes, integração isolada, lint e navegação real desktop/tablet/mobile; preservar evidências do ciclo 1 fora do banco persistente.
3. Corrigir somente falhas comprovadas: hidratação do idioma em MentionBody, overflow móvel, fontes originais locais, isolamento e limpeza dos testes E2E. Criar regressões antes das correções. Arquivos previstos: components/mention-translate.tsx, components/ui.tsx, components/search-box.tsx, components/sidebar.tsx, app/layout.tsx, app/globals.css, scripts/e2e-security.mjs, .github/workflows/ci.yml e testes correspondentes.
4. Produção isolada: build em cópia dos fontes fora do servidor do túnel; nenhum teste deve matar processos globais, herdar DEMO_MODE de .env.local ou tocar .data/pglite persistente. Reproduzir os 27 cenários e registrar contagens reais, incluindo testes adicionais se necessários.
5. Revalidar telas, filtros, menu móvel e erros de console; separar limites deliberados da demo (admin e IA indisponíveis) de bugs. Retenção/exportação P0 pendente, IA real pt-BR não validada, Incremento 3 bloqueado.
6. Rastreabilidade: commit das correções, push sem force, PR Draft se API autorizada, conferir CI do HEAD exato. Nunca declarar GREEN com CI pendente ou API bloqueada. Registrar bloqueios e GO/NO-GO por ambiente.

Riscos de revisão: sessões revogadas com HMAC válido; revokeAll sem bump indevido; projeto ausente sem pipeline/lock global; boot sem segredo; SSR/client com locale diferente; conteúdo longo e viewport 390px; dependências externas ausentes. Testes de segurança e browser devem cobrir estes casos. Sem merges automáticos.
