# Fundação H0 (preservada)

Este diretório é a **fundação executável original** do `OARANHA/vigiaplus`,
mantida intacta quando a aplicação Next.js foi importada para a raiz do repo.

É um núcleo Node puro, sem dependências externas, que prova as fronteiras de
arquitetura antes de qualquer tela: isolamento por tenant, RBAC, entitlements
por contrato, registro dinâmico de LLMs OpenAI-compatible, webhooks idempotentes
e auditoria. Contém a **suíte adversarial A1–A10**.

```bash
cd foundation
npm test                 # unit.test.js + adversarial.test.js
npm start                # sobe o servidor de referência na porta 3000
node scripts/demo.js     # demonstração das fronteiras
```

A aplicação de produção está na raiz (`app/`, `lib/`, `components/`) e usa
`lib/tenant/`, que implementa os mesmos conceitos em TypeScript sobre o banco
real. Os dois conjuntos de testes são complementares e devem rodar no CI.
