# Homologação real — Radar Intelligence

Execução em 06/11/2026 (America/Sao_Paulo; logs técnicos em UTC de 07/11).

## Origem e rastreabilidade

Fonte única: ZIP `radar-intelligence-correcoes-p0.zip`. O ZIP não continha Git. Após autorização explícita do proprietário, os 437 arquivos originais foram importados sem alterações no commit raiz `875aac37f58925b7ddf502843c75c184a1b7dc22` de `OARANHA/crises`. Os commits antigos citados em progress.md são referências históricas não recuperadas; não foram reconstruídos.

Branch: `fix/radar-homologacao-p0`. Código em execução: `746e509320fe72bd91981f740d19127b4c4ec4d1`. O commit de fechamento de evidências pode estar à frente dele, sem mudanças de aplicação.

Runtime: Next.js 16.2.10 **produção**, build webpack em `/workspace/radar-release`, PGlite persistente original em `/workspace/radar-demo/.data/pglite`, DEMO_MODE=1. Foram comparados 448 arquivos versionados com a cópia usada no build, sem divergências. Proveniência e BUILD_ID em `evidence/provenance.json`. Nenhuma credencial de produção foi configurada.

Túnel temporário: https://bkthpn-ip-90-96-179-26.tunnelmole.net/ — depende dos processos de Next.js e Tunnelmole e da rede deste ambiente. O cliente do túnel foi adaptado fora do projeto para proxy, diretório gravável e remoção de cabeçalhos hop-by-hop.

A memória `OARANHA/wmemory` foi consultada via Git, HEAD `06003454c75b0b625ff496ac2be8c7c8a8465139`; índice e regras lidos, sem entrada específica deste projeto. A memória não substituiu a documentação e não foi alterada.

## Três ciclos de qualidade

1. **Diagnóstico:** 245/245 testes totais, incluindo 14 testes de integração em banco isolado (não 13 como declarado anteriormente); lint sem erros, 44 avisos. Reprodução de hidratação incorreta nos botões de tradução, overflow 421/531px em viewport 390px, fontes Google indisponíveis e teste E2E que matava processos Next globalmente. Build inicialmente falhou no download das fontes; depois revelou importação de código Node no cliente do mapa.
2. **Correção:** testes red→green para SSR em pt/en/it, compilação browser dos códigos de países, login pt-BR e bloqueio de Server Actions. Fontes Geist originais hospedadas localmente com licença; mapa sem import de DB no cliente; layout, filtros, busca e tooltip adaptados; runner de segurança isolado e sem pkill global. 27/27 E2E iniciais passaram, mas uma prova adicional em DB descartável descobriu criação de projeto via Server Action na demo (303). Corrigidos o proxy e os guards de escrita/ownership das dez famílias de ações, incluindo entidades e links compartilhados.
3. **Revalidação:** build final e 261/261 testes totais aprovados, sem ignorados; 27/27 E2E de produção e mais 7/7 verificações de Server Actions/API Studio. Navegação real em Chromium desktop, tablet e mobile, fluxos administrativos em DB separado, filtros, busca vazia, mudança de idioma e menu móvel. A barra de exportação consultava Studio sem permissão (400 em toda página); corrigido, ausência dessas chamadas confirmada em navegador, endpoint agora usa 401/403/404 dos guards canônicos. Veja o sumário de navegador para o resultado final das capturas e requisições.

## Correções e provas

| Falha | Correção | Evidência |
|---|---|---|
| SSR usava Italiano, cliente Português | Locale serializado no MentionBody, sem leitura divergente de cookie | i18n-hydration.test.ts; 3 falhas antes, 4/4 depois |
| Header, busca, filtros e tooltip causavam overflow | Wrapping e tamanho flexível; tooltip móvel limitado à viewport | Capturas antes/depois; assert scrollWidth <= innerWidth |
| Google Fonts impedia build | Geist/Geist Mono locais, mesma identidade, licença preservada | build-release.log; assets em app/fonts |
| Mapa carregava DB/crypto/fs no bundle cliente | Backfill separado de conversões puras | country-browser.test.ts falha antes, passa depois; build |
| Login sem pt-BR e sem tratamento de conexão | Locale explícito, nomes acessíveis, erro anunciado | login-rendered.test.ts e login inválido/válido real |
| Runner matava a prévia e podia herdar .env.local | Só encerra grupos próprios; variáveis explícitas; segredo efêmero | Prévia preservada durante 27 E2E |
| Server Actions ignoravam read-only/auth/ownership | Proxy bloqueia POST de páginas na demo; guard de usuário e projeto nas ações | Prova inicial 303; final 403; testes de DB não persistem escrita não autorizada |
| ExportBar consultava API admin para membros | Fetch condicionado a permissão; Studio usa guards com códigos corretos | Export check passou de [400] para []; API demo 403 |

