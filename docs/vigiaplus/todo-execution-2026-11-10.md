# VIGIAPLUS — Diário de execução do TODO (10/11/2026)

## Lote SEC-01 / SEC-02 — PR #25

- **Branch:** `fix/todo-p0-client-access-onboarding-20261110` (base PR #24).
- **HEAD verificado:** `1a76be7485e7de91231692a6b10786ecb351adb5`.
- **CI:** [run 42889502935](https://github.com/OARANHA/vigiaplus/actions/runs/42889502935) `completed/success` no SHA acima (372/372 testes; lint com avisos; TypeScript/build aprovados).
- Implementado: `mustChangePassword` recusado em `getCurrentUser` fora de `/impostazioni/account` para APIs, páginas e Server Actions; feature/contrato obrigatório antes de ler evidências e resumo ou gerenciar notificações; clientes sem acesso às rotas legadas de projetos/exportações.
- Testes: PGlite com 2 tenants e efeitos de suspensão, pendência/cancelamento de assinatura; política de senha temporária.
- **Pendente:** E2E autenticado com cookie real após reset da senha, checagem de TODAS as rotas legadas, integração RLS/Neon. Não fechar `SEC-01` ou `SEC-02` sem esse gate.

## Lote CL-01 / CL-02 — PR #26

- **Branch:** `feat/todo-p0-client-invitations-20261110` (base PR #25).
- **HEAD do código homologado:** `3d305a4ab55d93e0c11bfa99151e1c9d0ca63fff`.
- **CI:** [run 42890929629](https://github.com/OARANHA/vigiaplus/actions/runs/42890929629) `completed/success` no SHA acima (375/375 testes; lint com avisos; TypeScript/build aprovados).
- Implementado: token de convite aleatório SHA-256 no banco (texto bruto somente na emissão), validade 48h, endpoint owner-only, revogação auditada, aceite transacional de conta NOVA + membership + auditoria; índice UNIQUE aditivo de membership condicionado a dados íntegros, `revoked_at` aditivo; página `/convite` e formulário do proprietário em `/console/admin?section=acessos`.
- Produção: emissão bloqueada se ausência de Resend, remetente e `PUBLIC_APP_URL` HTTPS. Local: link de teste por entrega manual quando não houver gateway. Não afirmar que o e-mail foi entregue.
- Testes: PGlite de token hash, associação correta com tenant, convite vencido/reutilizado/revogado, e-mail existente recusado e nenhuma conta criada após revogação.
- **Pendente:** vinculação de conta já existente, recuperação de senha, reenvio/throttling distribuído, confirmação de entrega, fluxo completo no navegador com usuários de teste. Não fechar `CL-01` ou `CL-02` antes da homologação.

## Prévia local — validações não destrutivas

- Pasta `D:\VIGIAPLUS`, branch local de prévia `preview/owner-admin-pr24-20261110` com fast-forward do código da PR #26; nenhum merge em main.
- Backup parado e consistente por cópia de arquivos: `D:\VIGIAPLUS_LOCAL_SAFETY_20261110_PR26_CLEAN`.
- Processo antigo da porta 3199 foi encerrado e substituído por um único `next dev --hostname 127.0.0.1 --port 3199` (novo PID inicial 26832); 3100 permanece fechada.
- Após reinício: `GET /api/health` = 200, `GET /login` = 200, `GET /convite?token=invalid` = 200. Sem sessão, `GET /api/console/invitations?tenant_id=1` = 401 antes do reinício. Isso NÃO valida convite real nem entrega.
- **Sem senha ou token de terceiros**, sem uso de gateways financeiros, sem cobrança real, sem exclusão automática de dados.

## Progresso / próximo gate

1. Concluir SEC-01/SEC-02 com testes E2E de cookie real e duas identidades de tenant.
2. Concluir CL-01/CL-02 com conta existente, recovery, envio do e-mail e confirmação.
3. SEC-03 (DEMO_MODE imutável), SEC-04/RLS PR #14, SEC-05/MFA do proprietário.
4. Depois seguir ALT-01…ALT-09 para confiabilidade dos alertas.
5. Toda aprovação de merge/deploy/alteração de produção depende do proprietário.

**Regra:** um CI GREEN de commit anterior não autoriza a promoção do HEAD mais recente; registrar run+SHA exatos sempre.
