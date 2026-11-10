# VIGIAPLUS — Auditoria UX por persona e valor (09/11/2026)

**Alvo auditado:** PR #18 (HEAD fbe405a). **Métodos:** revisão de Next.js/React, respostas das APIs, permissões, inspeção da tela pública de login (Chrome headless 1440×900) e critérios das skills Impeccable v4.3.1 e Dashboards & Real-Time Visualization. A captura original permanece apenas em D:\VIGIAPLUS\.data\ux-captures\login-1440.png.

O binário de detecção Impeccable não está instalado no repositório. **Não foi realizada medição automatizada WCAG nem captura autenticada do console/portal.** A crítica visual dessas duas superfícies é baseada nos componentes e CSS, não em imagens ao vivo.

## Evidências e prioridades

| Nível | Achado | Evidência | Consequência |
|---|---|---|---|
| P1 | Dono vê grade genérica de KPIs antes da operação | components/console-owner-dashboard.tsx | Não sabe o que verificar primeiro |
| P1 | Cliente vê 4 cartões iguais e listas cruas | app/portal/page.tsx | Falta conexão com decisão e fonte original |
| P1 | Falha de evidências apaga panorama | Promise.all em app/portal/page.tsx | Apresenta indisponibilidade de dados que existem |
| P1 | Rótulo “Fontes observadas” é semanticamente falso | summary: COUNT DISTINCT mentions.source em 14 dias | Confunde cobertura de notícias com fontes cadastradas |
| P1 | system=true inclui analista | permissionsFingerprint(ctx) | Cliente portal tenta mostrar recursos exclusivos do dono |
| P1 | Data da última menção chamada de última coleta | summary.work_evidence.updated_at | Atribui frescor sem execução verificada |
| P2 | Erro de plano deixa mensagem de carregamento contínuo | app/portal/page.tsx | Sem recuperação clara |
| P2 | CSS duplicado e valores literais em cp-* e tokens globais | portal-extra.css e globals.css | Drifts cromáticos e tipográficos |
| P2 | Textos de 10–12px em painéis densos | portal-extra.css | Exige avaliação de contraste/zoom em tela real |

## Experiência preservada
- Login em duas colunas com identidade VigiaPlus roxo/azul, validado por screenshot real.
- Sem estatística, nota ou variação de reputação inventada quando os dados não permitem cálculo.
- Autorização por vínculo de cliente e console próprio do proprietário.
- Sem ligação com gateways ou bancos de produção.

## Desenho aplicado
**Dono:** primeiro contato com fila por cliente (incidentes graves, falhas e coletas parciais, faturas marcadas em atraso e projetos sem histórico), cobertura da operação e link à visão individual. Ausência de histórico é informativa, nunca erro presumido. Ferramentas secundárias ficam recolhidas.

**Cliente:** briefing com uma ocorrência registrada ou última evidência (título, fonte, data e link), acompanhado de base auditável, status da coleta e período. Cards genéricos substituídos por faixa compacta de fatos com definições verificáveis. Erro ao consultar evidências não anula resumo; erro do plano mostra recuperação.

**Regra:** não transformar ausência de alerta registrado em promessa de ausência de crise; não confundir coleta concluída com atualização em tempo real; não criar gráficos temporais sem série histórica.

## Bloqueios de release
1. RLS em PostgreSQL real e rotas legado ainda NO-GO; PR #14 não ativada.
2. Pagamentos Stripe/Asaas sem homologação sandbox; PR #15 separada.
3. Agendador 4 clientes/h continua opt-in DESLIGADO; não anunciar como operacional.
4. Falta rodar browser autenticado em 1440/1024/390, contraste WCAG e navegação teclado.
5. Etapa seguinte: consolidar tokens e criar fluxo real de atribuição, acompanhamento e fechamento de alertas, com trilha de auditoria.

## Critérios verificáveis
- Proprietário localiza uma pendência registrada em até 3 interações.
- Cliente encontra título, origem, data e link original quando existirem.
- Falha de uma API não zera outros indicadores; estado de erro é explícito.
- Qualquer número tem período, fonte e interpretação corretos.
- Todos os textos operacionais dessas superfícies em português brasileiro.
