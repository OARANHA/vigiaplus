# VigiaPlus — Auditoria da interface administrativa (09/11/2026)

## Escopo e evidência
Análise dos arquivos da candidata de integração PR #9. Nenhuma aba da
interface do VigiaPlus estava aberta no navegador conectado; portanto,
a inspeção de layout em funcionamento e capturas em desktop e mobile
ainda precisam de homologação visual. Não confundir análise estática com
captura da aplicação real.

## Achados
1. \`app/layout.tsx\` já contém \`Sidebar\` global escura com tokens CSS
   \`--background\`, \`--panel\`, \`--border\`.
2. \`app/console/page.tsx\` usava \`bg-white\` e \`bg-gray-50\`, com uma
   segunda sidebar de 18 áreas dentro do conteúdo, quebrando o layout aprovado.
3. Algumas áreas tinham links repetidos ou nenhum destino funcional;
   LGPD, Marca e Auditoria eram exibidas como itens sem href.
4. Console era client-only, sem gate server explícito, embora endpoints
   \`/api/console/*\` já exijam \`requireOwner\`.
5. Abas \`settings-tabs\` e tooltips \`LocaleSwitch\` permaneciam em inglês.
6. O dicionário \`pt\` tinha cobertura da maioria dos itens globais,
   mas faltava \`nav.vigia\` e certas traduções mantinham palavras inglesas.
7. Falhas do carregamento de KPIs eram silenciadas com \`.catch(() => {})\`,
   podendo apresentar zero como se fosse informação confiável.

## Mudanças desta PR
- Console responsivo em dark, sem segunda sidebar, organizado por operações,
  inteligência e administração; atalho global somente para role \`owner\`.
- Proteção de acesso na página com sessão e \`globalRole\`, sem afetar
  guardas das APIs.
- Links apenas para rotas existentes ou âncoras reais. Indicadores usam
  dados dos endpoints; se falham mostram indisponibilidade, não zero.
- Tratamento do status financeiro como **MRR contratual**, sem afirmar receita
  recebida. Configuração de credenciais não é homologação de pagamentos.
- Textos, tooltips, abas e principais rótulos da sidebar em pt-BR.
- Páginas de Projetos, Fontes, Orçamento, Minha conta, Equipe e Créditos traduzidas
  para português brasileiro, preservando identificadores de serviços e atribuições
  legais do projeto original. Novo projeto começa com idioma português selecionado.
- Descrições de fontes e categorias em português, sem preços externos não verificados.
- Não muda banco, métricas, schemas, autenticação, deploy ou faturamento.

## Próximas verificações
1. Capturar interface autenticada como proprietário em 1440px, 1024px e
   390px e conferir contraste, rolagem de sidebar, foco e estados sem dados.
2. Estender a auditoria de idioma a telas analíticas e componentes auxiliares
   de terceiros; mensagens de erro técnicas poderão manter trechos do provedor.
   Migrar gradualmente os textos literais restantes para dicionário tipado.
3. Criar páginas funcionais para gestão de clientes/planos/LLMs/recebíveis,
   evitando links que apenas abrem uma lista sem ações.
4. Integrar PRs #10-#15 com revisão de segurança e E2E antes de produção.
