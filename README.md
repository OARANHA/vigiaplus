# VigiaPlus

Monitoramento de reputação e gestão de crise para **vários clientes**, com uma área
para cada cliente e uma área de administração para quem opera o serviço.

> Em uma frase: você (dono) cadastra e administra os clientes; cada cliente entra
> e vê **somente** os seus dados, em linguagem que qualquer pessoa entende —
> sem perder a informação que dá valor à leitura.

---

## De onde veio este código

| Item | Origem |
|---|---|
| Aplicação | `OARANHA/crises`, branch **`feat/vigiaelus-crfrs-etapas-1-2`** (a que tem o layout, as fontes e o design escolhidos) |
| Fundação H0 | `OARANHA/vigiaplus` — núcleo Node com isolamento, RBAC, entitlements, LLM Registry e testes adversarial A1–A10, agora em `foundation/` |
| Documentação | `docs/` — SAD, roadmap, protótipo navegável, análise do `crises`, dossiê de remodelagem e os docs da própria branch |

As **64 páginas** do Radar original continuam todas acessíveis à equipe, e a tela
`/vigia` da branch de origem foi preservada.

---

## As três áreas

| Endereço | Quem usa | O que aparece |
|---|---|---|
| `/portal` | Cliente | Panorama, Crises, Relatórios, Minha conta |
| `/console` | Dono / equipe | Clientes, planos, motor de IA, contratos, auditoria |
| `/dashboard` e as demais 64 páginas | Equipe (modo analista) | O Radar completo, sem alterações |

A raiz `/` redireciona automaticamente conforme o papel de quem entrou.

---

## O que já funciona

- **Isolamento por cliente** — o `tenant_id` vem da sessão autenticada, nunca do
  navegador. Um cliente não alcança os dados de outro.
- **Habilitar recurso por contrato** — plano → override por cliente, com motivo,
  validade e registro na auditoria. Exemplo: o Grupo Boreal não tem
  `crisis_playbook` porque não contratou.
- **Qualquer IA compatível com OpenAI** — provedores são cadastrados pelo console
  (nome, URL, modelo, chave por variável de ambiente), não fixados no código.
  Há validação contra SSRF, delimitação de dados não confiáveis e cota por cliente.
- **Modo básico / avançado e leigo / técnico** — dois eixos independentes.
  **Nenhum deles altera permissões** (teste A4).

### Como o número é mostrado ao cliente

O cliente **não** recebe um adjetivo vago como "está boa e estável". Ele recebe o
número, a comparação e a origem — conforme `docs/remodelagem.md §5`:

> *Sua marca está em **72 de 100**, 8 pontos acima de Setor de mobilidade
> urbana (64).*
>
> 1.240 comentários lidos em 24 jornais e redes nos últimos 14 dias.
> Base consolidada: 1.240 comentários analisados.

No modo avançado aparece também **como o número é formado** (tom das conversas
35%, comentários favoráveis 25%, ritmo das citações 20%, alcance 20%). No modo
técnico trocam-se apenas as **palavras** (`Brand Health 72/100 · Δ setor +8 ·
n=1.240`), nunca os dados. Se não houver histórico, o sistema **diz isso** em vez
de inventar uma variação.

---

## Rodar em 30 segundos

```bash
npm install
DEMO_MODE=1 npm run dev      # http://localhost:3000
```

`DEMO_MODE=1` dispensa login e usa dados de exemplo (dois clientes: Aurora
Mobility e Grupo Boreal). Sem variável de ambiente nenhuma: o banco PGlite
embutido fica em `.data/pglite`.

```bash
npm test                     # 277 testes (245 do Radar + 32 da branch)
npx tsc --noEmit
npm run build
```

A fundação H0 continua testável à parte:

```bash
cd foundation && npm test    # testes unitários + adversarial A1–A10
```

---

## Estrutura (resumo)

| Pasta | Conteúdo |
|---|---|
| `app/` | Páginas e APIs (Next.js App Router) |
| `lib/tenant/` | Contexto de tenant, RBAC, entitlements, registro de LLMs |
| `lib/` | Motor do Radar importado, intacto |
| `components/` | Interface, inclusive o seletor de modo de visualização |
| `foundation/` | Fundação H0 original, preservada e executável |
| `docs/` | Documentação de arquitetura, roadmap e protótipo |
| `deploy/` | Docker + Traefik |

---

## Ainda não está pronto para cobrar

Pagamentos (Stripe + Pix), RLS real no Postgres, migrações versionadas, suíte
adversarial no CI, worker de notificações e white-label estão no roadmap
(`docs/vigiaplus-roadmap.md`). Há também um **gate jurídico de AGPL-3.0** descrito
em `NOTICE.md` — ler antes de qualquer comercialização.

---

## Licença

Veja `LICENSE` e `NOTICE.md`. O código importado de `OARANHA/crises` é AGPL-3.0.
