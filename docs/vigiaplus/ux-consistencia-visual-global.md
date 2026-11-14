# VIGIAPLUS — auditoria e contrato de consistência visual

Data: 2026-11-14. Objetivo: impedir a entrega de áreas com identidade e navegação incompatíveis. Base: inspeção do checkout local `D:\VIGIAPLUS` e fontes atuais da PR #36. **Sem capturas reais concluídas** neste marco.

## Diagnóstico comprovado

A aplicação já possui **duas arquiteturas de tela**:
- `app/layout.tsx` monta a `Sidebar` e a área analítica legada (Radar), com `PageHeader`, `.panel`, Tailwind e cores sky/slate.
- `components/vpx-dashboard-shell.tsx` monta a superfície de proprietário/cliente, com `.vpx-app`, topbar, tabs, cartões, formas de status e seletor de aparência. `/console`, `/console/admin` e `/portal` passam por esse fluxo.
- A autenticação em `app/vigia-client-auth.css` tem composição própria de duas colunas com paleta violeta; deve manter a composição, mas compartilhar marca, fontes, foco e cores-base.
- Telas de apresentação/compartilhamento têm necessidades próprias; não se deve colocar uma sidebar dentro do login, de tela de TV ou de link público.

Inventário estrutural do checkout local na auditoria:
- **73** arquivos `app/**/page.tsx`;
- **57** arquivos referenciam `PageHeader`;
- **42** páginas incluem `.panel`;
- **15** páginas contêm algum `style={{...}}` inline (nem todos são defeitos);
- **2** páginas usam pelo menos uma utilidade Tailwind com cor hexadecimal arbitrária: `landing` e `share/[token]`;
- Rotas sem `PageHeader` que merecem triagem: `/impostazioni`, `/story`, `/tv`, `/vigia`, `/insights/geo`; login, portal, console, páginas públicas e redirect raiz são exceções justificáveis.

Essas contagens são **marcadores estáticos**, não reprovação automática nem garantia de consistência visual. A verificação por screenshot real e por perfil permanece necessária.

## Mapa de divergências

| Pri. | Superfície | Divergência verificada | Direção da correção | Progresso |
| --- | --- | --- | --- | --- |
| P0 | Global | Shell legado de analista separado da shell Vpx do proprietário/cliente | Tokens e hierarquia comuns; migrar gradualmente cabeçalho, navegação e superfícies | Base implementada; estrutura ainda dupla |
| P0 | Tema | Modo claro/escuro era gerenciado dentro da shell Vpx; a área analítica mantinha tema fixo escuro | Estado localStorage único, variações de superfícies/contrastes e controle visível | Preferência compartilhada e botão analista implementados; validar telas |
| P0 | Componentes | `.panel`/KPI e `.vpx-card` não compartilhavam semântica de card | Mesmos tokens para superfície, borda, raio, foco, contraste, espaçamento | Tokens e headers/KPI analítico implementados; componentes secundários pendentes |
| P1 | Login, convite, recuperação | Composição e paleta violeta em CSS próprio | Preservar duas colunas, incorporar tipografia, marca, tokens e acessibilidade | Login recebeu base verde/teal compartilhada; convite/recuperação e inspeção visual pendentes |
| P1 | Analista | Sidebar/nav legada sky/slate difere da topbar/tabs Vpx | Harmonizar branding e seleção, decidir navegação responsiva por função sem duplicar shell | Superfície e toggle atualizados; navegação a harmonizar |
| P1 | `/impostazioni` e demais legadas | Parte da UX, nomes e microcopy herdadas do Radar italiano/inglês | Redirecionamentos, rótulos e ajuda em português; não quebrar URLs antigas sem migration | Pendente |
| P1 | `/story`, `/tv`, `/insights/geo`, `/vigia` | Ausência de PageHeader em estrutura legada; telas com componentes próprios | Revisão caso a caso; TV e share podem ser full-screen por função | Pendente de inspeção visual |
| P2 | Páginas com estilos inline | Estilos específicos dispersos (15 marcadores locais) | Avaliar se são gráficos intencionais ou dívida visual; mover padrões para componentes | Inventariado |
| P2 | `/landing`, `/share/[token]` | Cores arbitrárias em classes Tailwind | Normalizar marca e cores, preservando experiência pública | Inventariado |

## Contrato visual de aceite (para todas as páginas aplicáveis)