## Segurança P0 reproduzida

- Sessão revogada com HMAC válido: API retorna 401; ação mutável não persiste.
- revokeAll com sessão revogada: 401, sem bump adicional (integração).
- Sem projeto acessível: refresh 404, zero locks no DB, sem pipeline global.
- Demo: APIs de mutação 403 e POSTs de Server Actions 403. Preferência de idioma e logout alteram apenas cookies do navegador.
- SESSION_SECRET: segredo explícito, independente de APP_PASSWORD e validado no boot. Produção não demo sem segredo recusa servir páginas; testes de política cobrem segredos fracos/iguais.

Os 261 testes **incluem** a suíte de integração; não somar novamente 14 a esse total. Os 34 cenários E2E de produção são uma execução adicional, em bancos descartáveis. O código de CI gera segredo efêmero no processo e não precisa de segredo real salvo no GitHub.

## Fluxos funcionais comprovados

Administrador sintético: erro de login, login correto, páginas de projetos/configurações/consultas/importação/Studio, criação real de projeto por formulário, criação e salvamento de relatório, exportação PDF com assinatura %PDF- e 4265 bytes, logout e API sem cookie em 401. Capturas e PDF pertencem a um banco descartável; nenhuma operação administrativa foi liberada na demo pública.

Demo: filtro Reddit com 20 cards coerentes, busca sem resultados, alternância EN→pt-BR, menu móvel abrindo/navegando/fechando e ausência de exceções JS nesses fluxos. A captura de skeleton foi preservada como estado real de carregamento, não como tela carregada.

## CI e revisão

Workflow `.github/workflows/ci.yml`: Node 22, npm ci, lint, TypeScript, testes, build webpack, ambos os runners E2E e upload de evidências identificado por github.sha; permissions contents:read. Execução local usou Node 24.22.1; resultado no runner Node 22 precisa de confirmação pelo GitHub, não é inferido.

Git push funcionou. A API GitHub retornou exatamente `Get "https://api.github.com/repos/OARANHA/crises": Forbidden`. A liberação de api.github.com foi salva como rascunho preservando os domínios do túnel; não foi aplicada automaticamente. PR Draft e status do CI do HEAD exato permanecem **PENDENTES / NÃO VERIFICADOS**, nunca GREEN. Nenhum merge executado. Não confundir URL de criação de PR com PR criado.

## Pendências e decisão

- **P0 pendente:** retenção configurável e exportação registrada antes do descarte. A pipeline existente contém hard-delete em 90 dias; não foi acionada nesta homologação.
- **IA real em pt-BR: NÃO VALIDADA**, sem chaves autorizadas. Prompts e testes não provam geração real.
- **Incremento 3: BLOQUEADO**, não implementado.
- Tradução parcial permanece em seções secundárias e no editor de relatórios; dados fictícios mantêm o idioma original.
- Conectores com serviços externos/credenciais reais, entrega de notificações e IA de produção não foram certificados por esta execução.
- 44 avisos de lint existentes; não foi declarada conformidade integral WCAG.
- O túnel pode falhar/transitoriamente cancelar prefetch; documentos e chamadas relevantes são separados das requisições RSC canceladas durante navegação automatizada.

**GO apenas para demonstração técnica com dados fictícios e escopo descrito. NO-GO para produção e homologação integral**, até resolver P0 de retenção, evidenciar CI/PR e validar integrações exigidas. Os limites não são ocultados por testes locais aprovados.

## Fechamento da varredura final

61 documentos distintos pelo túnel: 60 responderam 200 na primeira abertura e `/tv` respondeu 503. Reteste **em navegador** de `/tv` retornou 200; `/source/reddit` também retornou 200. Doze capturas em 768px/390px ficaram sem overflow horizontal. Nenhuma exceção JavaScript de página foi capturada. Houve 503 transitório em prefetch RSC/favicon; os mesmos endereços foram reconsultados e responderam 200. Requisições canceladas durante navegação (`ERR_ABORTED`) são preservadas separadamente dos erros HTTP. Isso não constitui garantia de disponibilidade do túnel.

Artefatos: `evidence/browser-summary.json`, `browser-final.json`, `browser-rechecks.json`, `transport-rechecks.json` e `screenshots/`. O PDF sintético está em `evidence/synthetic-report.pdf`. A tela de carregamento capturada é um skeleton real, não uma captura de conteúdo concluído.

A tentativa concreta de `gh pr create --draft --base main --head fix/radar-homologacao-p0` terminou com `Post "https://api.github.com/graphql": Forbidden`. **Não existe PR criada por esta execução.** A branch e seu push foram confirmados por git ls-remote. A URL de criação sugerida pelo GitHub é https://github.com/OARANHA/crises/pull/new/fix/radar-homologacao-p0 (não é URL de uma PR existente).
