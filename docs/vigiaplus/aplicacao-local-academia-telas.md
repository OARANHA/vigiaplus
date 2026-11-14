# VigiaPlus — abrir aplicação e produzir aulas das telas

**Tipo de entrega:** experiência local do proprietário e documentação visual da interface existente. **Não é um deploy de produção** e não altera o banco Neon de homologação.

## Atualizar o checkout antes de iniciar

O launcher e a skill estão atualmente na branch de desenvolvimento da PR #36. No PowerShell, com a pasta de trabalho limpa:

```powershell
cd D:\VIGIAPLUS
git status --short
git fetch origin
git switch feat/todo-alt08-notify-supervisor-20261111
git pull --ff-only origin feat/todo-alt08-notify-supervisor-20261111
```

Se `git status --short` listar alterações locais ou `git switch` recusar a troca, preservá-las; não descartar arquivos do usuário.

## 1. Iniciar a aplicação no Windows

No checkout do repositório em `D:\VIGIAPLUS`, execute por duplo clique `INICIAR-VIGIAPLUS.cmd` ou, no terminal:

```powershell
cd D:\VIGIAPLUS
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-vigiaplus-local.ps1
```

O processo usa **127.0.0.1:3199**, Node.js **22+**, banco PGlite persistido em `.data/vigiaplus-owner` e solicita e-mail e senha do proprietário para o **primeiro cadastro**. Não gravar credenciais no repositório. Nas execuções seguintes usar as credenciais já cadastradas; informá-las ao launcher não redefine a senha existente. Mantenha o terminal aberto para o Next.js continuar no ar.

O launcher usa `DATABASE_URL` e `RLS_DATABASE_URL` vazios e cancela `VIGIA_NOTIFY_SCHEDULER`: **nunca aponta para Neon**, não envia notificações e não altera a aplicação que ocupa a porta 3100. Se 3199 estiver ocupada, encerra com erro explícito sem matar processos.

Abra `http://127.0.0.1:3199/login`, efetue login com o proprietário e entre em `/console`. Em uma base vazia o console apresenta **Primeiros passos** com ligações para cadastro de clientes, planos e permissões — funções já implementadas no projeto. O cadastro não cria contrato, cobrança ou acesso automaticamente.

### Apresentação sem gravação

Para uma demonstração visual pública e somente leitura com dados sintéticos:

```powershell
INICIAR-VIGIAPLUS.cmd demo
```

Esse modo usa `.data/vigiaplus-demo`, desabilita autenticação por senha e bloqueia mutações da aplicação. **Não é indicado para ensinar tarefas de cadastro**, pois elas são intencionalmente bloqueadas. Para aulas operacionais use `owner` com registros fictícios criados manualmente.

## 2. Capturar telas e montar aulas

A skill versionada está em `skills/vigiaplus-screen-academy/SKILL.md` e descobre **91 estados/telas** de owner, cliente, analista e acesso público, incluindo abas da administração e do portal. A contagem representa rotas/abas cadastradas no manifesto, **não** quantidade de prints já capturados.

Instale Playwright e Chromium no PC onde a aplicação roda:

```powershell
python -m venv .data\venv-academia
.\.data\venv-academia\Scripts\python.exe -m pip install playwright
.\.data\venv-academia\Scripts\python.exe -m playwright install chromium
```

Execute uma sessão por perfil:

```powershell
.\.data\venv-academia\Scripts\python.exe scripts\capture-vigiaplus-academy.py --role public
.\.data\venv-academia\Scripts\python.exe scripts\capture-vigiaplus-academy.py --role owner
.\.data\venv-academia\Scripts\python.exe scripts\capture-vigiaplus-academy.py --role client
.\.data\venv-academia\Scripts\python.exe scripts\capture-vigiaplus-academy.py --role analyst
```

O Chromium abre em uma janela visível, permitindo login manual. O script navega **sem efetuar mutações**, fotografa as telas existentes e redige Markdown com título, objetivo, controles observados e exercício guiado. Se uma tela estiver indisponível, ela será marcada **PENDENTE**. Modo escuro e claro só são capturados quando a UI oferece alternância.

Os arquivos gerados ficam em `.data/academia-vigiaplus/<perfil>/`: `index.md`, `aulas/*.md`, `capturas/*.png`, `resultado.json`. Não são enviados automaticamente a serviços externos nem commitados no Git. Revisar qualquer dado pessoal antes de compartilhar imagens.

## 3. Estado real e limites de entrega

- Código Next.js possui autenticação, console, administração de clientes/planos/recursos e portal de cliente. Foi adicionado onboarding no console vazio.
- Inicialização local e skill de documentação visual **versionadas**, mas não equivalem a comprovação de execução no Windows até o processo efetivamente iniciar e o navegador registrar capturas.
- O banco **Neon HML** criado na ALT-08.10C.38 permanece isolado; a aplicação local não o utiliza. Integração completa de RLS/autorização em PostgreSQL real e deploy de produção **não foram realizados**.
- A skill não inventa funcionalidades a partir dos prints; ela produz rascunhos de aulas ancorados na interface observada.
- A PR #36 deve permanecer **DRAFT** e não sofrer merge/deploy sem autorização do proprietário.
