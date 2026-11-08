# Aviso de licenciamento — ler antes de cobrar

O repositório de origem `OARANHA/crises` está publicado sob **AGPL-3.0**.

A fundação neste diretório é código novo, criado para demonstrar as fronteiras de
arquitetura, e **não contém código copiado** de `crises`. Ainda assim, o produto
`VigiaPlus` planeja **evoluir a partir** de `crises`, e é aí que a licença importa:

- A cláusula de rede da AGPL-3.0 (§13) é acionada quando o software modificado é
  oferecido como **serviço pela rede** — exatamente o modelo SaaS multi-tenant.
- Isso pode exigir disponibilizar o código-fonte correspondente aos usuários do serviço.
- Portanto: **gate jurídico obrigatório no fim do H2, antes de qualquer cobrança**.

Ações registradas no roadmap (`vigiaplus-roadmap.md`, épico E2.9):

1. Obter parecer jurídico sobre AGPL-3.0 aplicada a SaaS no Brasil.
2. Decidir entre: cumprir integralmente a AGPL, negociar licença comercial com o
   titular, ou isolar/substituir os componentes de origem.
3. Arquivar a decisão por escrito e referenciá-la neste arquivo.

Nenhuma integração de pagamento deve ser ativada em produção antes desse gate.

Outro ponto: **LGPD**. Antes de operar com dados reais, é necessário inventário de
subprocessadores, DPAs, política de retenção com exportação prévia, e trilha de
auditoria imutável (já prevista em `src/audit.js`).
