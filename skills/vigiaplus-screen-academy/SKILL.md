---
name: vigiaplus-screen-academy
description: Capturar prints de telas reais do VigiaPlus em localhost, inspecionar títulos e controles visíveis, e gerar uma aula em português por tela, separada por owner, cliente e analista. Usar quando solicitarem prints, manual ilustrado, treinamento, documentação visual ou auditoria de UX a partir de telas reais.
---

# VigiaPlus Screen Academy

Skill de captura e documentação visual baseada em **sessões reais no navegador**. Não gera telas fictícias e não trata código-fonte como se fosse screenshot. Os registros gerados devem ser revisados antes de divulgar.

## Pré-requisito obrigatório

A aplicação deve estar rodando e acessível em `http://127.0.0.1:3199` no computador que executará o navegador. Em Windows, a partir do diretório `D:\VIGIAPLUS`, usar o launcher:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-vigiaplus-local.ps1
```

Esse launcher prepara um banco PGlite **somente local** e pede credenciais iniciais do proprietário. As credenciais **não** devem ser enviadas ao assistente. Uma instalação local sem dados de clientes precisa ser configurada no console antes de o portal do cliente apresentar números. Existe também `-Mode demo` para visualização sintética em modo somente leitura, mas **não** para treinamento de ações de gravação.

Instalar o navegador automatizado na máquina que executará os prints (recomendado: venv local ignorado pelo Git):

```powershell
python -m venv .data\venv-academia
.\.data\venv-academia\Scripts\python.exe -m pip install playwright
.\.data\venv-academia\Scripts\python.exe -m playwright install chromium
```

## Operação

1. Ler `references/telas.json` para o inventário de páginas e papéis. Confirmar que as rotas ainda existem no código.
2. Listar telas disponíveis para cada perfil sem navegador: `python scripts/capture-vigiaplus-academy.py --role owner --list`.
3. Executar uma sessão por papel; o navegador Chromium abre visível e o **usuário se autentica manualmente**, sem passar senha ou cookie para o agente.
4. No terminal, apertar Enter após o login para o agente percorrer rotas, alternar tema real quando existir e selecionar abas de navegação. **Não** clicar em salvar, excluir, enviar, cobrar ou coletar.
5. O script grava PNGs reais, um Markdown de aula por tela, `index.md` e `resultado.json`. Uma rota redirecionada ou inexistente deve ser registrada como **PENDENTE**, nunca como tela fotografada.
6. Após a captura, revisar cada screenshot contra sua aula; complementar explicações apenas com o que aparece e com o comportamento efetivamente observado. Não inventar dados ou funcionalidades.
7. Se houver erros, consultar `resultado.json`, corrigir a aplicação quando apropriado e recapturar. Não preencher lacunas com screenshots de outra aplicação.

### Comandos por perfil

```powershell
python scripts/capture-vigiaplus-academy.py --role public
python scripts/capture-vigiaplus-academy.py --role owner
python scripts/capture-vigiaplus-academy.py --role client
python scripts/capture-vigiaplus-academy.py --role analyst
```

Configurar tema único quando necessário: `--themes dark` ou `--themes light`. O tema `dark` só será fotografado se a interface efetivamente apresentar o componente de alternância `.vpx-app`; outras páginas serão registradas no tema padrão.

## Saídas

- `.data/academia-vigiaplus/<perfil>/capturas/<tela>-<tema>.png`
- `.data/academia-vigiaplus/<perfil>/aulas/<tela>-<tema>.md`
- `.data/academia-vigiaplus/<perfil>/index.md`
- `.data/academia-vigiaplus/<perfil>/resultado.json`

Esses caminhos estão cobertos por `.gitignore` (`.data/`). Se o usuário solicitar PDF, apresentação ou outros formatos, gerar **depois**, a partir das capturas revisadas, com as ferramentas específicas e sem divulgar informações pessoais.

## Controles de privacidade e segurança

- **Não usar ambiente de produção ou base com dados pessoais** na captura automatizada padrão. Preparar dados sintéticos ou autorizados antes.
- Somente `http://127.0.0.1` ou `http://localhost` é permitido pelo script; não abrir túneis públicos para screenshots.
- Não registrar senha, credenciais, cookie, token, HTML completo, storage_state ou tráfego de rede. A sessão Chromium é efêmera.
- Campos identificados como senha/e-mail e elementos marcados sensíveis são mascarados, mas textos livres podem conter informações pessoais. **A máscara não garante anonimização completa**; revisar imagem e texto antes de compartilhar.
- Não versionar prints reais com PII. Não automatizar envios externos.
- Nunca afirmar que uma tela está funcional apenas por ter sido capturada. O documento descreve o que foi observado.
- Para operação em outro computador, executar a skill no host que possui acesso ao navegador/localhost. Em conversa sem acesso ao desktop, explicar que a captura efetiva dependerá dessa execução; não fabricar evidências.

## Padrão editorial de cada aula

Objetivo; rota e perfil; screenshot real; como acessar; elementos e controles vistos; exercício guiado de navegação; limites. Fazer uma aula independente por aba do portal (Visão geral, Publicações, Crises e alertas, Meu plano). Linguagem exclusivamente em português do Brasil.

## Fontes técnicas

- Código da aplicação: `app/`, `components/`, `lib/`.
- Inventário: `references/telas.json`.
- Capturador: `scripts/capture-vigiaplus-academy.py`.
- Referência Playwright: https://playwright.dev/python/docs/screenshots