1. **Marca:** VigiaPlus, tipografia Geist, densidade, cores semânticas e ícones coerentes.
2. **Navegação:** proprietário e cliente veem só seus módulos; analista mantém navegação funcional, sem duplicar cabeçalhos ou perder ações.
3. **Hierarquia:** título/descrição, ações primárias, filtros, indicadores, tabelas e estados de carregamento/erro/vazio na mesma ordem visual.
4. **Tokenização:** cores, raios, bordas, sombras, foco e dimensões derivam de `app/vigia-design-tokens.css` em vez de novas paletas por rota.
5. **Temas:** claro e escuro têm contraste/estados equivalentes; preferência `vigiaplus-dashboard-theme` persiste ao cruzar superfícies.
6. **Responsividade:** revisar desktop e mobile; sidebar analítica deve ser acessível sem ocultar conteúdo, tabelas não podem cortar ações importantes.
7. **Estados:** sem dados ≠ erro; não inventar KPIs, relatórios, integração externa ou disponibilidade.
8. **Português BR:** textos operacionais e de erro não devem alternar entre português, italiano e inglês sem intenção explícita.
9. **Acessibilidade:** foco visível, rótulos e botões sem depender só de cor; mínimo de contraste auditado visualmente.
10. **Exceções funcionais:** login, recuperação, TV, apresentação e share não recebem sidebar operacional, mas compartilham identidade e comportamento visual.

## Entrega desta primeira fase

- `app/vigia-design-tokens.css`: paleta light/dark compartilhada, estados de foco, superfície da sidebar legada, card/KPI/header analíticos e regras de compatibilidade temporárias.
- `components/vigia-appearance.tsx`: tema persistente em um único `localStorage` e atributo `data-vigia-theme` no documento.
- `components/vpx-dashboard-shell.tsx`: owner/client passam a usar a mesma preferência.
- `components/sidebar.tsx`: controle de tema acessível e superfície semântica também em mobile.
- `app/layout.tsx`: injeta design tokens e classes de escopo nas rotas analíticas.
- `app/vpx-dashboard.css`: consome os tokens semânticos de proprietário/cliente.
- `components/ui.tsx`: cabeçalho e KPI analíticos com identidade comum.
- `app/vigia-client-auth.css`: login de duas colunas harmonizado com a paleta compartilhada sem mudança do fluxo de autenticação.

**Ainda não certificado:** compatibilidade final de todas as páginas com modo claro, 390px/mobile, contraste, gráficos e páginas especiais; não existe captura comprobatória neste marco. Não classificar 73 páginas como visivelmente padronizadas.

## Evidência de execução visual em localhost (prévia isolada)

Em 2026-11-14, foi levantado um **git worktree descartável de revisão** em `D:\VIGIAPLUS\.data\ux-review-20261114` com o HEAD da PR #36, usando somente `DEMO_MODE=1`, banco PGlite isolado e `DATABASE_URL` ausente. O checkout principal não foi trocado. A prévia Next.js escuta em `127.0.0.1:3199`.

O Playwright Chromium executou inspeção **real** de 12 rotas em 1440×900, com ambos os temas, e quatro rotas em 390×844, também nos dois temas: **32 estados fotografados / 32 HTTP 200 / 0 erros de captura / 0 overflow horizontal detectado**. O atributo global de tema coincidiu com o tema solicitado nos 32 estados. Destinos `/story` e `/insights/geo` redirecionaram respectivamente a `/narratives` e `/graph?preset=map`: são redirecionamentos funcionais, não necessariamente falta de layout.

As imagens e os resultados ficam **somente no Windows**, fora do Git: `D:\VIGIAPLUS\.data\ux-visual-qa-20261114\` (com prévia anterior em `ux-visual-qa-20261114-before-stage`). Os screenshots confirmam que o painel do proprietário e o portal do cliente compartilham visual Vpx, enquanto a área analítica continua com sidebar/densidade herdadas do Radar, agora dentro de um estágio visual com tokens similares. A diferença de navegação entre essas áreas ainda é **P0 pendente de consolidação**. Prints não comprovam gravação, autorização de produção nem funcionamento das integrações.

## Ordem recomendada de execução

**Fase 1 (em progresso):** unificar paleta, semântica de superfície, estado de tema e cabeçalhos. Homologar renderização após CI do exato HEAD.

**Fase 2:** screenshot real com a Screen Academy por perfil e tema em ambiente de dados sintéticos. Gerar relatório por rota de divergência: estrutura, cards, grids, formulários, idioma, navegação.

**Fase 3:** migrar páginas analíticas e administração segundo criticidade visual, sem remover funcionalidades. Corrigir login/recuperação, `/impostazioni` e rotas especiais onde for comprovado.

**Fase 4:** reexecutar captura por página e fechar critérios de aceite antes de publicar cursos/aulas e antes de recomendar produção.

As mudanças permanecem na PR #36 DRAFT. Não autorizam merge, deploy nem uso do banco de produção.
